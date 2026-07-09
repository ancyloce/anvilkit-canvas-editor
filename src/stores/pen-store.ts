import { createStore, type StoreApi } from "zustand/vanilla";

/**
 * One pen-tool anchor in world coordinates. `(hx, hy)` is the *outgoing* bezier
 * control handle (absolute world point); the incoming handle is its mirror
 * about `(x, y)`. When the handle equals the anchor the adjoining segments are
 * straight lines.
 */
export interface PenAnchor {
	x: number;
	y: number;
	hx: number;
	hy: number;
}

/**
 * Multi-click state for the in-progress pen path (I3-2). Unlike `DraftStore`
 * this persists across pointerup (anchors accumulate click-by-click); it is
 * reset on commit, cancel, and tool change. The single `node.create` fires only
 * when the path is closed/finalized (MVP-7).
 */
export interface PenState {
	anchors: PenAnchor[];
	addAnchor: (anchor: PenAnchor) => void;
	/** Set the outgoing handle of the most-recently-added anchor (drag-out). */
	updateLastHandle: (hx: number, hy: number) => void;
	reset: () => void;
}

export type PenStoreApi = StoreApi<PenState>;

export function createPenStore(): PenStoreApi {
	return createStore<PenState>()((set) => ({
		anchors: [],
		addAnchor(anchor) {
			set((state) => ({ anchors: [...state.anchors, anchor] }));
		},
		updateLastHandle(hx, hy) {
			set((state) => {
				if (state.anchors.length === 0) return state;
				const anchors = state.anchors.slice();
				const last = anchors[anchors.length - 1];
				if (!last) return state;
				anchors[anchors.length - 1] = { ...last, hx, hy };
				return { anchors };
			});
		},
		reset() {
			set({ anchors: [] });
		},
	}));
}
