import { createStore, type StoreApi } from "zustand/vanilla";

export const DEFAULT_GRID_SIZE = 8;

export interface ViewportState {
	zoom: number;
	panX: number;
	panY: number;
	gridEnabled: boolean;
	gridSize: number;
	snapToObjectsEnabled: boolean;
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
	setSnapToObjectsEnabled: (enabled: boolean) => void;
	setViewportSize: (size: { width: number; height: number } | null) => void;
}

export type ViewportStoreApi = StoreApi<ViewportState>;

export interface CreateViewportStoreOptions {
	zoom?: number;
	panX?: number;
	panY?: number;
	gridEnabled?: boolean;
	gridSize?: number;
	snapToObjectsEnabled?: boolean;
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
		snapToObjectsEnabled: options.snapToObjectsEnabled ?? true,
		viewportSize: null,
		setZoom(zoom) {
			set({ zoom });
		},
		setPan(panX, panY) {
			set({ panX, panY });
		},
		setGridEnabled(enabled) {
			set({ gridEnabled: enabled });
		},
		setGridSize(size) {
			set({ gridSize: size });
		},
		setViewportSize(size) {
			set({ viewportSize: size });
		},
		setSnapToObjectsEnabled(enabled) {
			set({ snapToObjectsEnabled: enabled });
		},
	}));
}
