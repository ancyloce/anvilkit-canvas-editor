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

/**
 * Plain data slice of {@link WorkspaceUiState} — action methods stripped.
 * Public export (PRD §11.1) for `CanvasWorkspaceProps.initialWorkspaceState`,
 * a host seed for a freshly-mounted workspace (FR-002 territory: distinct
 * from `restoreLayout()`'s hardcoded default — see
 * {@link CreateWorkspaceUiStoreOptions.initialWorkspaceState}).
 */
export type CanvasWorkspaceState = Omit<
	WorkspaceUiState,
	| "setActiveDockId"
	| "addRecentTemplate"
	| "setPanelOpen"
	| "setInspectorCollapsed"
	| "setPanelWidth"
	| "restoreLayout"
	| "setPanelSearch"
	| "reset"
>;

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

/**
 * Resolve a host-supplied {@link CanvasWorkspaceState} seed into a full data
 * slice, sanitized the same way a persisted `localStorage` payload is
 * (reuses {@link migratePersistedState} for the 4 PERSISTED fields — clamped
 * `panelWidth`, capped `recentTemplateIds`, validated `activeDockId` — rather
 * than duplicating that coercion). The 2 transient fields
 * (`panelOpen`/`panelSearch`) aren't covered by `migratePersistedState`
 * (never persisted), so they're merged in directly.
 */
function initialStateFrom(
	initialWorkspaceState: Partial<CanvasWorkspaceState> | undefined,
): CanvasWorkspaceState {
	const persistedSlice = migratePersistedState(
		initialWorkspaceState ?? {},
	) as WorkspaceUiPersistedSlice;
	return {
		...persistedSlice,
		panelOpen: initialWorkspaceState?.panelOpen ?? INITIAL_STATE.panelOpen,
		panelSearch:
			initialWorkspaceState?.panelSearch ?? INITIAL_STATE.panelSearch,
	};
}

export interface CreateWorkspaceUiStoreOptions {
	readonly storeId: string;
	/**
	 * PRD §11.1 seed for a host embedding a FRESH workspace (`storeId` with no
	 * prior `localStorage` value).
	 *
	 * Precedence: this seed is the store's baseline; persist's own rehydrate
	 * `merge` (below) always lets an EXISTING persisted value win over it for
	 * the 4 persisted fields (`activeDockId`/`inspectorCollapsed`/
	 * `panelWidth`/`recentTemplateIds`) — so a returning user's saved layout
	 * is never clobbered by a host's seed. The 2 transient fields
	 * (`panelOpen`/`panelSearch`) are never persisted, so this seed (or the
	 * hardcoded default) always applies for them. This is an ADDITIONAL seam:
	 * `restoreLayout()` (FR-002 "restore default layout") still resets to the
	 * hardcoded {@link INITIAL_STATE}, never to this seed.
	 */
	readonly initialWorkspaceState?: Partial<CanvasWorkspaceState>;
}

export type WorkspaceUiStoreApi = StoreApi<WorkspaceUiState>;

/**
 * Build a fresh per-instance store. The persistence key is namespaced by
 * `storeId` so concurrent stores never collide in `localStorage`.
 */
export function createWorkspaceUiStore(
	options: CreateWorkspaceUiStoreOptions,
): WorkspaceUiStoreApi {
	const { storeId, initialWorkspaceState } = options;
	const seed = initialStateFrom(initialWorkspaceState);
	return createStore<WorkspaceUiState>()(
		persist(
			(set) => ({
				...seed,
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
				//
				// zustand calls `merge` on EVERY hydrate, even for a `storeId` with
				// NOTHING ever persisted (`persisted` is `undefined` then) — only
				// sanitize/apply it when something was actually stored; otherwise
				// `current` already carries this store's `seed` (`initialWorkspaceState`,
				// defaulting to `INITIAL_STATE`), which nothing here should clobber.
				merge: (persisted, current) => ({
					...current,
					...(persisted !== undefined
						? (migratePersistedState(persisted) as WorkspaceUiPersistedSlice)
						: {}),
				}),
			},
		),
	);
}
