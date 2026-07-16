import { createStore, type StoreApi } from "zustand/vanilla";

/**
 * How an export invocation was scoped by its entry point (FR-031 "Export
 * selection", FR-032 "Export page", FR-152 page scopes). The export dialog
 * preselects this scope when it opens.
 */
export interface CanvasExportUiRequest {
	readonly scope: "current" | "all" | "pages" | "selection";
	/** Page ids for scope `"pages"`. */
	readonly pageIds?: readonly string[];
}

/**
 * Channel between export entry points (context menus, page menu) and the
 * export UI mounted by `createCanvasExportPlugin` (FR-031/FR-032). The plugin
 * flips `available` while its trigger is mounted so menus can disable their
 * export entries instead of silently no-oping when no export UI exists.
 */
export interface ExportRequestState {
	available: boolean;
	pending: CanvasExportUiRequest | null;
	setAvailable: (available: boolean) => void;
	request: (req: CanvasExportUiRequest) => void;
	consume: () => CanvasExportUiRequest | null;
}

export type ExportRequestStoreApi = StoreApi<ExportRequestState>;

export function createExportRequestStore(): ExportRequestStoreApi {
	return createStore<ExportRequestState>()((set, get) => ({
		available: false,
		pending: null,
		setAvailable(available) {
			set({ available });
		},
		request(req) {
			set({ pending: req });
		},
		consume() {
			const { pending } = get();
			if (pending) set({ pending: null });
			return pending;
		},
	}));
}
