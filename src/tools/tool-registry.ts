import type { Tool, ToolRegistry } from "./tool-types.js";

/**
 * Default tool registry. Each MVP-6 task adds its tool here.
 * Tasks 4–9 populate this object as their tools land.
 */
export const defaultToolRegistry: ToolRegistry = {};

export function buildToolRegistry(tools: Tool[]): ToolRegistry {
	const registry: ToolRegistry = {};
	for (const tool of tools) {
		registry[tool.id] = tool;
	}
	return registry;
}
