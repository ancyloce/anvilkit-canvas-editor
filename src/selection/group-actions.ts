import {
	type CanvasIR,
	type CanvasNodeGroupCommand,
	type CanvasNodeUngroupCommand,
	findNode,
	isGroupNode,
	parentOf,
} from "@anvilkit/canvas-core";
import type { CanvasStudioContextValue } from "../context/canvas-studio-context.js";

function generateGroupId(): string {
	const c = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto;
	if (c && typeof c.randomUUID === "function") return c.randomUUID();
	return `group-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * True when the current selection can be grouped: at least two nodes, all
 * present on the active page and sharing the same immediate parent group.
 * Cross-parent grouping is intentionally unsupported (see `node.group`).
 */
export function canGroupSelection(
	ir: CanvasIR,
	selectedIds: readonly string[],
): boolean {
	if (selectedIds.length < 2) return false;
	let parentId: string | undefined;
	for (const id of selectedIds) {
		const result = parentOf(ir, id);
		if (!result) return false; // page-root or unknown id
		if (parentId === undefined) {
			parentId = result.parent.id;
		} else if (parentId !== result.parent.id) {
			return false;
		}
	}
	return true;
}

/**
 * True when at least one selected node is a non-root group that can be
 * dissolved.
 */
export function canUngroupSelection(
	ir: CanvasIR,
	selectedIds: readonly string[],
): boolean {
	return selectedIds.some((id) => {
		const found = findNode(ir, id);
		return !!found && isGroupNode(found.node) && parentOf(ir, id) !== null;
	});
}

/**
 * Wrap the current multi-selection in a new group on the active page and select
 * the new group. No-op (returns `null`) unless {@link canGroupSelection} holds.
 * Returns the new group's id.
 */
export function groupSelection(ctx: CanvasStudioContextValue): string | null {
	const ir = ctx.getIR();
	const selectedIds = ctx.selectionStore.getState().selectedIds;
	if (!canGroupSelection(ir, selectedIds)) return null;
	const groupId = generateGroupId();
	const cmd: CanvasNodeGroupCommand = {
		type: "node.group",
		pageId: ctx.activePageId,
		childIds: [...selectedIds],
		groupId,
	};
	ctx.commit(cmd);
	ctx.selectionStore.getState().setSelection([groupId]);
	return groupId;
}

/**
 * Dissolve every selected (non-root) group, lifting its children into the
 * parent, then select the lifted children. Returns the lifted child ids.
 * Multiple groups dissolve as ONE undo entry (a single `commitBatch`); a lone
 * group stays a plain commit. Commands are collected from the pre-gesture IR —
 * the selected groups are distinct, so each `node.ungroup` resolves its group by
 * id regardless of how earlier ungroups in the batch reshaped the tree.
 */
export function ungroupSelection(ctx: CanvasStudioContextValue): string[] {
	const selectedIds = [...ctx.selectionStore.getState().selectedIds];
	const ir = ctx.getIR();
	const lifted: string[] = [];
	const cmds: CanvasNodeUngroupCommand[] = [];
	for (const id of selectedIds) {
		const found = findNode(ir, id);
		if (!found || !isGroupNode(found.node)) continue;
		if (parentOf(ir, id) === null) continue;
		lifted.push(...found.node.children.map((c) => c.id));
		cmds.push({ type: "node.ungroup", groupId: id });
	}
	if (cmds.length > 1) {
		ctx.commitBatch(cmds, "Ungroup");
	} else if (cmds.length === 1 && cmds[0]) {
		ctx.commit(cmds[0]);
	}
	if (lifted.length > 0) {
		ctx.selectionStore.getState().setSelection(lifted);
	}
	return lifted;
}
