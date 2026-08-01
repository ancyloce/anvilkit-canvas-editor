import { createStore, type StoreApi } from "zustand/vanilla";
import { DEFAULT_SNAP_THRESHOLD } from "../snap/snap-engine.js";

export const DEFAULT_GRID_SIZE = 8;

/**
 * Konva colors for the FR-112 grid chrome. Canvas shapes take literal hex
 * colors (same posture as `RULER_GUIDE_COLOR` in `GuideLayoutOverlay`); these
 * are chrome-only and never serialize into exports. Subtle neutrals so the
 * default grid reads as an aid, not content.
 */
export const DEFAULT_GRID_COLOR = "#c7cdd6";
export const DEFAULT_SUB_GRID_COLOR = "#e2e6eb";

export interface ViewportState {
	zoom: number;
	panX: number;
	panY: number;
	/** Whether the grid is DRAWN (FR-112). Visibility only — see
	 * {@link ViewportState.snapToGridEnabled} for the snap gate. */
	gridEnabled: boolean;
	gridSize: number;
	/**
	 * Sub-grid divisions per main grid cell (FR-112). `0`/`1` = no sub-grid;
	 * `N > 1` divides each `gridSize` cell into N sub-cells.
	 */
	gridSubdivisions: number;
	/** Main grid line color (literal hex — Konva chrome, never exported). */
	gridColor: string;
	/** Sub-grid line color (literal hex — Konva chrome, never exported). */
	subGridColor: string;
	/**
	 * Whether tools snap to the grid (FR-112). Independent of
	 * {@link ViewportState.gridEnabled}: pre-FR-112 grid snap fired whenever the
	 * grid was VISIBLE; it defaults to `true` so snapping stays on out of the
	 * box (now even while the grid is hidden), and users switch it off
	 * explicitly via the canvas context menu / grid settings dialog.
	 */
	snapToGridEnabled: boolean;
	snapToObjectsEnabled: boolean;
	/**
	 * Max world-space distance for an edge snap, forwarded to `computeSnap`
	 * (FR-112). Defaults to the engine's `DEFAULT_SNAP_THRESHOLD` so the store
	 * and the engine cannot drift.
	 */
	snapThreshold: number;
	/**
	 * Measured size of the canvas scroll viewport (A-07). Mirrored in by
	 * `PagesCanvas`'s ResizeObserver so zoom-to-fit/zoom-to-selection actions
	 * stay DOM-free. Null until first measurement.
	 */
	viewportSize: { width: number; height: number } | null;
	setZoom: (zoom: number) => void;
	setPan: (panX: number, panY: number) => void;
	setGridEnabled: (enabled: boolean) => void;
	setGridSize: (size: number) => void;
	setGridSubdivisions: (subdivisions: number) => void;
	setGridColor: (color: string) => void;
	setSubGridColor: (color: string) => void;
	setSnapToGridEnabled: (enabled: boolean) => void;
	setSnapToObjectsEnabled: (enabled: boolean) => void;
	setSnapThreshold: (threshold: number) => void;
	setViewportSize: (size: { width: number; height: number } | null) => void;
}

export type ViewportStoreApi = StoreApi<ViewportState>;

export interface CreateViewportStoreOptions {
	zoom?: number;
	panX?: number;
	panY?: number;
	gridEnabled?: boolean;
	gridSize?: number;
	gridSubdivisions?: number;
	gridColor?: string;
	subGridColor?: string;
	snapToGridEnabled?: boolean;
	snapToObjectsEnabled?: boolean;
	snapThreshold?: number;
}

export function createViewportStore(
	options: CreateViewportStoreOptions = {},
): ViewportStoreApi {
	return createStore<ViewportState>()((set) => ({
		zoom: options.zoom ?? 1,
		panX: options.panX ?? 0,
		panY: options.panY ?? 0,
		gridEnabled: options.gridEnabled ?? true,
		gridSize: options.gridSize ?? DEFAULT_GRID_SIZE,
		gridSubdivisions: options.gridSubdivisions ?? 0,
		gridColor: options.gridColor ?? DEFAULT_GRID_COLOR,
		subGridColor: options.subGridColor ?? DEFAULT_SUB_GRID_COLOR,
		snapToGridEnabled: options.snapToGridEnabled ?? true,
		snapToObjectsEnabled: options.snapToObjectsEnabled ?? true,
		snapThreshold: options.snapThreshold ?? DEFAULT_SNAP_THRESHOLD,
		viewportSize: null,
		// Zoom and pan become the Konva STAGE's scale and position, i.e. part of
		// every node's absolute transform. A non-finite zoom is therefore the
		// widest-reach corruption in the editor: `Transform.decompose()` turns a
		// `NaN` matrix into a `NaN` rotation, and `Transformer.nodes()` writes
		// that straight onto itself — so one bad zoom makes EVERY selection log
		// `Konva warning: NaN is a not valid value for "rotation" attribute`
		// until the page is reloaded. Every producer is a division by a page or
		// viewport dimension (`zoomToFit`, the fit-on-entry effect, wheel zoom),
		// and `clampZoom` cannot sanitise it — `Math.min`/`Math.max` propagate
		// `NaN`. Dropping the update is better than clamping to a fallback: the
		// view stays where the user left it instead of jumping.
		setZoom(zoom) {
			if (!Number.isFinite(zoom)) return;
			set({ zoom });
		},
		setPan(panX, panY) {
			if (!Number.isFinite(panX) || !Number.isFinite(panY)) return;
			set({ panX, panY });
		},
		setGridEnabled(enabled) {
			set({ gridEnabled: enabled });
		},
		setGridSize(size) {
			set({ gridSize: size });
		},
		setGridSubdivisions(subdivisions) {
			set({ gridSubdivisions: subdivisions });
		},
		setGridColor(color) {
			set({ gridColor: color });
		},
		setSubGridColor(color) {
			set({ subGridColor: color });
		},
		setSnapToGridEnabled(enabled) {
			set({ snapToGridEnabled: enabled });
		},
		setSnapThreshold(threshold) {
			set({ snapThreshold: threshold });
		},
		setViewportSize(size) {
			set({ viewportSize: size });
		},
		setSnapToObjectsEnabled(enabled) {
			set({ snapToObjectsEnabled: enabled });
		},
	}));
}
