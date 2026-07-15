import type { CanvasIR } from "@anvilkit/canvas-core";
import type { AiJobStoreApi } from "./ai-job-store.js";
import type { CropStoreApi } from "./crop-store.js";
import type { DraftStoreApi } from "./draft-store.js";
import type { EditingStoreApi } from "./editing-store.js";
import type { FieldPreviewStoreApi } from "./field-preview-store.js";
import type { CanvasFocusStoreApi } from "./focus-store.js";
import type { GuidesStoreApi } from "./guides-store.js";
import type { HistoryStoreApi } from "./history-store.js";
import type { PagesStoreApi } from "./pages-store.js";
import type { PathEditStoreApi } from "./path-edit-store.js";
import type { PenStoreApi } from "./pen-store.js";
import type { SceneStoreApi } from "./scene-store.js";
import type { SelectionStoreApi } from "./selection-store.js";

/**
 * Every store `replaceDocumentSnapshot` (P0-9) coordinates. A subset of
 * `CanvasStudioContextValue` — deliberately typed against the individual
 * store APIs (not the context) so this module has no React/context
 * dependency and can be reused from `collab/binding.ts`, which only ever
 * holds bare store handles.
 */
export interface DocumentStores {
	readonly sceneStore: SceneStoreApi;
	readonly historyStore: HistoryStoreApi;
	readonly pagesStore: PagesStoreApi;
	readonly selectionStore: SelectionStoreApi;
	readonly focusStore: CanvasFocusStoreApi;
	readonly draftStore: DraftStoreApi;
	readonly editingStore: EditingStoreApi;
	readonly cropStore: CropStoreApi;
	readonly penStore: PenStoreApi;
	readonly pathEditStore: PathEditStoreApi;
	readonly guidesStore: GuidesStoreApi;
	readonly aiJobStore: AiJobStoreApi;
	/** Optional so existing hand-built store bags keep compiling (B-12). */
	readonly fieldPreviewStore?: FieldPreviewStoreApi;
}

/**
 * Where a document snapshot passed to {@link replaceDocumentSnapshot} came
 * from. Every source is reconciled identically today (see the function doc)
 * — the enum exists so callers state their intent explicitly and so a future
 * source-specific policy (e.g. skipping the history reset on the very first
 * `"initial-load"`, which is already a no-op against an empty history) has
 * somewhere to hang without a signature change.
 */
export type DocumentSnapshotSource =
	| "initial-load"
	| "document-switch"
	| "remote-update"
	| "template-load"
	| "recovery";

export interface ReplaceDocumentSnapshotOptions {
	readonly source: DocumentSnapshotSource;
}

/**
 * Replace the live document with a new, UNRELATED `CanvasIR` snapshot — not a
 * normal edit. `sceneStore.getState().setIR(ir)` alone (the pre-P0-9 behavior
 * of the Yjs binding) leaves every other store holding state computed
 * against the OLD document: undo/redo inverses that reference nodes the new
 * document may not have, a selection/focus/draft/editing/crop/pen/path-edit
 * gesture mid-flight against a node that may no longer exist, stale smart
 * guides, and an active page id the new document may not contain.
 *
 * This coordinates all of it in one call:
 * - resets undo/redo history (a foreign snapshot invalidates every recorded
 *   inverse — an undo after this point must never apply against the wrong
 *   document);
 * - clears selection, focus, in-progress draft/edit/crop/pen/path-edit
 *   gestures, and smart guides;
 * - aborts and clears any in-flight AI job (its `ai-placeholder` node may be
 *   gone);
 * - swaps the IR;
 * - reconciles the active page, falling back to the new document's first
 *   page when the current active id isn't present in it.
 *
 * The active-page fallback is computed BEFORE any store update and the `ir`/
 * `activePageId` writes happen back-to-back at the end, so the window where a
 * subscriber could observe the new `ir` paired with a since-removed
 * `activePageId` is as small as two independent zustand stores allow.
 */
export function replaceDocumentSnapshot(
	stores: DocumentStores,
	ir: CanvasIR,
	options: ReplaceDocumentSnapshotOptions,
): void {
	const {
		sceneStore,
		historyStore,
		pagesStore,
		selectionStore,
		focusStore,
		draftStore,
		editingStore,
		cropStore,
		penStore,
		pathEditStore,
		guidesStore,
		aiJobStore,
		fieldPreviewStore,
	} = stores;
	// `options.source` is not yet branched on (see the type's doc comment) —
	// referencing it keeps the parameter intentional rather than unused.
	void options.source;

	const currentActivePageId = pagesStore.getState().activePageId;
	const nextActivePageId = ir.pages.some((p) => p.id === currentActivePageId)
		? currentActivePageId
		: (ir.pages[0]?.id ?? currentActivePageId);

	historyStore.getState().reset();
	selectionStore.getState().clearSelection();
	focusStore.getState().setFocus(null);
	draftStore.getState().clearDraft();
	editingStore.getState().clearEditing();
	cropStore.getState().clear();
	penStore.getState().reset();
	pathEditStore.getState().clear();
	guidesStore.getState().clearGuides();
	aiJobStore.getState().reset();
	fieldPreviewStore?.getState().clearPreviews();

	sceneStore.getState().setIR(ir);
	pagesStore.getState().setActivePageId(nextActivePageId);
}
