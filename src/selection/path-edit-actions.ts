import { type CanvasNodeUpdateCommand, findNode } from "@anvilkit/canvas-core";
import type { CanvasStudioContextValue } from "../context/canvas-studio-context.js";

/**
 * Enter on-stage point editing for a path node. No-op (returns false) when the
 * path-edit store is unavailable or the target is not a path node.
 */
export function beginPathEdit(
	ctx: CanvasStudioContextValue,
	nodeId: string,
): boolean {
	if (!ctx.pathEditStore) return false;
	const found = findNode(ctx.getIR(), nodeId);
	if (!found || found.node.type !== "path") return false;
	ctx.pathEditStore.getState().begin(nodeId);
	return true;
}

/** Commit a new `d` for a path node (one `node.update`). No-op for empty `d`. */
export function commitPathD(
	ctx: CanvasStudioContextValue,
	nodeId: string,
	d: string,
): void {
	if (d.length === 0) return;
	const cmd: CanvasNodeUpdateCommand<"path"> = {
		type: "node.update",
		nodeId,
		kind: "path",
		patch: { d },
	};
	ctx.commit(cmd);
}

/** Leave path point-editing mode. */
export function endPathEdit(ctx: CanvasStudioContextValue): void {
	ctx.pathEditStore?.getState().clear();
}
