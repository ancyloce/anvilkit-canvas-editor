import { createStore, type StoreApi } from "zustand/vanilla";

/**
 * Roving keyboard-focus state for the canvas (a11y), distinct from selection: a
 * node can be focused (navigated to) without being selected. Mirrors the
 * vanilla-store pattern of the other editor stores.
 */
export interface CanvasFocusState {
	focusedId: string | null;
	setFocus: (id: string | null) => void;
	isFocused: (id: string) => boolean;
}

export type CanvasFocusStoreApi = StoreApi<CanvasFocusState>;

export function createFocusStore(): CanvasFocusStoreApi {
	return createStore<CanvasFocusState>()((set, get) => ({
		focusedId: null,
		setFocus(id) {
			set({ focusedId: id });
		},
		isFocused(id) {
			return get().focusedId === id;
		},
	}));
}
