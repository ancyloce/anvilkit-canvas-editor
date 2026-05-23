import { commitPenPath } from "./pen-actions.js";
import type { Tool } from "./tool-types.js";

/** World-pixel radius for "click the first anchor to close the path". */
const CLOSE_THRESHOLD = 8;

// Single active tool at a time, so module-level interaction state is safe.
let draggingHandle = false;

/**
 * Pen tool (I3-2). Click to place anchors; drag after a click to pull out a
 * symmetric bezier handle. Clicking within {@link CLOSE_THRESHOLD} of the first
 * anchor (with ≥2 anchors) closes the path and commits. Enter/Escape (handled by
 * the `PenToolOverlay`) finalize/cancel. Per MVP-7 the only history commit is the
 * final `node.create` — clicks/drags mutate the transient pen store.
 */
export const penTool: Tool = {
	id: "path",
	cursor: "crosshair",

	onPointerDown(e, ctx) {
		const store = ctx.penStore;
		const anchors = store.getState().anchors;
		const first = anchors[0];
		if (anchors.length >= 2 && first) {
			const dx = e.point.x - first.x;
			const dy = e.point.y - first.y;
			if (Math.hypot(dx, dy) <= CLOSE_THRESHOLD) {
				commitPenPath(ctx, true);
				draggingHandle = false;
				return;
			}
		}
		store.getState().addAnchor({
			x: e.point.x,
			y: e.point.y,
			hx: e.point.x,
			hy: e.point.y,
		});
		draggingHandle = true;
	},

	onPointerMove(e, ctx) {
		if (!draggingHandle) return;
		if (ctx.penStore.getState().anchors.length === 0) return;
		ctx.penStore.getState().updateLastHandle(e.point.x, e.point.y);
	},

	onPointerUp() {
		draggingHandle = false;
	},

	onDeactivate(ctx) {
		ctx.penStore.getState().reset();
		draggingHandle = false;
	},
};
