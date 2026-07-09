import {
	type CanvasNodeCreateCommand,
	createText,
} from "@anvilkit/canvas-core";
import type { Tool } from "./tool-types.js";

const DEFAULT_TEXT = "Text";
const DEFAULT_FONT_FAMILY = "Inter";
const DEFAULT_FONT_SIZE = 24;
const DEFAULT_FILL = "#000000";
const DEFAULT_WIDTH = 200;
const DEFAULT_HEIGHT = 36;

/**
 * MVP-7: single click commits exactly one node.create on pointerdown
 * (no drag, no pointermove side effects). Editor overlay opens on the same
 * event — see `<TextEditorOverlay>`. pointermove/pointerup are no-ops so the
 * MVP-7 single-command assertion holds for the full down→move*→up sequence.
 */
export const textTool: Tool = {
	id: "text",
	cursor: "text",

	onPointerDown(e, ctx) {
		const node = createText({
			bounds: { width: DEFAULT_WIDTH, height: DEFAULT_HEIGHT },
			transform: { x: e.point.x, y: e.point.y },
			text: DEFAULT_TEXT,
			fontFamily: DEFAULT_FONT_FAMILY,
			fontSize: DEFAULT_FONT_SIZE,
			fill: DEFAULT_FILL,
		});
		const cmd: CanvasNodeCreateCommand = {
			type: "node.create",
			node,
			pageId: ctx.activePageId,
		};
		ctx.commit(cmd);
		ctx.selectionStore.getState().setSelection([node.id]);
		ctx.editingStore.getState().setEditing(node.id);
	},

	onDeactivate(ctx) {
		ctx.editingStore.getState().clearEditing();
	},
};
