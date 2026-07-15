/**
 * @file Per-instance Canva-shell UI store.
 *
 * Mirrors `packages/core/src/react/studio/state/editor-ui-store.ts`: each
 * `<CanvasWorkspace>` mount gets its own Zustand vanilla store (so two editors
 * on one page never share UI state), reached via `WorkspaceUiStoreProvider`.
 *
 * Unlike the SSR-capable Studio store, the canvas editor is client-only
 * (`next/dynamic({ ssr: false })`), so `persist` auto-hydrates from
 * `localStorage` at creation — no `skipHydration`/deferred-rehydrate dance.
 *
 * ### State slice
 * - `activeDockId` — selected Panel Dock entry (one of {@link DockId}).
 * - `inspectorCollapsed` — right `PropertyInspector` collapsed flag.
 * - `panelSearch` — current Tab Panel search query (transient, not persisted).
 */

import { persist } from "zustand/middleware";
import { createStore, type StoreApi } from "zustand/vanilla";
import { DOCK_IDS, type DockId, HIDDEN_DOCK_IDS } from "../dock-ids.js";

export interface WorkspaceUiState {
	readonly activeDockId: DockId;
	readonly inspectorCollapsed: boolean;
	readonly panelSearch: string;
	setActiveDockId(id: DockId): void;
	setInspectorCollapsed(collapsed: boolean): void;
	setPanelSearch(query: string): void;
	reset(): void;
}

const INITIAL_STATE = {
	activeDockId: "templates" as DockId,
	inspectorCollapsed: false,
	panelSearch: "",
} as const;

/**
 * Persisted slice — declared explicitly so a field rename fails to compile
 * here instead of silently dropping a persisted value. `panelSearch` is
 * dropped on purpose (transient input, like the Studio store's `drawerSearch`).
 */
interface WorkspaceUiPersistedSlice {
	readonly activeDockId: DockId;
	readonly inspectorCollapsed: boolean;
}

export const WORKSPACE_UI_STORE_PERSIST_VERSION = 1;

// Hidden stub docks (M0-08) are excluded so a persisted selection of a
// now-hidden tab falls back to the default instead of activating an
// invisible panel.
const VALID_DOCK_IDS: ReadonlySet<DockId> = new Set(
	DOCK_IDS.filter((id) => !HIDDEN_DOCK_IDS.has(id)),
);

/**
 * Coerce a possibly-stale persisted payload back into a valid slice — an
 * unknown `activeDockId` (e.g. a removed dock) falls back to the default.
 */
function migratePersistedState(persisted: unknown): unknown {
	if (persisted === null || typeof persisted !== "object") {
		return INITIAL_STATE;
	}
	const source = persisted as Record<string, unknown>;
	const activeDockId: DockId =
		typeof source.activeDockId === "string" &&
		VALID_DOCK_IDS.has(source.activeDockId as DockId)
			? (source.activeDockId as DockId)
			: INITIAL_STATE.activeDockId;
	return {
		activeDockId,
		inspectorCollapsed:
			typeof source.inspectorCollapsed === "boolean"
				? source.inspectorCollapsed
				: INITIAL_STATE.inspectorCollapsed,
	} satisfies WorkspaceUiPersistedSlice;
}

export interface CreateWorkspaceUiStoreOptions {
	readonly storeId: string;
}

export type WorkspaceUiStoreApi = StoreApi<WorkspaceUiState>;

/**
 * Build a fresh per-instance store. The persistence key is namespaced by
 * `storeId` so concurrent stores never collide in `localStorage`.
 */
export function createWorkspaceUiStore(
	options: CreateWorkspaceUiStoreOptions,
): WorkspaceUiStoreApi {
	const { storeId } = options;
	return createStore<WorkspaceUiState>()(
		persist(
			(set) => ({
				...INITIAL_STATE,
				setActiveDockId(activeDockId) {
					set({ activeDockId });
				},
				setInspectorCollapsed(inspectorCollapsed) {
					set({ inspectorCollapsed });
				},
				setPanelSearch(panelSearch) {
					set({ panelSearch });
				},
				reset() {
					set({ ...INITIAL_STATE });
				},
			}),
			{
				name: `anvilkit-canvas-workspace-${storeId}`,
				version: WORKSPACE_UI_STORE_PERSIST_VERSION,
				partialize: (state): WorkspaceUiPersistedSlice => ({
					activeDockId: state.activeDockId,
					inspectorCollapsed: state.inspectorCollapsed,
				}),
				migrate: migratePersistedState,
			},
		),
	);
}
