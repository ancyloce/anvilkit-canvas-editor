import { type CanvasCommand, findNode, parentOf } from "@anvilkit/canvas-core";
import type { CanvasStudioContextValue } from "../context/canvas-studio-context.js";

export type CanvasReorderDirection = "front" | "forward" | "backward" | "back";

/**
 * FR-031 layer-order actions: move every (unlocked) selected node within its
 * parent as ONE undo entry. `node.reorder` clamps indices, so boundary moves
 * degrade to no-ops instead of throwing.
 */
export function reorderSelectionImpl(
	ctx: CanvasStudioContextValue,
	direction: CanvasReorderDirection,
): void {
	const ir = ctx.getIR();
	const cmds: CanvasCommand[] = [];
	for (const id of ctx.selectionStore.getState().selectedIds) {
		const found = findNode(ir, id);
		if (!found || found.node.locked === true) continue;
		const parentResult = parentOf(ir, id);
		if (!parentResult) continue;
		const idx = parentResult.parent.children.findIndex((c) => c.id === id);
		if (idx < 0) continue;
		const last = parentResult.parent.children.length - 1;
		const toIndex =
			direction === "front"
				? last
				: direction === "back"
					? 0
					: direction === "forward"
						? idx + 1
						: idx - 1;
		if (toIndex === idx) continue;
		cmds.push({ type: "node.reorder", nodeId: id, toIndex });
	}
	const first = cmds[0];
	if (cmds.length === 0) return;
	if (cmds.length === 1 && first) ctx.commit(first);
	else ctx.commitBatch(cmds, "Reorder");
}
