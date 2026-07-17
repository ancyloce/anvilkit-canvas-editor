export {
	useActiveDock,
	useInspectorCollapsed,
	usePanelSearch,
	useWorkspaceUiStore,
} from "./hooks.js";
export {
	useWorkspaceUiStoreApi,
	WorkspaceUiStoreProvider,
	type WorkspaceUiStoreProviderProps,
} from "./WorkspaceUiStoreProvider.js";
export {
	type CanvasWorkspaceState,
	type CreateWorkspaceUiStoreOptions,
	createWorkspaceUiStore,
	WORKSPACE_UI_STORE_PERSIST_VERSION,
	type WorkspaceUiState,
	type WorkspaceUiStoreApi,
} from "./workspace-ui-store.js";
