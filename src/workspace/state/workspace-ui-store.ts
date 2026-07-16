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
 * - `panelWidth` — Tab Panel sidebar width in px (B-14, resizable + persisted).
 * - `panelSearch` — current Tab Panel search query (transient, not persisted).
 */

import { persist } from "zustand/middleware";
import { createStore, type StoreApi } from "zustand/vanilla";
import { DOCK_IDS, type DockId, HIDDEN_DOCK_IDS } from "../dock-ids.js";

export interface WorkspaceUiState {
	readonly activeDockId: DockId;
	readonly inspectorCollapsed: boolean;
	readonly panelWidth: number;
	/**
	 * Whether the Tab Panel is shown. Transient (not persisted). Desktop
	 * ignores it; the ≤768px overlay layout (B-14) opens/closes the floating
	 * panel with it, and re-clicking the active dock item toggles it.
	 */
	readonly panelOpen: boolean;
	readonly panelSearch: string;
	/** FR-130 recently-used templates (C-06), most recent first, capped. Persisted. */
	readonly recentTemplateIds: readonly string[];
	setActiveDockId(id: DockId): void;
	/** Record a template application; moves an existing id to the front. */
	addRecentTemplate(id: string): void;
	setPanelOpen(open: boolean): void;
	setInspectorCollapsed(collapsed: boolean): void;
	/** Clamped to [{@link PANEL_WIDTH_MIN}, {@link PANEL_WIDTH_MAX}] (B-14). */
	setPanelWidth(width: number): void;
	/** FR-130 restore-default-layout: dock tab, inspector, panel width (B-14). */
	restoreLayout(): void;
	setPanelSearch(query: string): void;
	reset(): void;
}

export const PANEL_WIDTH_MIN = 200;
export const PANEL_WIDTH_MAX = 420;
export const PANEL_WIDTH_DEFAULT = 280;

const clampPanelWidth = (w: number): number =>
	Math.min(PANEL_WIDTH_MAX, Math.max(PANEL_WIDTH_MIN, Math.round(w)));

/** Cap for {@link WorkspaceUiState.recentTemplateIds}. */
export const RECENT_TEMPLATES_MAX = 8;

const INITIAL_STATE = {
	activeDockId: "templates" as DockId,
	inspectorCollapsed: false,
	panelWidth: PANEL_WIDTH_DEFAULT,
	panelOpen: true,
	panelSearch: "",
	recentTemplateIds: [] as readonly string[],
} as const;

/**
 * Persisted slice — declared explicitly so a field rename fails to compile
 * here instead of silently dropping a persisted value. `panelSearch` is
 * dropped on purpose (transient input, like the Studio store's `drawerSearch`).
 */
interface WorkspaceUiPersistedSlice {
	readonly activeDockId: DockId;
	readonly inspectorCollapsed: boolean;
	readonly panelWidth: number;
	readonly recentTemplateIds: readonly string[];
}

/**
 * v2 (B-14): adds `panelWidth`; v1 payloads migrate with the default.
 * v3 (C-06): adds `recentTemplateIds`; older payloads migrate with `[]`.
 */
export const WORKSPACE_UI_STORE_PERSIST_VERSION = 3;

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
		panelWidth:
			typeof source.panelWidth === "number" &&
			Number.isFinite(source.panelWidth)
				? clampPanelWidth(source.panelWidth)
				: INITIAL_STATE.panelWidth,
		recentTemplateIds: Array.isArray(source.recentTemplateIds)
			? source.recentTemplateIds
					.filter((id): id is string => typeof id === "string")
					.slice(0, RECENT_TEMPLATES_MAX)
			: INITIAL_STATE.recentTemplateIds,
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
				setPanelOpen(panelOpen) {
					set({ panelOpen });
				},
				setInspectorCollapsed(inspectorCollapsed) {
					set({ inspectorCollapsed });
				},
				setPanelWidth(width) {
					set({ panelWidth: clampPanelWidth(width) });
				},
				restoreLayout() {
					set({
						activeDockId: INITIAL_STATE.activeDockId,
						inspectorCollapsed: INITIAL_STATE.inspectorCollapsed,
						panelWidth: INITIAL_STATE.panelWidth,
					});
				},
				setPanelSearch(panelSearch) {
					set({ panelSearch });
				},
				addRecentTemplate(id) {
					set((state) => ({
						recentTemplateIds: [
							id,
							...state.recentTemplateIds.filter((r) => r !== id),
						].slice(0, RECENT_TEMPLATES_MAX),
					}));
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
					panelWidth: state.panelWidth,
					recentTemplateIds: state.recentTemplateIds,
				}),
				migrate: migratePersistedState,
				// `migrate` only runs for OLD versions; `merge` sanitizes every
				// rehydrate, so a hand-edited/corrupt same-version payload (e.g. an
				// out-of-range width) is coerced instead of trusted (B-14).
				merge: (persisted, current) => ({
					...current,
					...(migratePersistedState(persisted) as WorkspaceUiPersistedSlice),
				}),
			},
		),
	);
}
