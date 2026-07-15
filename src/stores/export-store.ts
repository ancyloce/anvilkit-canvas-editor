import { createStore, type StoreApi } from "zustand/vanilla";

/** FR-154 export lifecycle phases (B-09). */
export type CanvasExportPhase =
	| "idle"
	| "preparing"
	| "rendering"
	| "packaging"
	| "completed"
	| "failed"
	| "cancelled";

export interface ExportProgress {
	done: number;
	total: number;
}

export interface ExportState {
	phase: CanvasExportPhase;
	progress: ExportProgress | null;
	error: string | null;
	cancelRequested: boolean;
	begin: (total: number) => void;
	advance: () => void;
	complete: () => void;
	fail: (message: string) => void;
	requestCancel: () => void;
	markCancelled: () => void;
	reset: () => void;
}

export type ExportStoreApi = StoreApi<ExportState>;

export function createExportStore(): ExportStoreApi {
	return createStore<ExportState>()((set) => ({
		phase: "idle",
		progress: null,
		error: null,
		cancelRequested: false,
		begin(total) {
			set({
				phase: total > 1 ? "rendering" : "preparing",
				progress: { done: 0, total },
				error: null,
				cancelRequested: false,
			});
		},
		advance() {
			set((s) =>
				s.progress
					? {
							phase: "rendering",
							progress: { ...s.progress, done: s.progress.done + 1 },
						}
					: s,
			);
		},
		complete() {
			set({ phase: "completed", cancelRequested: false });
		},
		fail(message) {
			set({ phase: "failed", error: message, cancelRequested: false });
		},
		requestCancel() {
			set({ cancelRequested: true });
		},
		markCancelled() {
			set({ phase: "cancelled", cancelRequested: false });
		},
		reset() {
			set({
				phase: "idle",
				progress: null,
				error: null,
				cancelRequested: false,
			});
		},
	}));
}
