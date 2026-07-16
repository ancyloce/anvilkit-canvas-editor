import { createStore, type StoreApi } from "zustand/vanilla";

/**
 * Channel for the node context menu's "Rename layer" (FR-031): the menu posts
 * the target node id here and the mounted {@link LayerPanel} consumes it to
 * enter inline rename on that row (revealing it first). Keeping the request in
 * a store — rather than threading a callback — means the two surfaces stay
 * decoupled and the menu works even when the panel re-renders. UI state only.
 */
export interface LayerRenameState {
	requestId: string | null;
	request: (nodeId: string) => void;
	consume: () => string | null;
}

export type LayerRenameStoreApi = StoreApi<LayerRenameState>;

export function createLayerRenameStore(): LayerRenameStoreApi {
	return createStore<LayerRenameState>()((set, get) => ({
		requestId: null,
		request(nodeId) {
			set({ requestId: nodeId });
		},
		consume() {
			const { requestId } = get();
			if (requestId) set({ requestId: null });
			return requestId;
		},
	}));
}
