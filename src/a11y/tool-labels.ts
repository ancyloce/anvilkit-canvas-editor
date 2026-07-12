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
	frame: "Frame",
	rect: "Rectangle",
	ellipse: "Ellipse",
	line: "Line",
	path: "Pen",
	image: "Image",
	hand: "Hand",
	"ai-image": "AI image",
	"ai-brush": "AI brush",
};

/**
 * i18n keys parallel to {@link TOOL_LABELS}. Consumers resolve a localized name
 * via `t(TOOL_LABEL_KEYS[id], TOOL_LABELS[id])` — the `TOOL_LABELS` value is the
 * English fallback when no message catalog is injected.
 */
export const TOOL_LABEL_KEYS: Record<ToolId, string> = {
	select: "canvas.tool.select",
	text: "canvas.tool.text",
	frame: "canvas.tool.frame",
	rect: "canvas.tool.rect",
	ellipse: "canvas.tool.ellipse",
	line: "canvas.tool.line",
	path: "canvas.tool.path",
	image: "canvas.tool.image",
	hand: "canvas.tool.hand",
	"ai-image": "canvas.tool.aiImage",
	"ai-brush": "canvas.tool.aiBrush",
};
