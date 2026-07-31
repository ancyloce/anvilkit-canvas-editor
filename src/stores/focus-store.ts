import { createStore, type StoreApi } from "zustand/vanilla";

/**
 * Roving keyboard-focus state for the canvas (a11y), distinct from selection: a
 * node can be focused (navigated to) without being selected. Mirrors the
 * vanilla-store pattern of the other editor stores.
 *
 * ### Decision D-4 (plan 0023 M5-07)
 *
 * `focusedId` holds EITHER a persistent node id or a `CanvasResolvedNodeId` —
 * the resolved id of a component's virtual node. Keeping it persistent-only
 * would leave every virtual node keyboard-unreachable and fail NFR-004 outright,
 * so D-4 widens it. No type change was needed: `CanvasResolvedNodeId` is a
 * branded `string`, so it already satisfies `string | null` — the widening is a
 * CONTRACT change, and this note is the contract. Consumers must therefore treat
 * `focusedId` as opaque: it is not safe to feed into a command payload without
 * first mapping it through `selection/component-selection-policy.ts`, which is
 * what resolves a virtual id to the persistent instance that owns it.
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
