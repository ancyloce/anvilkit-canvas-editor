import { createStore, type StoreApi } from "zustand/vanilla";

/**
 * PRD FR-009: seven canvas tools. `select` is the default; draw tools commit
 * `node.create` on pointerup; `hand` pans the viewport and never touches IR.
 */
export type ToolId =
	| "select"
	| "text"
	| "rect"
	| "ellipse"
	| "line"
	| "image"
	| "hand";

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
