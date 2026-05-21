import type { Tool } from "./tool-types.js";

function setCursor(
	stage: { container?: () => HTMLElement | null },
	cursor: string,
): void {
	const c = stage.container?.();
	if (c) c.style.cursor = cursor;
}

/**
 * MVP-7: hand tool NEVER commits — pan is view state, lives in viewportStore.
 * The MVP-7 single-command assertion test's negative case (active tool = hand)
 * expects history.past.length === 0 after a full down→move*→up sequence.
 */
export const handTool: Tool = {
	id: "hand",
	cursor: "grab",

	onPointerDown(e, ctx) {
		const vp = ctx.viewportStore.getState();
		ctx.draftStore.getState().setDraft({
			type: "pan",
			startScreenX: e.screenPoint.x,
			startScreenY: e.screenPoint.y,
			startPanX: vp.panX,
			startPanY: vp.panY,
		});
		setCursor(ctx.stage, "grabbing");
	},

	onPointerMove(e, ctx) {
		const draft = ctx.draftStore.getState().draft;
		if (!draft || draft.type !== "pan") return;
		const dx = e.screenPoint.x - draft.startScreenX;
		const dy = e.screenPoint.y - draft.startScreenY;
		ctx.viewportStore
			.getState()
			.setPan(draft.startPanX + dx, draft.startPanY + dy);
	},

	onPointerUp(_e, ctx) {
		const draft = ctx.draftStore.getState().draft;
		if (!draft || draft.type !== "pan") return;
		ctx.draftStore.getState().clearDraft();
		setCursor(ctx.stage, "grab");
	},

	onActivate(ctx) {
		setCursor(ctx.stage, "grab");
	},

	onDeactivate(ctx) {
		ctx.draftStore.getState().clearDraft();
		setCursor(ctx.stage, "default");
	},
};
