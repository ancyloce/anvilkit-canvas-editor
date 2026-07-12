import {
	type CanvasNodeCreateCommand,
	createStar,
} from "@anvilkit/canvas-core";
import { snapPoint } from "./draw-snap.js";
import type { Tool } from "./tool-types.js";

const MIN_DIMENSION = 1;
/** Matches `createStar`'s own defaults — the drag preview and the committed
 * node must agree on point count / inner radius without extra draft config. */
const DEFAULT_POINTS = 5;
const DEFAULT_INNER_RADIUS_RATIO = 0.5;

export const starTool: Tool = {
	id: "star",
	cursor: "crosshair",

	onPointerDown(e, ctx) {
		ctx.draftStore.getState().setDraft({
			type: "star",
			startX: e.point.x,
			startY: e.point.y,
			currentX: e.point.x,
			currentY: e.point.y,
		});
	},

	onPointerMove(e, ctx) {
		const draft = ctx.draftStore.getState().draft;
		if (!draft || draft.type !== "star") return;
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
		if (!draft || draft.type !== "star") return;
		const snapped = snapPoint(ctx, e.point);

		ctx.draftStore.getState().clearDraft();
		ctx.guidesStore.getState().clearGuides();

		const x = Math.min(draft.startX, snapped.x);
		const y = Math.min(draft.startY, snapped.y);
		const width = Math.abs(snapped.x - draft.startX);
		const height = Math.abs(snapped.y - draft.startY);
		if (width < MIN_DIMENSION || height < MIN_DIMENSION) return;

		const node = createStar({
			bounds: { width, height },
			transform: { x, y },
			points: DEFAULT_POINTS,
			innerRadiusRatio: DEFAULT_INNER_RADIUS_RATIO,
			fill: "#cccccc",
		});
		const cmd: CanvasNodeCreateCommand = {
			type: "node.create",
			node,
			pageId: ctx.activePageId,
		};
		ctx.commit(cmd);
		ctx.selectionStore.getState().setSelection([node.id]);
	},

	onDeactivate(ctx) {
		ctx.draftStore.getState().clearDraft();
		ctx.guidesStore.getState().clearGuides();
	},
};
