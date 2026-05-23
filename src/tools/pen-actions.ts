import {
	type CanvasCommand,
	type CanvasIR,
	type CanvasNodeCreateCommand,
	createPath,
} from "@anvilkit/canvas-core";
import type { PenStoreApi } from "../stores/pen-store.js";
import type { SelectionStoreApi } from "../stores/selection-store.js";
import { buildPathD, penBounds } from "./pen-geometry.js";

/**
 * Minimal context shape shared by `ToolContext` (pen tool) and
 * `CanvasStudioContextValue` (keyboard overlay). `penStore` is optional so the
 * structurally-wider studio context (where it is optional) also fits.
 */
export interface PenCommitContext {
	penStore?: PenStoreApi;
	commit: (cmd: CanvasCommand) => CanvasIR;
	selectionStore: SelectionStoreApi;
	activePageId: string;
}

const MIN_ANCHORS = 2;

/**
 * Finalize the in-progress pen path: builds a `CanvasPathNode` (bounds-local
 * `d`, identity-stroke defaults), commits one `node.create`, resets the pen
 * store, and selects the new node. No-op (returns null) for fewer than two
 * anchors. `closed` appends a `Z` and the closing segment.
 */
export function commitPenPath(
	ctx: PenCommitContext,
	closed: boolean,
): string | null {
	const store = ctx.penStore;
	if (!store) return null;
	const anchors = store.getState().anchors;
	if (anchors.length < MIN_ANCHORS) {
		store.getState().reset();
		return null;
	}
	const bounds = penBounds(anchors);
	const d = buildPathD(anchors, closed, bounds.minX, bounds.minY);
	const node = createPath({
		bounds: { width: bounds.width, height: bounds.height },
		transform: { x: bounds.minX, y: bounds.minY },
		d,
		stroke: "#000000",
		strokeWidth: 2,
	});
	const cmd: CanvasNodeCreateCommand = {
		type: "node.create",
		node,
		pageId: ctx.activePageId,
	};
	ctx.commit(cmd);
	store.getState().reset();
	ctx.selectionStore.getState().setSelection([node.id]);
	return node.id;
}

/** Abandon the in-progress pen path without committing. */
export function cancelPenPath(ctx: PenCommitContext): void {
	ctx.penStore?.getState().reset();
}
