"use client";

import type { CanvasIR, CanvasRuntime } from "@anvilkit/canvas-core";
import type Konva from "konva";
import { createContext, use } from "react";
import type {
	CanvasAssetPicker,
	CanvasAssetUploader,
} from "../assets/adapter-types.js";
import type { BrandKit } from "../brand/brand-kit.js";
import type {
	CanvasKindInspector,
	CanvasKindRenderer,
} from "../extensions/editor-extension.js";
import type { AiJobStoreApi } from "../stores/ai-job-store.js";
import type { CropStoreApi } from "../stores/crop-store.js";
import type { DraftStoreApi } from "../stores/draft-store.js";
import type { EditingStoreApi } from "../stores/editing-store.js";
import type { FieldPreviewStoreApi } from "../stores/field-preview-store.js";
import type { CanvasFocusStoreApi } from "../stores/focus-store.js";
import type { GuidesStoreApi } from "../stores/guides-store.js";
import type {
	AnyCanvasCommand,
	HistoryStoreApi,
} from "../stores/history-store.js";
import type { IsolationStoreApi } from "../stores/isolation-store.js";
import type { PagesStoreApi } from "../stores/pages-store.js";
import type { PathEditStoreApi } from "../stores/path-edit-store.js";
import type { PenStoreApi } from "../stores/pen-store.js";
import type { DocumentSnapshotSource } from "../stores/replace-document.js";
import type { RulerGuideStoreApi } from "../stores/ruler-guide-store.js";
import type { SaveStatusStoreApi } from "../stores/save-status-store.js";
import type { SceneStoreApi } from "../stores/scene-store.js";
import type { SelectionStoreApi } from "../stores/selection-store.js";
import type { ToolStoreApi } from "../stores/tool-store.js";
import type { UploadStoreApi } from "../stores/upload-store.js";
import type { ViewportStoreApi } from "../stores/viewport-store.js";
import type { CanvasTemplateEntry } from "../templates/template-entry.js";
import type { CanvasTemplateProvider } from "../templates/template-provider.js";
import type { AiToolIntent } from "../tools/ai-intent.js";

export type CanvasIRGetter = () => CanvasIR;

/**
 * i18n resolver (P7). `key` is a `canvas.*` message id; `fallback` is the
 * inline English default. Returns the host-injected translation when present,
 * else the fallback, else the key. canvas-editor stays standalone (no
 * `@anvilkit/core` dep) — the host (e.g. plugin-canvas-studio) injects a
 * locale-selected catalog via `<CanvasWorkspace messages>`.
 */
export type CanvasT = (key: string, fallback?: string) => string;

export interface CanvasStudioContextValue {
	historyStore: HistoryStoreApi;
	toolStore: ToolStoreApi;
	selectionStore: SelectionStoreApi;
	/** Roving keyboard focus (a11y), distinct from selection. */
	focusStore: CanvasFocusStoreApi;
	viewportStore: ViewportStoreApi;
	guidesStore: GuidesStoreApi;
	draftStore: DraftStoreApi;
	editingStore: EditingStoreApi;
	pagesStore: PagesStoreApi;
	/**
	 * Owns the live {@link CanvasIR} scene. Always provided by `<CanvasStudio>`
	 * (W2 — required, not optional, so app code gets type safety without
	 * defensive guards). The Yjs collab prototype (I3-1) binds this store to a
	 * `Y.Doc`. Prefer {@link getIR}/{@link commit}/{@link ir} for normal reads
	 * and mutations — `sceneStore` is the collab seam. Tests that need a partial
	 * context should fill the stores (e.g. via `createSceneStore`).
	 */
	sceneStore: SceneStoreApi;
	/**
	 * Transient registry of in-flight AI jobs backing `ai-placeholder` nodes
	 * (I1-10). The host registers an abort handle when it starts a job; the
	 * placeholder's on-canvas Cancel button calls `aiJobStore.cancel(jobId)`.
	 * Always provided by `<CanvasStudio>` (W2 — required).
	 */
	aiJobStore: AiJobStoreApi;
	/**
	 * Drives the interactive image-crop editor (I3-2). Always provided by
	 * `<CanvasStudio>` (W2 — required).
	 */
	cropStore: CropStoreApi;
	/**
	 * Multi-click pen-path state (I3-2). Always provided by `<CanvasStudio>`
	 * (W2 — required). The `path` tool and `PenToolOverlay` read it.
	 */
	penStore: PenStoreApi;
	/**
	 * On-stage path point-editing mode (I3-2). Always provided by
	 * `<CanvasStudio>` (W2 — required). The `PathEditOverlay` reads it.
	 */
	pathEditStore: PathEditStoreApi;
	getIR: CanvasIRGetter;
	commit: (cmd: AnyCanvasCommand) => CanvasIR;
	/**
	 * Apply many commands as one undoable transaction — a single undo step.
	 * Mirrors {@link commit} for multi-command gestures (multi-select move,
	 * transform commit, ungroup). Fires `onChange`/`onChanges` once for the batch.
	 */
	commitBatch: (
		commands: readonly AnyCanvasCommand[],
		label?: string,
	) => CanvasIR;
	/**
	 * Coalescing commit — the §10 field-input contract's commit half (B-12,
	 * first production consumer of the history store's coalesced-commit API).
	 * Successive calls sharing `mergeKey` within the history store's merge
	 * window fold into ONE undo entry (e.g. rapid re-commits of the same
	 * inspector field). Optional so hand-built partial test contexts keep
	 * working — consumers fall back to {@link commit}.
	 */
	commitCoalesced?: (cmd: AnyCanvasCommand, mergeKey: string) => CanvasIR;
	/**
	 * §10 field-input contract, preview half (B-12): transient per-node patches
	 * a mid-edit field renders through `CanvasNodeRenderer` without touching
	 * history. Optional for partial test contexts; always provided by
	 * `<CanvasStudio>`.
	 */
	fieldPreviewStore?: FieldPreviewStoreApi;
	/**
	 * Replace the WHOLE document with an unrelated `CanvasIR` snapshot (P0-9) —
	 * not a normal edit, so it does not go through {@link commit}. Resets undo/
	 * redo history, clears selection/focus/draft/editing/crop/pen/path-edit/
	 * guides, aborts stale AI jobs, swaps the IR, and reconciles the active
	 * page. Use this — never `sceneStore.getState().setIR(ir)` directly — for a
	 * host-driven document switch, loading a template as a new document,
	 * recovery, or wiring a `./collab` binding's `stores` option.
	 */
	replaceDocument: (ir: CanvasIR, source: DocumentSnapshotSource) => void;
	pickAsset: () => Promise<string>;
	/**
	 * Hand an AI gesture to the host (I1-7). Optional — present only when the
	 * editor is mounted with an AI host. See {@link AiToolIntent}.
	 */
	requestAiIntent?: (intent: AiToolIntent) => void;
	/**
	 * Shared brand colors + fonts sourced from the host's Studio config
	 * (I3-4). Optional — absent when the host configures no brand kit.
	 * Prefer reading it via {@link useBrandKit}, which normalizes the
	 * absent case to an empty kit.
	 */
	brandKit?: BrandKit;
	/**
	 * Host-supplied template catalog (canvas-m0-009). Plain data — rendered by
	 * the Templates dock panel; absent/empty shows the panel's empty state.
	 */
	templates?: readonly CanvasTemplateEntry[];
	/**
	 * Provider-backed template source (C-06, FR-131). Takes precedence over
	 * `templates` when both are set; a plain `templates` array is wrapped in
	 * `createStaticTemplateProvider` by the panel, so hosts never need this
	 * unless their catalog is remote/paginated.
	 */
	templateProvider?: CanvasTemplateProvider;
	/**
	 * Renderers for custom (extension) node kinds, keyed by kind. Consulted by
	 * `<CanvasNodeRenderer>` for any node whose `type` is not a built-in kind.
	 */
	kindRenderers?: Readonly<Record<string, CanvasKindRenderer>>;
	/** Inspector field renderers for custom node kinds, keyed by kind. */
	kindInspectors?: Readonly<Record<string, CanvasKindInspector>>;
	/**
	 * The Core runtime this instance was created with (P0-7), when one was
	 * supplied via `<CanvasStudio runtime>`. `commit`/`commitBatch`/undo/redo
	 * already dispatch through it internally; exposed here so host code (a
	 * custom tool, an inspector) can consult `runtime.nodeKinds`/`.commands`
	 * without threading it through separately. Absent when the default
	 * built-in-only runtime is in use.
	 */
	runtime?: CanvasRuntime;
	/**
	 * FR-012 (A-10): when true, creation tools stay active after committing an
	 * element (the pre-PRD-0012 behavior). Default false — tools return to
	 * Select on completion.
	 */
	continuousCreation?: boolean;
	/**
	 * Save lifecycle (B-08, FR-160/161). Always provided by `<CanvasStudio>`;
	 * optional in the type only for partial test contexts. Without a
	 * `persistenceAdapter`, `save()` resolves false and `canLeave()` is true.
	 */
	saveStatusStore?: SaveStatusStoreApi;
	save?: () => Promise<boolean>;
	canLeave?: () => boolean;
	/**
	 * FR-090/091 asset adapters (B-10). Present when the host wires them;
	 * `pickAsset` keeps its legacy single-uri contract for existing tools.
	 */
	assetPicker?: CanvasAssetPicker;
	assetUploader?: CanvasAssetUploader;
	/** Upload task registry (B-10). Provided by `<CanvasStudio>`. */
	uploadStore?: UploadStoreApi;
	/**
	 * Ruler/guide chrome state (C-02, FR-110/111/113). Always provided by
	 * `<CanvasStudio>`; optional in the type only for partial test contexts —
	 * ruler/guide surfaces render nothing without it.
	 */
	rulerGuideStore?: RulerGuideStoreApi;
	/**
	 * Container isolation stack (C-09, FR-055). UI state only — never enters
	 * IR. Always provided by `<CanvasStudio>`; optional for partial test
	 * contexts, where isolation features simply stay off.
	 */
	isolationStore?: IsolationStoreApi;
	/**
	 * Export invocation channel (FR-031/FR-032): entry points such as the node
	 * context menu's "Export selection" and the page menu's "Export page" post
	 * a scoped request here; the export UI mounted by
	 * `createCanvasExportPlugin` consumes it and opens preselected. Always
	 * provided by `<CanvasStudio>`; optional for partial test contexts.
	 */
	exportRequestStore?: ExportRequestStoreApi;
	/** Konva.Stage instance — null until <CanvasStage>'s onReady fires. */
	stage: Konva.Stage | null;
	/**
	 * Live active page id — derived from `pagesStore` via `useSyncExternalStore`
	 * in `<CanvasStudio>`. Equivalent to `pagesStore.getState().activePageId`
	 * but reactive: consumers using `useCanvasStudio()` re-render when it changes.
	 */
	activePageId: string;
	/** Current IR. Reactive — context value changes on every commit. */
	ir: CanvasIR;
	/**
	 * i18n resolver (P7). Optional — `<CanvasStudio>` provides one backed by
	 * its `messages` prop; absent in partial test contexts. Read it via
	 * {@link useCanvasT}, which falls back to the inline English default so
	 * callers always get a string.
	 */
	t?: CanvasT;
}

export const CanvasStudioContext =
	createContext<CanvasStudioContextValue | null>(null);

/**
 * The stable half of {@link CanvasStudioContextValue} (W16): the store handles
 * and host callbacks, with NO per-commit live state (`ir`/`activePageId`/
 * `stage`). `<CanvasStudio>` memoizes this so its identity never changes after
 * mount, letting components that only need stores subscribe via
 * {@link useCanvasStores} and skip the re-render that fires on every edit for
 * consumers of the full {@link CanvasStudioContext}.
 */
export type CanvasStudioStableValue = Omit<
	CanvasStudioContextValue,
	"ir" | "activePageId" | "stage"
>;

/** Stable-only context (W16). Provided alongside {@link CanvasStudioContext}. */
export const CanvasStudioStableContext =
	createContext<CanvasStudioStableValue | null>(null);

export function useCanvasStudio(): CanvasStudioContextValue {
	const ctx = use(CanvasStudioContext);
	if (!ctx) {
		throw new Error(
			"useCanvasStudio must be called inside a <CanvasStudio> tree.",
		);
	}
	return ctx;
}

/**
 * Read the stable store handles + callbacks WITHOUT subscribing to the live
 * per-commit state (W16). Use this in components that only touch stores/commit
 * and have no need for `ir`/`activePageId`/`stage`, so they don't re-render on
 * every edit.
 *
 * Falls back to the full {@link CanvasStudioContext} when the stable context is
 * absent — e.g. a partial test context that mounts only the merged provider.
 * The fallback `use(...)` is intentionally conditional (legal for `use`, unlike
 * other hooks): when the stable context IS present the merged context is never
 * read, so no per-commit subscription is created and the optimization holds.
 */
export function useCanvasStores(): CanvasStudioStableValue {
	const stable = use(CanvasStudioStableContext);
	if (stable) return stable;
	const merged = use(CanvasStudioContext);
	if (merged) return merged;
	throw new Error(
		"useCanvasStores must be called inside a <CanvasStudio> tree.",
	);
}

/** Inline-English fallback resolver used when no catalog/`t` is provided. */
const DEFAULT_CANVAS_T: CanvasT = (key, fallback) => fallback ?? key;

/**
 * Resolve `canvas.*` chrome strings. Null-tolerant: when there is no
 * `<CanvasStudio>` ancestor (or it provides no `t`), returns
 * {@link DEFAULT_CANVAS_T} so the inline English fallback always renders.
 */
export function useCanvasT(): CanvasT {
	const ctx = use(CanvasStudioContext);
	return ctx?.t ?? DEFAULT_CANVAS_T;
}
