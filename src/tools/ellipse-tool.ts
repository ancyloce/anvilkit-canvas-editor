import {
	type CanvasNodeCreateCommand,
	createEllipse,
} from "@anvilkit/canvas-core";
import { snapPoint } from "./draw-snap.js";
import type { Tool } from "./tool-types.js";

const MIN_DIMENSION = 1;

export const ellipseTool: Tool = {
	id: "ellipse",
	cursor: "crosshair",

	onPointerDown(e, ctx) {
		ctx.draftStore.getState().setDraft({
			type: "ellipse",
			startX: e.point.x,
			startY: e.point.y,
			currentX: e.point.x,
			currentY: e.point.y,
		});
	},

	onPointerMove(e, ctx) {
		const draft = ctx.draftStore.getState().draft;
		if (!draft || draft.type !== "ellipse") return;
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
		if (!draft || draft.type !== "ellipse") return;
		const snapped = snapPoint(ctx, e.point);

		ctx.draftStore.getState().clearDraft();
		ctx.guidesStore.getState().clearGuides();

		const x = Math.min(draft.startX, snapped.x);
		const y = Math.min(draft.startY, snapped.y);
		const width = Math.abs(snapped.x - draft.startX);
		const height = Math.abs(snapped.y - draft.startY);
		if (width < MIN_DIMENSION || height < MIN_DIMENSION) return;

		const node = createEllipse({
			bounds: { width, height },
			transform: { x, y },
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
