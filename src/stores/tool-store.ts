import { createStore, type StoreApi } from "zustand/vanilla";

/**
 * PRD FR-009: nine canvas tools. `select` is the default; draw tools commit
 * `node.create` on pointerup; `hand` pans the viewport and never touches IR.
 * The AI tools (`ai-image`, `ai-brush`) commit nothing — they capture a gesture
 * and emit an {@link ../tools/ai-intent.js#AiToolIntent} to the host.
 */
/** Built-in tool ids (PRD FR-009). */
export type BuiltinToolId =
	| "select"
	| "text"
	| "frame"
	| "rect"
	| "ellipse"
	| "line"
	| "path"
	| "image"
	| "hand"
	| "ai-image"
	| "ai-brush";

/**
 * A tool id. Built-in ids keep literal autocomplete; `(string & {})` admits
 * custom tool ids contributed by an editor extension (Area 1).
 */
export type ToolId = BuiltinToolId | (string & {});

export const DEFAULT_TOOL: ToolId = "select";

export interface ToolState {
	activeTool: ToolId;
	setActiveTool: (tool: ToolId) => void;
}

export type ToolStoreApi = StoreApi<ToolState>;

export interface CreateToolStoreOptions {
	initialTool?: ToolId;
}

export function createToolStore(
	options: CreateToolStoreOptions = {},
): ToolStoreApi {
	return createStore<ToolState>()((set) => ({
		activeTool: options.initialTool ?? DEFAULT_TOOL,
		setActiveTool(tool) {
			set({ activeTool: tool });
		},
	}));
}
