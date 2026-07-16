import type {
	CanvasClipboardPayload,
	CanvasNodeStyle,
} from "@anvilkit/canvas-core";
import { createStore, type StoreApi } from "zustand/vanilla";

export interface ClipboardState {
	payload: CanvasClipboardPayload | null;
	/** FR-120 copied style (C-05) — an independent slot; copying nodes does not clear it. */
	style: CanvasNodeStyle | null;
	setPayload: (payload: CanvasClipboardPayload | null) => void;
	setStyle: (style: CanvasNodeStyle | null) => void;
}

export type ClipboardStoreApi = StoreApi<ClipboardState>;

export function createClipboardStore(): ClipboardStoreApi {
	return createStore<ClipboardState>()((set) => ({
		payload: null,
		style: null,
		setPayload(payload) {
			set({ payload });
		},
		setStyle(style) {
			set({ style });
		},
	}));
}

/**
 * The internal clipboard FALLBACK (A-05, FR-021). Deliberately a
 * module-level singleton — the OS clipboard it stands in for is global, so
 * copy in one editor instance pastes into another on the same page even when
 * `navigator.clipboard` is unavailable or permission-denied. Cleared only by
 * overwriting; tests reset it via `setPayload(null)`.
 */
export const internalClipboardStore: ClipboardStoreApi = createClipboardStore();
