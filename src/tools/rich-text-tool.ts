import {
	type CanvasNodeCreateCommand,
	createRichText,
} from "@anvilkit/canvas-core";
import type { Tool } from "./tool-types.js";

const DEFAULT_TEXT = "Text";
const DEFAULT_WIDTH = 240;
const DEFAULT_HEIGHT = 60;

/**
 * A separate tool from `text` rather than a mode on it: `CanvasRichTextNode`
 * is a deliberately separate IR kind from `CanvasTextNode` (see its doc
 * comment in canvas-core), and FR-013 requires the plain `text` tool to keep
 * working unchanged. This mirrors `text-tool.ts`'s exact click-to-place,
 * single-command shape (MVP-7: one `node.create` on pointerdown, no drag).
 */
export const richTextTool: Tool = {
	id: "rich-text",
	cursor: "text",

	onPointerDown(e, ctx) {
		const node = createRichText({
			bounds: { width: DEFAULT_WIDTH, height: DEFAULT_HEIGHT },
			transform: { x: e.point.x, y: e.point.y },
			paragraphs: [{ spans: [{ text: DEFAULT_TEXT }] }],
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
