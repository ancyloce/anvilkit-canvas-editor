import type { CanvasStudioContextValue } from "../context/canvas-studio-context.js";

export type CanvasCancelStep =
	| "text-editing"
	| "crop"
	| "pen"
	| "path-edit"
	| "draft"
	| "tool"
	| "selection"
	| "none";

/**
 * The Escape precedence stack (A-07, PRD 0012 FR-040): ONE press performs
 * exactly ONE step, evaluated top-down. Steps 1–4 of the PRD stack (exit
 * text editing, close menu/popover, close dialog, revert field) are owned by
 * the components themselves — their Escape keystrokes originate in inputs/
 * contenteditable/portals and never reach the workspace registry, thanks to
 * the typing guard. This coordinator implements the remaining stack: cancel
 * the in-progress interaction (crop → pen → path-edit → draft, plus a
 * defensive text-editing clear), then return the tool to Select, then clear
 * the selection. Returns which step ran (for tests and telemetry).
 */
export function cancelImpl(ctx: CanvasStudioContextValue): CanvasCancelStep {
	if (ctx.editingStore.getState().editingNodeId !== null) {
		ctx.editingStore.getState().clearEditing();
		return "text-editing";
	}
	if (ctx.cropStore.getState().cropNodeId !== null) {
		ctx.cropStore.getState().clear();
		return "crop";
	}
	if (ctx.penStore.getState().anchors.length > 0) {
		ctx.penStore.getState().reset();
		return "pen";
	}
	if (ctx.pathEditStore.getState().editNodeId !== null) {
		ctx.pathEditStore.getState().clear();
		return "path-edit";
	}
	if (ctx.draftStore.getState().draft !== null) {
		ctx.draftStore.getState().clearDraft();
		return "draft";
	}
	if (ctx.toolStore.getState().activeTool !== "select") {
		ctx.toolStore.getState().setActiveTool("select");
		return "tool";
	}
	if (ctx.selectionStore.getState().selectedIds.length > 0) {
		ctx.selectionStore.getState().clearSelection();
		return "selection";
	}
	return "none";
}
