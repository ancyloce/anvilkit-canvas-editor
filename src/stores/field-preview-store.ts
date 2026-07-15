import { createStore, type StoreApi } from "zustand/vanilla";

/**
 * @file §10 field-input contract, preview half (B-12, PRD 0012 FR-070).
 *
 * While the user adjusts an inspector/toolbar field (typing, arrow keys),
 * the in-progress value renders as a TRANSIENT preview — never as a history
 * commit. This store holds those preview patches keyed by node id;
 * `CanvasNodeRenderer` merges a node's patch over the IR node before
 * rendering, exactly the shallow merge `node.update` will apply on commit,
 * so the preview and the eventual committed state are pixel-identical.
 * Completion (Enter/blur) clears the preview and commits through
 * `commitCoalesced`; Escape just clears it.
 */

export type FieldPreviewPatch = Readonly<Record<string, unknown>>;

export interface FieldPreviewState {
	/** Live preview patches keyed by node id. Empty when no field is mid-edit. */
	previews: Readonly<Record<string, FieldPreviewPatch>>;
	/**
	 * Replace the active preview set (multi-selection edits preview every
	 * selected node in one update). Patches are node.update-shaped shallow
	 * partials.
	 */
	setPreviews: (entries: Readonly<Record<string, FieldPreviewPatch>>) => void;
	clearPreviews: () => void;
}

export type FieldPreviewStoreApi = StoreApi<FieldPreviewState>;

const EMPTY: Readonly<Record<string, FieldPreviewPatch>> = {};

export function createFieldPreviewStore(): FieldPreviewStoreApi {
	return createStore<FieldPreviewState>()((set) => ({
		previews: EMPTY,
		setPreviews(entries) {
			set({ previews: entries });
		},
		clearPreviews() {
			set((s) => (s.previews === EMPTY ? s : { previews: EMPTY }));
		},
	}));
}
