import { createStore, type StoreApi } from "zustand/vanilla";

/**
 * Tracks which page in the IR is currently active in the editor. The IR's
 * `pages` array is the source of truth for the page list itself — this store
 * only owns the UI selection. Mutations to the IR's page list flow through
 * `historyStore.commit(...)` with page commands (`page.create`,
 * `page.delete`, `page.reorder`); helpers in `src/pages/page-actions.ts`
 * coordinate the two.
 */
export interface PagesState {
	activePageId: string;
	setActivePageId: (id: string) => void;
}

export type PagesStoreApi = StoreApi<PagesState>;

export interface CreatePagesStoreOptions {
	initialActivePageId: string;
}

export function createPagesStore(
	options: CreatePagesStoreOptions,
): PagesStoreApi {
	return createStore<PagesState>()((set) => ({
		activePageId: options.initialActivePageId,
		setActivePageId(id) {
			set({ activePageId: id });
		},
	}));
}
