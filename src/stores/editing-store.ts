import { createStore, type StoreApi } from "zustand/vanilla";

/**
 * Tracks which IR node is currently being edited in-place (text overlay for
 * MVP-6 Task 7; could extend for future inline editors). Null when no editor
 * is open.
 */
export interface EditingState {
	editingNodeId: string | null;
	setEditing: (id: string) => void;
	clearEditing: () => void;
}

export type EditingStoreApi = StoreApi<EditingState>;

export function createEditingStore(): EditingStoreApi {
	return createStore<EditingState>()((set) => ({
		editingNodeId: null,
		setEditing(id) {
			set({ editingNodeId: id });
		},
		clearEditing() {
			set({ editingNodeId: null });
		},
	}));
}
