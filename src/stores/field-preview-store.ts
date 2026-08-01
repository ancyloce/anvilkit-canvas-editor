import type { CanvasPage } from "@anvilkit/canvas-core";
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
 *
 * Plan 0024 Phase 2 adds the PAGE half. Node patches cannot express page-level
 * properties (size, background), so the page inspector's fields had no preview
 * path at all — dragging the artboard background picker showed nothing until
 * release. `pagePreviews` is a second, additive map keyed by page id, merged by
 * `resolved-document-store`'s `withPreviews` the same copy-on-write way.
 */

export type FieldPreviewPatch = Readonly<Record<string, unknown>>;

/**
 * Page-level preview patch. `id` and `root` are deliberately excluded: identity
 * must not be previewable, and node content already previews through
 * {@link FieldPreviewState.previews} — routing it here would bypass the node
 * walk and silently drop child patches.
 */
export type PagePreviewPatch = Readonly<
	Partial<Omit<CanvasPage, "id" | "root">>
>;

export interface FieldPreviewState {
	/** Live preview patches keyed by node id. Empty when no field is mid-edit. */
	previews: Readonly<Record<string, FieldPreviewPatch>>;
	/** Live preview patches keyed by PAGE id (plan 0024 Phase 2). */
	pagePreviews: Readonly<Record<string, PagePreviewPatch>>;
	/**
	 * Replace the active preview set (multi-selection edits preview every
	 * selected node in one update). Patches are node.update-shaped shallow
	 * partials.
	 */
	setPreviews: (entries: Readonly<Record<string, FieldPreviewPatch>>) => void;
	/** Page counterpart of {@link setPreviews}; patches are `CanvasPage` partials. */
	setPagePreviews: (
		entries: Readonly<Record<string, PagePreviewPatch>>,
	) => void;
	/** Drops BOTH maps — "no field is mid-edit" is one state, not two. */
	clearPreviews: () => void;
}

export type FieldPreviewStoreApi = StoreApi<FieldPreviewState>;

const EMPTY: Readonly<Record<string, FieldPreviewPatch>> = {};
const EMPTY_PAGES: Readonly<Record<string, PagePreviewPatch>> = {};

export function createFieldPreviewStore(): FieldPreviewStoreApi {
	return createStore<FieldPreviewState>()((set) => ({
		previews: EMPTY,
		pagePreviews: EMPTY_PAGES,
		setPreviews(entries) {
			set({ previews: entries });
		},
		setPagePreviews(entries) {
			set({ pagePreviews: entries });
		},
		clearPreviews() {
			// Identity check on BOTH so a clear with nothing pending stays a no-op
			// and never wakes the resolved-document subscribers.
			set((s) =>
				s.previews === EMPTY && s.pagePreviews === EMPTY_PAGES
					? s
					: { previews: EMPTY, pagePreviews: EMPTY_PAGES },
			);
		},
	}));
}
