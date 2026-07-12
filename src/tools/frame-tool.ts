import {
	type AffineMatrix,
	applyMatrix,
	type CanvasNodeCreateCommand,
	createFrame,
	invertMatrix,
} from "@anvilkit/canvas-core";
import { snapPoint } from "./draw-snap.js";
import { findFrameHitAtPoint } from "./frame-target.js";
import type { Tool } from "./tool-types.js";

const MIN_DIMENSION = 1;

/**
 * Rebase a world-space drag rectangle into a parent's local space. Subtracting
 * the parent's `transform.x/y` would only be correct for an un-rotated,
 * un-scaled parent — inverting its world matrix handles every case. Both corners
 * are mapped and re-normalised, so the child stays axis-aligned in its parent's
 * space even when that parent is rotated.
 */
function toLocalBox(
	worldMatrix: AffineMatrix,
	x: number,
	y: number,
	width: number,
	height: number,
): { x: number; y: number; width: number; height: number } {
	let inv: AffineMatrix;
	try {
		inv = invertMatrix(worldMatrix);
	} catch {
		// Degenerate (zero-scale) parent — fall back to world coords rather than
		// dropping the user's gesture on the floor.
		return { x, y, width, height };
	}
	const [ax, ay] = applyMatrix(inv, x, y);
	const [bx, by] = applyMatrix(inv, x + width, y + height);
	return {
		x: Math.min(ax, bx),
		y: Math.min(ay, by),
		width: Math.abs(bx - ax),
		height: Math.abs(by - ay),
	};
}

/**
 * Drag out a frame — a container that owns its bounds and clips its children.
 *
 * Frames clip by default: clipping is the whole reason to reach for one over a
 * group, and a non-clipping frame is a click away in the inspector.
 *
 * Dragging INSIDE an existing frame nests the new frame as its child, matching
 * how the image tool targets a frame under the pointer. The child's transform is
 * relative to its parent, so the drag rectangle is rebased into the parent's
 * space before it is committed.
 *
 * A frame starts plain, NOT as an image well — a well is a frame that stands in
 * for content it doesn't have yet, which is a deliberate choice made in the
 * inspector, not the default meaning of every container.
 *
 * MVP-7 rule: commit fires only on pointerup. pointerdown/pointermove update the
 * transient draftStore — never historyStore.
 */
export const frameTool: Tool = {
	id: "frame",
	cursor: "crosshair",

	onPointerDown(e, ctx) {
		ctx.draftStore.getState().setDraft({
			type: "frame",
			startX: e.point.x,
			startY: e.point.y,
			currentX: e.point.x,
			currentY: e.point.y,
		});
	},

	onPointerMove(e, ctx) {
		const draft = ctx.draftStore.getState().draft;
		if (!draft || draft.type !== "frame") return;
		const snapped = snapPoint(ctx, e.point);
		ctx.draftStore.getState().setDraft({
			...draft,
			currentX: snapped.x,
			currentY: snapped.y,
		});
		ctx.guidesStore.getState().setGuides(snapped.guides);
	},

	onPointerUp(e, ctx) {
		const draft = ctx.draftStore.getState().draft;
		if (!draft || draft.type !== "frame") return;
		const snapped = snapPoint(ctx, e.point);

		ctx.draftStore.getState().clearDraft();
		ctx.guidesStore.getState().clearGuides();

		const x = Math.min(draft.startX, snapped.x);
		const y = Math.min(draft.startY, snapped.y);
		const width = Math.abs(snapped.x - draft.startX);
		const height = Math.abs(snapped.y - draft.startY);
		if (width < MIN_DIMENSION || height < MIN_DIMENSION) return;

		// Nest into the frame the drag started in, if any. Only the START point is
		// tested: dragging out past the parent's edge should still nest (the clip
		// will trim it), whereas testing the end point would flip the parent
		// mid-gesture.
		const ir = ctx.getIR();
		const page = ir.pages.find((p) => p.id === ctx.activePageId);
		const hit = page
			? findFrameHitAtPoint(page.root.children, {
					x: draft.startX,
					y: draft.startY,
				})
			: null;

		const box = hit
			? toLocalBox(hit.worldMatrix, x, y, width, height)
			: { x, y, width, height };

		const node = createFrame({
			bounds: { width: box.width, height: box.height },
			transform: { x: box.x, y: box.y },
			clip: true,
		});
		const cmd: CanvasNodeCreateCommand = {
			type: "node.create",
			node,
			pageId: ctx.activePageId,
			...(hit ? { parentId: hit.frame.id } : {}),
		};
		ctx.commit(cmd);
		ctx.selectionStore.getState().setSelection([node.id]);
	},

	onDeactivate(ctx) {
		ctx.draftStore.getState().clearDraft();
		ctx.guidesStore.getState().clearGuides();
	},
};
