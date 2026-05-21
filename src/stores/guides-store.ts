import { createStore, type StoreApi } from "zustand/vanilla";
import type { SmartGuide } from "../snap/snap-types.js";

export interface GuidesState {
	guides: readonly SmartGuide[];
	setGuides: (guides: readonly SmartGuide[]) => void;
	clearGuides: () => void;
}

export type GuidesStoreApi = StoreApi<GuidesState>;

const EMPTY: readonly SmartGuide[] = [];

export function createGuidesStore(): GuidesStoreApi {
	return createStore<GuidesState>()((set) => ({
		guides: EMPTY,
		setGuides(guides) {
			set({ guides });
		},
		clearGuides() {
			set({ guides: EMPTY });
		},
	}));
}
