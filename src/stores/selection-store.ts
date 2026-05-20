import { createStore, type StoreApi } from "zustand/vanilla";

export interface SelectionState {
	selectedIds: string[];
	setSelection: (ids: readonly string[]) => void;
	addToSelection: (id: string) => void;
	removeFromSelection: (id: string) => void;
	toggleSelection: (id: string) => void;
	clearSelection: () => void;
	isSelected: (id: string) => boolean;
}

export type SelectionStoreApi = StoreApi<SelectionState>;

function unique(ids: readonly string[]): string[] {
	return Array.from(new Set(ids));
}

export function createSelectionStore(): SelectionStoreApi {
	return createStore<SelectionState>()((set, get) => ({
		selectedIds: [],
		setSelection(ids) {
			set({ selectedIds: unique(ids) });
		},
		addToSelection(id) {
			set((s) =>
				s.selectedIds.includes(id)
					? s
					: { selectedIds: [...s.selectedIds, id] },
			);
		},
		removeFromSelection(id) {
			set((s) => ({ selectedIds: s.selectedIds.filter((x) => x !== id) }));
		},
		toggleSelection(id) {
			set((s) =>
				s.selectedIds.includes(id)
					? { selectedIds: s.selectedIds.filter((x) => x !== id) }
					: { selectedIds: [...s.selectedIds, id] },
			);
		},
		clearSelection() {
			set({ selectedIds: [] });
		},
		isSelected(id) {
			return get().selectedIds.includes(id);
		},
	}));
}
