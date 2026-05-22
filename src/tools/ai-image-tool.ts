import type { AiLayerContext } from "@anvilkit/canvas-core";
import type { Tool } from "./tool-types.js";

const MIN_MARQUEE_SIZE = 2;

/**
 * I1-7 `ai-image` tool (PRD FR-009: "Drag → marquee + prompt input →
 * text-to-image"). Drags a marquee region and, on pointerup, hands the bounds
 * to the host as an `ai-image-marquee` intent — the host's AI panel supplies
 * the prompt input and runs the generation. The tool itself commits nothing to
 * the IR/history (intent is not a command), mirroring how the selection marquee
 * never touches `historyStore`. Reuses the `"marquee"` draft kind so
 * `<DraftRenderer>` shows the region preview for free.
 */
export const aiImageTool: Tool = {
	id: "ai-image",
	cursor: "crosshair",

	onPointerDown(e, ctx) {
		ctx.draftStore.getState().setDraft({
			type: "marquee",
			startX: e.point.x,
			startY: e.point.y,
			currentX: e.point.x,
			currentY: e.point.y,
		});
	},

	onPointerMove(e, ctx) {
		const draft = ctx.draftStore.getState().draft;
		if (!draft || draft.type !== "marquee") return;
		ctx.draftStore.getState().setDraft({
			...draft,
			currentX: e.point.x,
			currentY: e.point.y,
		});
	},

	onPointerUp(e, ctx) {
		const draft = ctx.draftStore.getState().draft;
		if (!draft || draft.type !== "marquee") return;
		ctx.draftStore.getState().clearDraft();

		const x = Math.min(draft.startX, e.point.x);
		const y = Math.min(draft.startY, e.point.y);
		const width = Math.abs(e.point.x - draft.startX);
		const height = Math.abs(e.point.y - draft.startY);
		// Reject degenerate regions — a 1-D drag (zero width OR height) is not a
		// usable generation target. Mirrors `rect-tool`'s `||` guard (a region
		// needs both dimensions), not the selection marquee's `&&`.
		if (width < MIN_MARQUEE_SIZE || height < MIN_MARQUEE_SIZE) return;

		const context: AiLayerContext = {
			artboardId: ctx.activePageId,
			bounds: { x, y, width, height },
		};
		ctx.requestAiIntent?.({ kind: "ai-image-marquee", context });
	},

	onDeactivate(ctx) {
		ctx.draftStore.getState().clearDraft();
	},
};
