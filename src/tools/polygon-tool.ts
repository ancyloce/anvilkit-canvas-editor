import {
	type CanvasNodeCreateCommand,
	createPolygon,
} from "@anvilkit/canvas-core";
import { snapPoint } from "./draw-snap.js";
import type { Tool } from "./tool-types.js";

const MIN_DIMENSION = 1;
/** Matches `createPolygon`'s own default — the drag preview and the
 * committed node must agree on vertex count without any extra draft config. */
const DEFAULT_SIDES = 5;

export const polygonTool: Tool = {
	id: "polygon",
	cursor: "crosshair",

	onPointerDown(e, ctx) {
		ctx.draftStore.getState().setDraft({
			type: "polygon",
			startX: e.point.x,
			startY: e.point.y,
			currentX: e.point.x,
			currentY: e.point.y,
		});
	},

	onPointerMove(e, ctx) {
		const draft = ctx.draftStore.getState().draft;
		if (!draft || draft.type !== "polygon") return;
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
		if (!draft || draft.type !== "polygon") return;
		const snapped = snapPoint(ctx, e.point);

		ctx.draftStore.getState().clearDraft();
		ctx.guidesStore.getState().clearGuides();

		const x = Math.min(draft.startX, snapped.x);
		const y = Math.min(draft.startY, snapped.y);
		const width = Math.abs(snapped.x - draft.startX);
		const height = Math.abs(snapped.y - draft.startY);
		if (width < MIN_DIMENSION || height < MIN_DIMENSION) return;

		const node = createPolygon({
			bounds: { width, height },
			transform: { x, y },
			sides: DEFAULT_SIDES,
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
