import { createStore, type StoreApi } from "zustand/vanilla";

/**
 * Tracks which path node is in on-stage point-editing mode (I3-2). Null when no
 * path editor is open. The {@link PathEditOverlay} reads this to render the
 * anchor/control handles for that node.
 */
export interface PathEditState {
	editNodeId: string | null;
	begin: (id: string) => void;
	clear: () => void;
}

export type PathEditStoreApi = StoreApi<PathEditState>;

export function createPathEditStore(): PathEditStoreApi {
	return createStore<PathEditState>()((set) => ({
		editNodeId: null,
		begin(id) {
			set({ editNodeId: id });
		},
		clear() {
			set({ editNodeId: null });
		},
	}));
}
