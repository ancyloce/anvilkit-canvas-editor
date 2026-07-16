import {
	type CanvasCommand,
	computeStylePatch,
	extractNodeStyle,
	findNode,
} from "@anvilkit/canvas-core";
import type { CanvasStudioContextValue } from "../context/canvas-studio-context.js";
import {
	type CanvasToaster,
	NOOP_CANVAS_TOASTER,
} from "../context/toast-context.js";
import { internalClipboardStore } from "../stores/clipboard-store.js";

/**
 * Copy/paste style (C-05, FR-120/121) through the unified action layer. The
 * style clipboard is the module-level internal clipboard's `style` slot —
 * style never goes to the system clipboard (it is not node content), so
 * there is no async/permission surface here.
 */

/** FR-120: copy the PRIMARY selected node's style. Returns true when copied. */
export function copyStyleImpl(ctx: CanvasStudioContextValue): boolean {
	const primaryId = ctx.selectionStore.getState().selectedIds[0];
	if (!primaryId) return false;
	const found = findNode(ctx.getIR(), primaryId);
	if (!found) return false;
	internalClipboardStore.getState().setStyle(extractNodeStyle(found.node));
	return true;
}

/** True when a copied style is available (menu enablement). */
export function hasCopiedStyle(): boolean {
	return internalClipboardStore.getState().style !== null;
}

/**
 * FR-121: paste the copied style onto every selected, unlocked node as ONE
 * batch of `node.applyStyle` commands (one undo entry). Locked targets are
 * skipped with a toast (same posture as delete); incompatible keys are
 * reported per the shared matrix but never block. Returns the styled ids.
 */
export function pasteStyleImpl(
	ctx: CanvasStudioContextValue,
	toaster: CanvasToaster = NOOP_CANVAS_TOASTER,
): string[] {
	const style = internalClipboardStore.getState().style;
	if (!style) return [];
	const t = ctx.t ?? ((_k: string, fallback?: string) => fallback ?? "");
	const ir = ctx.getIR();
	const selectedIds = ctx.selectionStore.getState().selectedIds;
	const cmds: CanvasCommand[] = [];
	const ignored = new Set<string>();
	let lockedSkipped = 0;
	for (const id of selectedIds) {
		const found = findNode(ir, id);
		if (!found) continue;
		if (found.node.locked === true) {
			lockedSkipped += 1;
			continue;
		}
		const result = computeStylePatch(found.node, style);
		for (const key of result.ignored) ignored.add(key);
		if (result.applied.length === 0) continue;
		cmds.push({ type: "node.applyStyle", nodeId: id, style });
	}
	if (lockedSkipped > 0) {
		toaster.add({
			type: "warning",
			title: t("canvas.toast.lockedNotStyled", "Locked layers weren't styled"),
		});
	}
	if (ignored.size > 0) {
		toaster.add({
			type: "info",
			title: t(
				"canvas.toast.styleFieldsIgnored",
				"Some style properties don't apply here",
			),
			description: [...ignored].join(", "),
		});
	}
	if (cmds.length === 0) return [];
	const first = cmds[0];
	if (cmds.length === 1 && first) ctx.commit(first);
	else ctx.commitBatch(cmds, "Paste style");
	return cmds.map((c) => (c as { nodeId: string }).nodeId);
}
