import { aiBrushTool } from "./ai-brush-tool.js";
import { aiImageTool } from "./ai-image-tool.js";
import { ellipseTool } from "./ellipse-tool.js";
import { frameTool } from "./frame-tool.js";
import { handTool } from "./hand-tool.js";
import { imageTool } from "./image-tool.js";
import { lineTool } from "./line-tool.js";
import { penTool } from "./pen-tool.js";
import { rectTool } from "./rect-tool.js";
import { selectTool } from "./select-tool.js";
import { textTool } from "./text-tool.js";
import type { Tool, ToolRegistry } from "./tool-types.js";

/**
 * Default tool registry — the PRD FR-009 tools wired. The AI tools
 * (`ai-image`, `ai-brush`) emit intents to the host rather than committing IR.
 */
export const defaultToolRegistry: ToolRegistry = {
	select: selectTool,
	frame: frameTool,
	rect: rectTool,
	ellipse: ellipseTool,
	line: lineTool,
	path: penTool,
	text: textTool,
	image: imageTool,
	hand: handTool,
	"ai-image": aiImageTool,
	"ai-brush": aiBrushTool,
};

export function buildToolRegistry(tools: Tool[]): ToolRegistry {
	const registry: ToolRegistry = {};
	for (const tool of tools) {
		registry[tool.id] = tool;
	}
	return registry;
}
