import { createStore, type StoreApi } from "zustand/vanilla";

/** FR-003/FR-161 save states (B-08). */
export type CanvasSaveState =
	| "clean"
	| "dirty"
	| "saving"
	| "saved"
	| "error"
	| "offline";

export interface SaveStatusState {
	status: CanvasSaveState;
	/** ISO timestamp of the last successful save, when any. */
	lastSavedAt: string | null;
	/** Message from the last failed save attempt, cleared on success. */
	lastError: string | null;
	setStatus: (status: CanvasSaveState) => void;
	recordSaved: (at: string) => void;
	recordError: (message: string) => void;
}

export type SaveStatusStoreApi = StoreApi<SaveStatusState>;

export function createSaveStatusStore(): SaveStatusStoreApi {
	return createStore<SaveStatusState>()((set) => ({
		status: "clean",
		lastSavedAt: null,
		lastError: null,
		setStatus(status) {
			set({ status });
		},
		recordSaved(at) {
			set({ status: "saved", lastSavedAt: at, lastError: null });
		},
		recordError(message) {
			set({ status: "error", lastError: message });
		},
	}));
}
