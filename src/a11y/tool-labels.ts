import type { ToolId } from "../stores/tool-store.js";

/**
 * Human-readable names for the PRD FR-009 tools, used for screen-reader
 * announcements (and reusable by hosts that build a tool palette — the editor
 * itself ships no toolbar; tool selection is host-driven). Keep in sync with
 * {@link ToolId}.
 */
export const TOOL_LABELS: Record<ToolId, string> = {
	select: "Select",
	text: "Text",
	rect: "Rectangle",
	ellipse: "Ellipse",
	line: "Line",
	path: "Pen",
	image: "Image",
	hand: "Hand",
	"ai-image": "AI image",
	"ai-brush": "AI brush",
};
