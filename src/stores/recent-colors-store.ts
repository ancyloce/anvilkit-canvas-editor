import { createStore, type StoreApi } from "zustand/vanilla";

/** How many recent colors to keep (FR-074 recent-colors strip). */
const MAX_RECENT_COLORS = 8;

/**
 * Session-scoped most-recently-used fill/stroke colors (FR-074). UI state
 * only — never enters Canvas IR. A single module-level store is intentional:
 * "recent colors" is a per-user affordance, not per-document, and every
 * inspector color field feeds and reads the same list.
 */
export interface RecentColorsState {
	colors: string[];
	add: (color: string) => void;
}

export type RecentColorsStoreApi = StoreApi<RecentColorsState>;

export function createRecentColorsStore(): RecentColorsStoreApi {
	return createStore<RecentColorsState>()((set) => ({
		colors: [],
		add(color) {
			const normalized = color.trim().toLowerCase();
			if (normalized.length === 0) return;
			set((s) => ({
				colors: [normalized, ...s.colors.filter((c) => c !== normalized)].slice(
					0,
					MAX_RECENT_COLORS,
				),
			}));
		},
	}));
}

/** The shared session store (see the interface note on why it's module-level). */
export const recentColorsStore: RecentColorsStoreApi =
	createRecentColorsStore();
