import {
	type CanvasNodeCreateCommand,
	createLine,
} from "@anvilkit/canvas-core";
import { snapPoint } from "./draw-snap.js";
import type { Tool } from "./tool-types.js";

const MIN_LENGTH = 1;

export const lineTool: Tool = {
	id: "line",
	cursor: "crosshair",

	onPointerDown(e, ctx) {
		ctx.draftStore.getState().setDraft({
			type: "line",
			startX: e.point.x,
			startY: e.point.y,
			currentX: e.point.x,
			currentY: e.point.y,
		});
	},

	onPointerMove(e, ctx) {
		const draft = ctx.draftStore.getState().draft;
		if (!draft || draft.type !== "line") return;
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
		if (!draft || draft.type !== "line") return;
		const snapped = snapPoint(ctx, e.point);

		ctx.draftStore.getState().clearDraft();
		ctx.guidesStore.getState().clearGuides();

		const dx = snapped.x - draft.startX;
		const dy = snapped.y - draft.startY;
		if (Math.abs(dx) < MIN_LENGTH && Math.abs(dy) < MIN_LENGTH) return;

		const node = createLine({
			points: [0, 0, dx, dy],
			transform: { x: draft.startX, y: draft.startY },
			stroke: "#000000",
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
