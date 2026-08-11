"use client";

import {
	type CanvasChange,
	type CanvasCommand,
	CanvasCommandError,
	type CanvasIR,
	type CanvasNode,
	type CanvasRuntime,
	commandToChange,
	isContainerNode,
} from "@anvilkit/canvas-core";
import type {
	CanvasBrandPolicyContext,
	CanvasGovernanceAuditSink,
} from "@anvilkit/canvas-core/brand-governance";
import type Konva from "konva";
import * as React from "react";
import {
	useCallback,
	useEffect,
	useMemo,
	useRef,
	useState,
	useSyncExternalStore,
} from "react";
import { Group } from "react-konva";
import { CanvasFocusRing } from "./a11y/CanvasFocusRing.js";
import { LayoutAnnouncer } from "./a11y/LayoutAnnouncer.js";
import { SceneAccessibilityTree } from "./a11y/SceneAccessibilityTree.js";
import { ToolAnnouncer } from "./a11y/ToolAnnouncer.js";
import { CanvasKeyboardLayer } from "./a11y/useCanvasKeyboard.js";
import { ZoomAnnouncer } from "./a11y/ZoomAnnouncer.js";
import type { CanvasClipboardAdapter } from "./actions/clipboard-adapter.js";
import { withComponentLocation } from "./actions/scoped-commit.js";
import type {
	CanvasAssetPicker,
	CanvasAssetUploader,
} from "./assets/adapter-types.js";
import { useRehydratedLocalAssets } from "./assets/local-asset-rehydration.js";
import {
	createLocalAssetFallback,
	type LocalAssetFallbackFailure,
} from "./assets/local-fallback.js";
import {
	type CanvasLayoutEventHandler,
	createLayoutDiagnosticEmitter,
} from "./auto-layout/events.js";
import type { BrandKit } from "./brand/brand-kit.js";
import { EMPTY_BRAND_KIT } from "./brand/brand-kit.js";
import {
	CanvasErrorBoundary,
	type CanvasErrorDetailsInfo,
} from "./CanvasErrorBoundary.js";
import type { CanvasAnalyticsSink } from "./component-libraries/analytics.js";
import type { CanvasComponentProvider } from "./component-libraries/component-provider.js";
import {
	type CanvasExportResult,
	CanvasStudioContext,
	type CanvasStudioContextValue,
	CanvasStudioStableContext,
	type CanvasStudioStableValue,
	type CanvasT,
} from "./context/canvas-studio-context.js";
import type { CanvasComponentEventHandler } from "./context/component-events.js";
import {
	type CanvasToaster,
	useCanvasToaster,
} from "./context/toast-context.js";
import { resolveFontCatalog } from "./context/use-font-catalog.js";
import type {
	CanvasEditorExtension,
	CanvasKindInspector,
	CanvasKindRenderer,
} from "./extensions/editor-extension.js";
import { PageNavigator } from "./pages/PageNavigator.js";
import { draggedIdsKey } from "./perf/active-nodes.js";
import { useStaticGroupCache } from "./perf/static-cache.js";
import {
	isDocumentCapabilityReadOnly,
	warnReadOnlyCommitBlocked,
} from "./persistence/layout-compatibility.js";
import { loadCanvasDocument } from "./persistence/load-pipeline.js";
import { RecoverDraftPrompt } from "./persistence/RecoverDraftPrompt.js";
import {
	type CanvasRecoveryAdapter,
	createRecoveryController,
} from "./persistence/recovery.js";
import {
	createSaveController,
	type SaveController,
} from "./persistence/save-controller.js";
import { prepareDocumentForSave } from "./persistence/save-pipeline.js";
import type {
	CanvasAutoSaveOptions,
	CanvasPersistenceAdapter,
} from "./persistence/types.js";
import { CanvasTransformer } from "./selection/CanvasTransformer.js";
import { CornerRadiusOverlay } from "./selection/CornerRadiusOverlay.js";
import { CropEditorOverlay } from "./selection/CropEditorOverlay.js";
import { computeDimmedIds } from "./selection/isolation.js";
import { PathEditOverlay } from "./selection/PathEditOverlay.js";
import { SmartGuideOverlay } from "./snap/SmartGuideOverlay.js";
import { CanvasAssetsContext } from "./stage/CanvasAssetsContext.js";
import { CanvasBrandKitContext } from "./stage/CanvasBrandKitContext.js";
import { CanvasNodeRenderer } from "./stage/CanvasNodeRenderer.js";
import { CanvasStage } from "./stage/CanvasStage.js";
import { DesignBackground } from "./stage/DesignBackground.js";
import { Grid } from "./stage/Grid.js";
import { GuideLayoutOverlay } from "./stage/GuideLayoutOverlay.js";
import { IsolationRenderContext } from "./stage/isolation-render-context.js";
import { RemoteCursors } from "./stage/RemoteCursors.js";
import { RemoteSelections } from "./stage/RemoteSelections.js";
import { RenderLayer } from "./stage/RenderLayer.js";
import { createAiJobStore } from "./stores/ai-job-store.js";
import { createComponentScopeStore } from "./stores/component-scope-store.js";
import { createCropStore } from "./stores/crop-store.js";
import { createDraftStore } from "./stores/draft-store.js";
import { createEditingStore } from "./stores/editing-store.js";
import { createExportRequestStore } from "./stores/export-request-store.js";
import { createFieldPreviewStore } from "./stores/field-preview-store.js";
import { createFocusStore } from "./stores/focus-store.js";
import { createGuidesStore } from "./stores/guides-store.js";
import {
	type AnyCanvasCommand,
	createHistoryStore,
} from "./stores/history-store.js";
import { createIsolationStore } from "./stores/isolation-store.js";
import { createLayerRenameStore } from "./stores/layer-rename-store.js";
import { createPagesStore } from "./stores/pages-store.js";
import { createPathEditStore } from "./stores/path-edit-store.js";
import { createPenStore } from "./stores/pen-store.js";
import {
	type DocumentSnapshotSource,
	type DocumentStores,
	replaceDocumentSnapshot,
} from "./stores/replace-document.js";
import { createResolvedDocumentStore } from "./stores/resolved-document-store.js";
import { createRulerGuideStore } from "./stores/ruler-guide-store.js";
import type { CanvasSaveState } from "./stores/save-status-store.js";
import { createSaveStatusStore } from "./stores/save-status-store.js";
import { createSceneStore } from "./stores/scene-store.js";
import {
	createSelectionStore,
	type SelectionStoreApi,
} from "./stores/selection-store.js";
import { createToolStore, type ToolId } from "./stores/tool-store.js";
import { createUploadStore } from "./stores/upload-store.js";
import { createViewportStore } from "./stores/viewport-store.js";
import type { CanvasTemplateEntry } from "./templates/template-entry.js";
import type { CanvasTemplateProvider } from "./templates/template-provider.js";
import type { CanvasFontCatalog } from "./text/font-catalog.js";
import type { AiToolIntent } from "./tools/ai-intent.js";
import { DraftRenderer } from "./tools/DraftRenderer.js";
import { PenPreview } from "./tools/PenPreview.js";
import { PenToolOverlay } from "./tools/PenToolOverlay.js";
import { RichTextToolbar } from "./tools/RichTextToolbar.js";
import { TextEditorOverlay } from "./tools/TextEditorOverlay.js";
import { ToolInteractionLayer } from "./tools/ToolInteractionLayer.js";
import { defaultToolRegistry } from "./tools/tool-registry.js";
import type { ToolRegistry } from "./tools/tool-types.js";

/**
 * Object form of the {@link CanvasStudioProps.autoLayout} flag (A-2). The
 * boolean shorthand `autoLayout: true` is equivalent to `{ creationUI: true }`.
 */
export interface CanvasAutoLayoutFlagOptions {
	/** Enable the Auto Layout creation/conversion UI. Default false. */
	creationUI?: boolean;
}

export interface CanvasStudioProps {
	/**
	 * Initial IR. Uncontrolled — subsequent prop updates do not replace the
	 * internal IR. Use `onChange` to mirror state into a host store.
	 */
	initialIR: CanvasIR;
	/**
	 * Initial active page id. Defaults to `initialIR.pages[0].id`. Uncontrolled
	 * — after mount the `pagesStore` owns the active id; switch pages via the
	 * `<PageNavigator>` or by calling `useCanvasStudio().pagesStore.getState().setActivePageId(...)`.
	 */
	initialActivePageId?: string;
	width?: number;
	height?: number;
	initialTool?: ToolId;
	/** Fires after every committed command with the new IR + the command. */
	onChange?: (ir: CanvasIR, command: AnyCanvasCommand) => void;
	/**
	 * Fires after every commit with the granular change records + the new IR.
	 * Complements {@link onChange} for autosave / dirty-tracking / collab that
	 * wants deltas rather than the whole command. A batch commit reports the
	 * flattened per-command changes.
	 */
	onChanges?: (changes: readonly CanvasChange[], ir: CanvasIR) => void;
	/**
	 * Fires whenever the active page (artboard) changes, with the new
	 * page id. Used by hosts that want to mirror the active artboard
	 * out (e.g. preview-export bridges that need to tag exports with
	 * the artboard id).
	 */
	onActivePageChange?: (pageId: string) => void;
	/**
	 * Fires when the SINGLE selected node changes, with its id — or `null`
	 * whenever there is no single node to name: nothing selected (deselection),
	 * or a multi-selection, where naming one of N would be arbitrary. Hosts wire
	 * this to surfaces that operate on exactly one node, e.g. the AI panel's
	 * `image.replace` round-trip, which needs `AiLayerContext.selectedNodeId`.
	 *
	 * Fires once on mount with the initial value — like {@link onActivePageChange}
	 * — and after that ONLY when the reported id actually changes. Re-selecting
	 * the node that is already selected, or any selection churn that leaves the
	 * derived id equal, is not reported again.
	 *
	 * Reports the PERSISTENT-node projection (`selectionStore.selectedIds`), so
	 * a virtual node selected inside a component instance reports the owning
	 * instance id — the id a `node.*` / `image.replace` command may target.
	 */
	onSelectionChange?: (nodeId: string | null) => void;
	/** Required for the image tool (MVP-6 Task 8). Host opens picker, returns asset id. */
	onPickAsset?: () => Promise<string>;
	/**
	 * Fires when an AI tool (`ai-image` / `ai-brush`, I1-7) captures a gesture.
	 * Hosts wire this to the AI panel / job client. Omit it to leave the AI
	 * tools as inert gesture-capture (the marquee/selection still render).
	 */
	onAiIntent?: (intent: AiToolIntent) => void;
	/**
	 * FR-172 host error callback (B-15): fires when the canvas subtree throws
	 * during render and the error boundary catches it. Wire to telemetry.
	 */
	onError?: (error: Error, info: React.ErrorInfo) => void;
	/**
	 * FR-171 "View details": renders the full error-details dialog for the
	 * stage-level error boundary. `<CanvasStudio>` sits below the `workspace`
	 * layer (see `scripts/check-layering.mjs`) and cannot import dialog-class
	 * UI itself, so it only threads this prop down to the boundary — the
	 * headless bare-stage layout has no "View details" trigger unless the
	 * caller supplies one. `<CanvasWorkspace>` wires its own `ErrorDetailsDialog`
	 * here automatically.
	 */
	renderErrorDetails?: (info: CanvasErrorDetailsInfo) => React.ReactNode;
	/**
	 * Fires once after `<CanvasStage>` has constructed the Konva.Stage, and
	 * again with `null` when the stage tears down. Hosts use this to drive
	 * export pipelines (e.g. `stage.toDataURL()`) without reaching into the
	 * editor's internals.
	 */
	onStageReady?: (stage: Konva.Stage | null) => void;
	/** Tool registry override (mainly for tests). Defaults to the built-in registry. */
	toolRegistry?: ToolRegistry;
	/** Suppress the built-in `<PageNavigator>` (e.g. hosts that bring their own). */
	hidePageNavigator?: boolean;
	/**
	 * Opt-in chrome composition (I3-5). When provided, `<CanvasStudio>` renders
	 * `renderShell(stage)` *inside* its context provider instead of the bare
	 * stacked layout — so any rail/panel/inspector returned by the shell is a
	 * provider child and can call {@link useCanvasStudio}. The callback is a
	 * pure composition seam (no hooks) that receives the ready-to-mount Konva
	 * stage node and decides where to place it (e.g. the centre column of a
	 * grid). Omit it to keep the bare-stage layout. `<CanvasWorkspace>` wraps
	 * this with the full editor shell.
	 */
	renderShell?: (stage: React.ReactNode) => React.ReactNode;
	/**
	 * FR-012 (A-10): keep the creation tool active after it commits an element
	 * (continuous creation). Default false — the editor returns to Select.
	 */
	continuousCreation?: boolean;
	/**
	 * T-M4-10 (AL-COMPAT-003): opt-in Auto Layout creation/conversion UI.
	 * **Default OFF for the whole alpha/beta line** — flipping the default on
	 * is a releasable behaviour change requiring release notes (PRD §19
	 * Phase 4). Gates ONLY creation/conversion affordances: reading,
	 * rendering, editing existing intent, and exporting are never gated at
	 * any phase. Prop name provisional under OQ-5 (assumption A-2).
	 */
	autoLayout?: boolean | CanvasAutoLayoutFlagOptions;
	/**
	 * Plan 0023 M6-07 (PRD §19): opt-in Local Components AUTHORING UI.
	 *
	 * **Default OFF**, and gated exactly like `autoLayout`: it controls creation
	 * and Source-editing affordances only. Everything a document already contains
	 * keeps working at every stage with the flag off — instances resolve, render,
	 * hit-test, export, stay override-editable and stay detachable — because
	 * rollback must never strip Registry or instance data (PRD §19 rollback).
	 *
	 * Concretely, OFF hides the Components dock (the id stays in `DOCK_IDS` so the
	 * persisted-state union and its migration are stable in both directions, M5-01)
	 * and suppresses "create component from selection". ON adds the dock and the
	 * create affordance. Staged enablement: 1 parse/render → 2 internal create →
	 * 3 beta overrides/nesting/templates/detach → 4 default-on.
	 */
	localComponents?: boolean;
	/**
	 * T-M4-11 (A-3, PRD §12): one optional callback carrying the six layout
	 * events. `canvas.layout.diagnostic` fires on commit only — never during
	 * preview — deduped within a commit by `(code, nodeId, axis)`. Payloads
	 * carry no document content. Prop name provisional under OQ-5.
	 */
	onLayoutEvent?: CanvasLayoutEventHandler;
	/**
	 * Plan 0023 M6-08: host observer for the eight PRD §12 component events.
	 * No transport ships in this package — the editor emits, the host delivers.
	 */
	onComponentEvent?: CanvasComponentEventHandler;
	/**
	 * FR-160 host persistence (B-08). When present, edits mark the document
	 * dirty, auto-save runs per `autoSave` (default on), a beforeunload guard
	 * warns while unsaved (FR-163), and pending changes flush on unmount.
	 */
	persistenceAdapter?: CanvasPersistenceAdapter;
	/**
	 * Fires when a document could not be brought into the editor: either
	 * {@link CanvasPersistenceAdapter.load} rejected, or the document it
	 * resolved failed to parse, migrate, or validate (T-M0-04) — or a
	 * {@link CanvasRecoveryAdapter} snapshot failed the same pipeline and was
	 * discarded rather than restored (T-M0-05).
	 *
	 * Separate from {@link onError} on purpose: that one is the FR-172 render
	 * error-boundary callback and carries a `React.ErrorInfo`, which a load
	 * failure has no honest value for. A rejected load leaves `initialIR`
	 * mounted and editable rather than breaking the editor, so the host needs
	 * a way to hear about it — otherwise a document silently fails to load and
	 * the user edits the wrong content.
	 */
	onLoadError?: (error: Error) => void;
	/**
	 * FR-164 local recovery (C-10). When present, the editor mirrors the
	 * document into this adapter (debounced after each commit), clears it on
	 * a successful save, and offers to restore a newer snapshot on mount.
	 * `createIndexedDbRecoveryAdapter()` is the ready-made browser impl.
	 */
	recoveryAdapter?: CanvasRecoveryAdapter;
	/** FR-162 auto-save tuning. `false` = manual saves only. Default on. */
	autoSave?: boolean | CanvasAutoSaveOptions;
	/** Save-state observer (PRD §11.1). */
	onSaveStateChange?: (state: CanvasSaveState) => void;
	/**
	 * PRD §11.1 export observer: fires with the completed
	 * {@link CanvasExportResult} after every successful export — both the
	 * headless `useCanvasStudioActions().export()` action and the built-in
	 * export dialog's user-driven export.
	 */
	onExport?: (result: CanvasExportResult) => void;
	/**
	 * FR-090 asset picker adapter (B-10). When present it supersedes
	 * `onPickAsset` for tools (single pick) and powers multi-select flows;
	 * the legacy `onPickAsset` keeps working unchanged.
	 */
	assetPicker?: CanvasAssetPicker;
	/** FR-091 upload adapter (B-10) — enables drag-and-drop + the Uploads panel. */
	assetUploader?: CanvasAssetUploader;
	/**
	 * cp1-004 (PLAN-0035 §5 P1): opt OUT of the built-in local asset fallback.
	 *
	 * There are three states, not two:
	 *
	 * 1. **A host adapter is present** — any of {@link assetPicker},
	 *    {@link assetUploader} or the legacy {@link onPickAsset}. The host's
	 *    adapter is used and the fallback is never even constructed. This flag
	 *    is irrelevant here; a host adapter already wins.
	 * 2. **No host adapter, flag unset (the default)** — images are ingested
	 *    into browser-local storage (IndexedDB, degrading to memory), so a bare
	 *    `<CanvasStudio initialIR={…} />` can accept a drop and un-gate the
	 *    Image tool with no wiring at all.
	 * 3. **No host adapter, flag `true`** — images are genuinely unavailable:
	 *    the Image tool stays disabled and a drop reports "no upload service
	 *    configured", which is the pre-cp1-004 behaviour. Set this when local
	 *    storage would be the wrong promise — a host whose documents must be
	 *    portable across devices, or one under a policy that forbids writing
	 *    user content to the browser.
	 *
	 * Never set this to suppress the fallback while ALSO passing an adapter:
	 * state 1 already does that, and the flag would be misleading.
	 */
	disableLocalAssetFallback?: boolean;
	/**
	 * §11.1 clipboard adapter override. When present, `clipboard-actions.ts`
	 * uses it instead of `system-clipboard.ts`'s `navigator.clipboard`
	 * wrapper — e.g. for an Electron/native bridge where the Web Clipboard API
	 * isn't available or isn't the right transport. Omit to use the built-in
	 * system clipboard (with its existing internal-clipboard fallback).
	 */
	clipboard?: CanvasClipboardAdapter;
	/**
	 * Shared brand colors + fonts (I3-4). Hosts map their Studio config to a
	 * {@link BrandKit} and pass it here; the editor surfaces it via
	 * {@link useBrandKit}. Omit to run with no brand kit.
	 */
	brandKit?: BrandKit;
	/**
	 * Extra font families the picker offers and the SVG exporter may embed
	 * (`cp2-007`). Build one with `createFontCatalog(entries)`; omit it to run on
	 * the built-in `DEFAULT_FONT_CATALOG` alone.
	 *
	 * **Merged, not replaced.** The editor resolves
	 * `mergeCatalogs(DEFAULT_FONT_CATALOG, fontCatalog)` once and hands the
	 * result to BOTH the font picker and the export `@font-face` manifest.
	 * Precedence is **brand > host > default** and rides on each record's
	 * `origin` — `createFontCatalog` stamps `"host"` by default, and
	 * `createFontCatalog(entries, { origin: "brand" })` outranks that — so
	 * argument order at any call site is irrelevant across tiers. A same-named
	 * family is replaced WHOLE-ENTRY (never field-merged, so a licence is never
	 * inherited); a family the default catalog does not know is added. This prop
	 * cannot *remove* a default family.
	 *
	 * **The default catalog ships metadata, not bytes.** All 37 default entries
	 * carry a Google Fonts stylesheet URL and no `source.files`, so they need
	 * network access to render and an SVG export emits **no** `@font-face` rule
	 * for them — those families fall back to system metrics with core's existing
	 * `FONT_NOT_IN_MANIFEST` warning. To get a family EMBEDDED in an SVG export,
	 * pass an entry whose `source.files` point at real font files. See
	 * `docs/typography.md`.
	 */
	fontCatalog?: CanvasFontCatalog;
	/**
	 * Host brand-policy context (plan 0021 T-040): capability snapshot,
	 * enforcement mode, opaque policy revision. Omit to run ungoverned — every
	 * affordance stays available, which is the pre-M4 behaviour.
	 *
	 * Presentation input only; the command layer enforces the same policy
	 * independently, so hiding a button is never the enforcement.
	 */
	brandGovernance?: CanvasBrandPolicyContext;
	/**
	 * Snapshot keys quarantined by `loadCanvasDocumentWithDiagnostics`
	 * (plan 0021 T-045).
	 *
	 * The host owns the load call — it is what produces `initialIR` — so it is
	 * also what holds the diagnostics. Threading the keys back in is what makes
	 * a failed integrity check block EXPORT rather than only render a
	 * placeholder: without them, export preparation sees a snapshot that is
	 * present and exports content that failed verification.
	 */
	quarantinedSnapshotKeys?: readonly string[];
	/**
	 * Product analytics sink (plan 0021 T-050, PRD §13).
	 *
	 * Sits alongside `onChange`/`onExport` as a host callback. Every event name
	 * is `anvilkit.canvas.*`-prefixed and every payload is redacted per §13 — no
	 * credentials, raw content, text values, asset URLs, or unredacted identity;
	 * library and component identifiers arrive hashed.
	 *
	 * A throwing sink cannot break an edit: emission is wrapped, because a
	 * host's analytics callback is third-party code on a user-interaction path
	 * and losing a metric beats losing the user's work.
	 */
	onAnalyticsEvent?: CanvasAnalyticsSink;
	/**
	 * Governance audit sink (TD §24.2). Distinct from
	 * {@link CanvasStudioProps.onAnalyticsEvent}: different retention, different
	 * consumer, different redaction. Carries no actor — the host adds
	 * authenticated identity in its own audit system.
	 */
	onGovernanceAuditEvent?: CanvasGovernanceAuditSink;
	/**
	 * Called when the user asks for more detail about a blocked operation
	 * (T-040 step 3). Receives the stable deny code, never localized copy and
	 * never the policy decision's log-only `detail`.
	 */
	onGovernanceDeepLink?: (code: string) => void;
	/**
	 * Host-supplied template catalog (canvas-m0-009). Plain data consumed by the
	 * Templates dock panel; structurally compatible with
	 * `@anvilkit/canvas-templates`' catalog values. Omit to show the panel's
	 * empty state.
	 */
	templates?: readonly CanvasTemplateEntry[];
	/**
	 * Provider-backed template source (C-06, FR-131) for remote/paginated
	 * catalogs. Takes precedence over `templates`; the static array keeps
	 * working without it.
	 */
	templateProvider?: CanvasTemplateProvider;
	/**
	 * Host-injected catalog for the Libraries source of the Components panel
	 * (plan 0021 T-018/T-019).
	 *
	 * Threaded exactly like {@link CanvasStudioProps.templateProvider}. Omit it
	 * and the Libraries source is simply absent — a document that already
	 * contains external components still opens, renders and exports, because
	 * resolution reads the document's own snapshots and never a Provider.
	 */
	componentProvider?: CanvasComponentProvider;
	/**
	 * Plan 0021 rollout flag for EXTERNAL component libraries, default false.
	 *
	 * Parallel to `localComponents`, and gates only the authoring affordances
	 * (the Libraries source, insert, recovery). Never gates read/render/export:
	 * a document using external components must stay readable when the flag is
	 * off, or turning it off would be data loss rather than a rollback.
	 */
	externalComponents?: boolean;
	/**
	 * Plan 0021 rollout flag for component VARIANTS, default false.
	 *
	 * The third of T-053's flags, and it gates authoring only — exactly like
	 * `externalComponents` and for the same reason. A document that already
	 * carries `variantSelection` must keep resolving to the same variant with
	 * the flag off, because variant resolution is a READ concern: turning the
	 * flag off to roll back authoring must not silently re-render every instance
	 * with its default variant, which would be a visual regression indexed
	 * across every page at once.
	 *
	 * `rollback-rehearsal.test.ts` is what holds that line.
	 */
	componentVariants?: boolean;
	/**
	 * FR-132 "Open as a new document": `<CanvasStudio>` owns one live document,
	 * so creating a brand-new document is a HOST action. When wired, the
	 * Templates panel surfaces an "Open as new document" choice and hands the
	 * host the instantiated `CanvasIR` (e.g. to open a new tab/route). Omit it
	 * and the choice is hidden — Replace / Add-as-new-pages still work.
	 */
	onCreateDocument?: (document: CanvasIR) => void;
	/**
	 * Host-injected i18n catalog (P7). A flat `canvas.*` → string map for the
	 * active locale; the editor resolves chrome strings via {@link useCanvasT}
	 * (host override wins, else the inline English fallback). Omit to render
	 * the bundled English defaults. canvas-editor stays standalone — the host
	 * (e.g. plugin-canvas-studio) selects the catalog by locale and passes it.
	 */
	messages?: Readonly<Record<string, string>>;
	/**
	 * Domain extensions (Area 1). Each may contribute renderers/inspectors for
	 * custom node kinds; they are threaded to `<CanvasNodeRenderer>` and the
	 * inspector via context. Pair with canvas-core's `createCanvasRuntime` for the
	 * matching schema/command/serializer extensions.
	 */
	extensions?: readonly CanvasEditorExtension[];
	/**
	 * Injected Core runtime (P0-7). When supplied, the commit/history pipeline
	 * (`commit`/`commitBatch`/`undo`/`redo`) dispatches through
	 * `runtime.apply` instead of core's built-in-only `applyCommand`, so custom
	 * commands registered on this runtime participate in undo/redo exactly like
	 * built-ins. Pair it with a matching `createCanvasRuntime(...)` on the
	 * `extensions` prop's renderer/inspector side and with the SAME runtime at
	 * decode/serialize time (`@anvilkit/canvas-editor/collab`'s
	 * `decodeCanvasIR`, core's `serializePageToSvg`) — a runtime is a single
	 * per-document config, not one-per-concern. Omit to use the default
	 * built-in-only runtime (unchanged from before this prop existed).
	 */
	runtime?: CanvasRuntime;
	/**
	 * Optional host UI rendered *inside* the editor's context provider, so it
	 * can call {@link useCanvasStudio} to drive tool selection, read the live
	 * selection/IR, or mount the exported `<LayerPanel>` / `<PropertyInspector>`
	 * against this instance's stores. The editor ships no toolbar of its own
	 * (tool selection is host-driven, PRD §3.4); this slot is how a host wires
	 * one without recomposing the stage. Rendered as a sibling of the stage
	 * root so the host owns its own layout.
	 */
	children?: React.ReactNode;
}

/**
 * Mirror an optional host callback into a ref so long-lived closures (commit
 * pipeline, tool seams) always call the latest render's prop without
 * re-triggering on identity churn.
 */
function useHostCallbackRef<T>(callback: T): React.RefObject<T> {
	const ref = useRef(callback);
	useEffect(() => {
		ref.current = callback;
	}, [callback]);
	return ref;
}

/**
 * cp5-R03: the one node a host callback can name, or `null`.
 *
 * A multi-selection has no single answer and an empty one has no answer at
 * all. Both report `null` rather than picking a winner, so a host can never
 * commit an `image.replace` against an arbitrarily-chosen node.
 */
function singleSelectedNodeId(ids: readonly string[]): string | null {
	return ids.length === 1 ? (ids[0] ?? null) : null;
}

/**
 * cp5-R03: fire {@link CanvasStudioProps.onSelectionChange} when — and only
 * when — the single-selection id changes.
 *
 * A leaf component rather than an effect in `<CanvasStudio>`'s own body, for
 * the reason `<CanvasToasterBridge>` is one: selection changes on every click,
 * and subscribing at the studio level would re-render the whole editor body
 * for a value nothing else there reads.
 *
 * The redundant-fire suppression is `useSyncExternalStore` comparing the
 * DERIVED primitive with `Object.is`: selection churn that leaves the id equal
 * — re-selecting the node already selected, or `setSelection` with an equal
 * list (a fresh array every time) — produces neither a re-render here nor a
 * re-run of the effect. Subscribing to `selectedIds` itself instead would fire
 * on every one of those, which is exactly the naive-`useEffect` bug.
 */
function HostSelectionBridge({
	selectionStore,
	callbackRef,
}: {
	selectionStore: SelectionStoreApi;
	callbackRef: React.RefObject<((nodeId: string | null) => void) | undefined>;
}): null {
	const selectedNodeId = useSyncExternalStore(
		selectionStore.subscribe,
		() => singleSelectedNodeId(selectionStore.getState().selectedIds),
		() => singleSelectedNodeId(selectionStore.getState().selectedIds),
	);
	useEffect(() => {
		callbackRef.current?.(selectedNodeId);
	}, [selectedNodeId, callbackRef]);
	return null;
}

/**
 * cp1-004: render a byte cap as something a person can act on.
 *
 * The caps are powers of two (25 MiB per asset, 200 MiB total), and "26.2 MB"
 * would be a strictly worse answer than "25 MB" for a number whose only job is
 * to be recognisable as the limit the user just hit. Whole megabytes above 10,
 * one decimal below.
 */
function formatLimitBytes(bytes: number | undefined): string {
	if (bytes === undefined || !Number.isFinite(bytes)) return "";
	const mib = bytes / (1024 * 1024);
	return `${mib >= 10 ? Math.round(mib) : Math.round(mib * 10) / 10} MB`;
}

/**
 * cp1-004: publish the LIVE toaster up to the local asset fallback.
 *
 * The toast host is mounted BELOW `<CanvasStudio>` — `<CanvasWorkspace>` puts
 * `<CanvasToastHost>` inside the `renderShell` callback — so the studio's own
 * body can only ever read the no-op toaster. This rides with the stage for
 * exactly the reason `<RecoverDraftPrompt>` does, and renders nothing.
 *
 * A bare `<CanvasStudio>` mounts no toast host at all, so fallback failures
 * are silent there — the same deal every other editor toast already has.
 */
function CanvasToasterBridge({
	sink,
}: {
	sink: React.RefObject<CanvasToaster | null>;
}): null {
	const toaster = useCanvasToaster();
	useEffect(() => {
		sink.current = toaster;
		return () => {
			sink.current = null;
		};
	}, [sink, toaster]);
	return null;
}

/**
 * Per-instance editor stores, created once on mount. The `initial*` props are
 * captured at creation — `<CanvasStudio>` is uncontrolled (see the prop docs).
 */
function useEditorStores({
	initialIR,
	initialActivePageId,
	initialTool,
	runtime,
}: Pick<
	CanvasStudioProps,
	"initialIR" | "initialActivePageId" | "initialTool" | "runtime"
>) {
	const [sceneStore] = useState(() => createSceneStore({ initialIR }));
	// `runtime` is captured at creation like every other `initial*` prop here
	// (uncontrolled — see the prop docs): swapping it after mount would silently
	// change what undo/redo dispatches through mid-session, which is exactly the
	// "multiple unrelated runtime instances" P0-7 asks to avoid.
	const [historyStore] = useState(() =>
		createHistoryStore({
			...(runtime?.apply ? { apply: runtime.apply } : {}),
			// FR-024 / §20.13: user-initiated commits enforce locking at the
			// command boundary; the pipeline catches the typed rejection and
			// no-ops. Undo/redo replay inverses unguarded (see the store).
			enforceLocked: true,
		}),
	);
	const [toolStore] = useState(() => createToolStore({ initialTool }));
	const [selectionStore] = useState(() => createSelectionStore());
	const [focusStore] = useState(() => createFocusStore());
	const [viewportStore] = useState(() => createViewportStore());
	const [pagesStore] = useState(() =>
		createPagesStore({
			initialActivePageId: initialActivePageId ?? initialIR.pages[0]?.id ?? "",
		}),
	);
	const [guidesStore] = useState(() => createGuidesStore());
	const [draftStore] = useState(() => createDraftStore());
	const [editingStore] = useState(() => createEditingStore());
	const [aiJobStore] = useState(() => createAiJobStore());
	const [cropStore] = useState(() => createCropStore());
	const [penStore] = useState(() => createPenStore());
	const [pathEditStore] = useState(() => createPathEditStore());
	const [fieldPreviewStore] = useState(() => createFieldPreviewStore());
	const [rulerGuideStore] = useState(() => createRulerGuideStore());
	const [isolationStore] = useState(() => createIsolationStore());
	// Plan 0023 M4-05: Source-editing scope STACK. UI state only — a scope never
	// enters the IR, and entering one is never a document command.
	const [componentScopeStore] = useState(() => createComponentScopeStore());
	const [exportRequestStore] = useState(() => createExportRequestStore());
	const [layerRenameStore] = useState(() => createLayerRenameStore());
	// T-M3-05: derives one resolved layout document from scene + previews.
	// Creation is inert; subscriptions attach in the `connect()` effect below,
	// so a StrictMode double-invoke of this initializer leaks nothing.
	const [resolvedDocumentStore] = useState(() =>
		createResolvedDocumentStore({ sceneStore, fieldPreviewStore }),
	);
	useEffect(() => resolvedDocumentStore.connect(), [resolvedDocumentStore]);
	return {
		sceneStore,
		historyStore,
		toolStore,
		selectionStore,
		focusStore,
		viewportStore,
		pagesStore,
		guidesStore,
		draftStore,
		editingStore,
		aiJobStore,
		cropStore,
		penStore,
		pathEditStore,
		fieldPreviewStore,
		rulerGuideStore,
		isolationStore,
		componentScopeStore,
		exportRequestStore,
		layerRenameStore,
		resolvedDocumentStore,
	};
}

/**
 * True for core's typed `node-locked` rejection (FR-024): a user command tried
 * to mutate a locked node. The commit pipeline no-ops on it rather than
 * letting it reach the error boundary. The action layer surfaces its own toast
 * for the operations it fronts; direct edits (inspector/drag) just no-op.
 */
function isLockedRejection(err: unknown): boolean {
	return err instanceof CanvasCommandError && err.code === "node-locked";
}

/**
 * The commit pipeline: history-tracked command application plus the host
 * `onChange`/`onChanges` notification seams.
 */
function useCommitPipeline(
	sceneStore: ReturnType<typeof createSceneStore>,
	historyStore: ReturnType<typeof createHistoryStore>,
	onChange: CanvasStudioProps["onChange"],
	onChanges: CanvasStudioProps["onChanges"],
	componentScopeStore: ReturnType<typeof createComponentScopeStore>,
) {
	const onChangeRef = useHostCallbackRef(onChange);
	const onChangesRef = useHostCallbackRef(onChanges);

	/**
	 * Plan 0023 M5-03: while a Component Source is open, redirect every
	 * location-aware command into that DEFINITION tree.
	 *
	 * Done here, at the one choke point all three commit entry points share,
	 * rather than in every tool and inspector field: a Source node id has no
	 * meaning in `ir.pages`, so an unstamped edit would fail to find its node and
	 * throw out of the pipeline. `withComponentLocation` leaves page-, asset- and
	 * Registry-level commands untouched and never overrides an explicit location.
	 */
	const scoped = useCallback(
		(cmd: AnyCanvasCommand): AnyCanvasCommand => {
			const active = componentScopeStore.getState().activeFrame();
			return active ? withComponentLocation(cmd, active.componentId) : cmd;
		},
		[componentScopeStore],
	);

	const commit = useCallback(
		(command: AnyCanvasCommand): CanvasIR => {
			const cmd = scoped(command);
			const current = sceneStore.getState().ir;
			// AC-010 (T-M5-03): unsupported-capability documents are read-only —
			// mutating commands are blocked at this single choke point while
			// render and export stay fully available.
			if (isDocumentCapabilityReadOnly(current)) {
				warnReadOnlyCommitBlocked(current);
				return current;
			}
			let next: CanvasIR;
			try {
				next = historyStore.getState().commit(current, cmd);
			} catch (err) {
				if (isLockedRejection(err)) return current; // FR-024: no-op on lock
				throw err;
			}
			sceneStore.getState().setIR(next);
			onChangeRef.current?.(next, cmd);
			if (onChangesRef.current) {
				// `commandToChange` is exhaustive over the built-in `CanvasCommand`
				// union; a custom command (P0-7) has no built-in change-record shape
				// and falls through with no granular record — same as `batch` already
				// does today. `change ?` treats that fallthrough the same as `null`.
				const change = commandToChange(cmd as CanvasCommand);
				onChangesRef.current(change ? [change] : [], next);
			}
			return next;
		},
		[historyStore, sceneStore, onChangeRef, onChangesRef, scoped],
	);

	// §10 field-input contract commit half (B-12): same pipeline as `commit`,
	// but successive calls sharing `mergeKey` inside the history store's merge
	// window fold into one undo entry.
	const commitCoalesced = useCallback(
		(command: AnyCanvasCommand, mergeKey: string): CanvasIR => {
			const cmd = scoped(command);
			const current = sceneStore.getState().ir;
			if (isDocumentCapabilityReadOnly(current)) {
				warnReadOnlyCommitBlocked(current);
				return current;
			}
			let next: CanvasIR;
			try {
				next = historyStore.getState().commitCoalesced(current, cmd, mergeKey);
			} catch (err) {
				if (isLockedRejection(err)) return current; // FR-024: no-op on lock
				throw err;
			}
			sceneStore.getState().setIR(next);
			onChangeRef.current?.(next, cmd);
			if (onChangesRef.current) {
				const change = commandToChange(cmd as CanvasCommand);
				onChangesRef.current(change ? [change] : [], next);
			}
			return next;
		},
		[historyStore, sceneStore, onChangeRef, onChangesRef, scoped],
	);

	// Apply many commands as ONE undo entry (multi-select move, transform commit,
	// ungroup). Fires onChange (with the composite batch command) and onChanges once.
	const commitBatch = useCallback(
		(input: readonly AnyCanvasCommand[], label?: string): CanvasIR => {
			if (input.length === 0) return sceneStore.getState().ir;
			const commands = input.map(scoped);
			const current = sceneStore.getState().ir;
			if (isDocumentCapabilityReadOnly(current)) {
				warnReadOnlyCommitBlocked(current);
				return current;
			}
			let next: CanvasIR;
			try {
				next = historyStore.getState().commitBatch(current, commands, label);
			} catch (err) {
				if (isLockedRejection(err)) return current; // FR-024: no-op on lock
				throw err;
			}
			sceneStore.getState().setIR(next);
			// Not annotated `AnyCanvasCommand` — that would force TS to match this
			// literal against `CanvasBatchCommand`'s `commands: CanvasCommand[]`,
			// which a custom command in `commands` can't satisfy. Left inferred, it
			// structurally satisfies `AnyCanvasCommand` at the `onChangeRef` call
			// below without narrowing the (possibly custom-command-carrying) array.
			const batchCmd = {
				type: "batch" as const,
				...(label !== undefined ? { label } : {}),
				commands: [...commands],
			};
			onChangeRef.current?.(next, batchCmd);
			if (onChangesRef.current) {
				const changes = commands
					.map((cmd) => commandToChange(cmd as CanvasCommand))
					.filter((c): c is CanvasChange => c !== null);
				onChangesRef.current(changes, next);
			}
			return next;
		},
		[historyStore, sceneStore, onChangeRef, onChangesRef],
	);

	// Undo/redo (E-20): the same onChange/onChanges seam as `commit`. `next ===
	// current` covers BOTH "nothing to undo/redo" and "the top entry was a
	// stale inverse the store just dropped" (history-store.ts) — neither is a
	// real change, so neither notifies. Read-only documents block undo/redo
	// like any mutation (review 0022 P2-3): a read-only session cannot build
	// history through the guarded commits, but the symmetry protects against
	// any entry point that seeds `historyStore` directly.
	const undo = useCallback((): CanvasIR => {
		const current = sceneStore.getState().ir;
		if (isDocumentCapabilityReadOnly(current)) {
			warnReadOnlyCommitBlocked(current);
			return current;
		}
		const next = historyStore.getState().undo(current);
		if (next === current) return current;
		sceneStore.getState().setIR(next);
		onChangeRef.current?.(next, { type: "undo" });
		onChangesRef.current?.([], next);
		return next;
	}, [historyStore, sceneStore, onChangeRef, onChangesRef]);

	const redo = useCallback((): CanvasIR => {
		const current = sceneStore.getState().ir;
		if (isDocumentCapabilityReadOnly(current)) {
			warnReadOnlyCommitBlocked(current);
			return current;
		}
		const next = historyStore.getState().redo(current);
		if (next === current) return current;
		sceneStore.getState().setIR(next);
		onChangeRef.current?.(next, { type: "redo" });
		onChangesRef.current?.([], next);
		return next;
	}, [historyStore, sceneStore, onChangeRef, onChangesRef]);

	const getIR = useCallback(() => sceneStore.getState().ir, [sceneStore]);

	return { commit, commitCoalesced, commitBatch, undo, redo, getIR };
}

/**
 * Exposes `replaceDocumentSnapshot` (P0-9) bound to this instance's stores, as
 * a stable callback for the context value. Used internally by nothing yet —
 * it exists so a host (a "switch document" action, template-as-new-document
 * loading, crash recovery, or a `./collab` binding constructed with `stores`)
 * has ONE safe way to swap the whole document instead of reaching for
 * `sceneStore.getState().setIR(ir)` directly and hitting the same staleness
 * bugs P0-9 fixed for the collab path.
 */
function useReplaceDocument(stores: DocumentStores) {
	const storesRef = useHostCallbackRef(stores);
	return useCallback(
		(ir: CanvasIR, source: DocumentSnapshotSource) => {
			replaceDocumentSnapshot(storesRef.current, ir, { source });
		},
		[storesRef],
	);
}

/**
 * The Konva stage plus its render layers and interaction overlays — the
 * "canvas" section of the editor. Rendered inside the context providers (via
 * the bare layout or wherever `renderShell` slots it), so every overlay can
 * call `useCanvasStudio()`.
 */
function EditorStage({
	t,
	activePage,
	activePageId,
	sourceRoot,
	assets,
	brandKit,
	width,
	height,
	zoom,
	panX,
	panY,
	onError,
	onReloadDocument,
	onExportRecovery,
	renderErrorDetails,
	onStageReady,
	draggedIds,
	dimmedIds,
	toolRegistry,
}: {
	t: CanvasT;
	activePage: CanvasIR["pages"][number];
	activePageId: string;
	/**
	 * Plan 0023 M5-03: the open Component Source's root, when one is being
	 * edited. Its children take the page's place on the stage — SAME renderers,
	 * same overlays, same tools — and the Source tree is never inserted into
	 * `ir.pages` to make that happen.
	 */
	sourceRoot: CanvasNode | undefined;
	assets: CanvasIR["assets"];
	brandKit: BrandKit | undefined;
	width: number | undefined;
	height: number | undefined;
	zoom: number;
	panX: number;
	panY: number;
	onError: ((error: Error, info: React.ErrorInfo) => void) | undefined;
	onReloadDocument: () => void;
	onExportRecovery: () => void;
	renderErrorDetails:
		| ((info: CanvasErrorDetailsInfo) => React.ReactNode)
		| undefined;
	onStageReady: (stage: Konva.Stage | null) => void;
	draggedIds: ReadonlySet<string>;
	/** C-09 exterior-dim set while isolated; null = no isolation. */
	dimmedIds: ReadonlySet<string> | null;
	toolRegistry: ToolRegistry | undefined;
}): React.JSX.Element {
	// The stage box scales with zoom so the page grows/shrinks as a whole and
	// Konva pointer mapping stays correct (scaleX=zoom over a zoom-sized box).
	// At zoom = 1 this is the page's natural pixel size (unchanged). This is
	// what lets the multi-page workspace scale every page uniformly via zoom.
	// Editing a Source sizes the surface to the Source root instead.
	const surfaceSize = sourceRoot ? sourceRoot.bounds : activePage.size;
	const stageWidth = (width ?? surfaceSize.width) * zoom;
	const stageHeight = (height ?? surfaceSize.height) * zoom;
	// What the object layers paint. A Source root that is not a container has no
	// children to draw — it renders as its own single node instead.
	const surfaceChildren: readonly CanvasNode[] = sourceRoot
		? isContainerNode(sourceRoot)
			? sourceRoot.children
			: [sourceRoot]
		: activePage.root.children;
	return (
		<CanvasErrorBoundary
			label={t("canvas.error.canvas", "The canvas failed to render.")}
			resetKey={activePageId}
			{...(onError ? { onError } : {})}
			onReloadDocument={onReloadDocument}
			onExportRecovery={onExportRecovery}
			{...(renderErrorDetails ? { renderErrorDetails } : {})}
			labels={{
				retry: t("canvas.error.retry", "Try again"),
				reloadDocument: t("canvas.error.reloadDocument", "Reload document"),
				exportRecovery: t(
					"canvas.error.exportRecovery",
					"Export recovery JSON",
				),
				copyErrorId: t("canvas.error.copyErrorId", "Copy error ID"),
				viewDetails: t("canvas.error.viewDetails", "View details"),
			}}
		>
			<CanvasAssetsContext.Provider value={assets}>
				<CanvasBrandKitContext.Provider value={brandKit ?? EMPTY_BRAND_KIT}>
					{/* C-09 (FR-055): exterior-dim set for isolation mode. Only the
				    LIVE stage provides it — rasterize/export paths never do. */}
					<IsolationRenderContext.Provider value={dimmedIds}>
						<CanvasStage
							width={stageWidth}
							height={stageHeight}
							zoom={zoom}
							panX={panX}
							panY={panY}
							onReady={onStageReady}
						>
							{/* Konva warns above 5 physical layers ("recommended maximum
					    number of layers is 3-5"); this stage used to mount 6 (one per
					    RenderLayer). Semantically distinct chrome that doesn't need its
					    own redraw isolation is now grouped into fewer physical layers
					    via named <Group>s — paint order is unchanged, only the layer
					    boundaries moved. */}
							<RenderLayer name="content">
								<Group name="background" listening={false}>
									<DesignBackground />
									<Grid />
								</Group>
								<Group name="objects">
									{surfaceChildren.flatMap((node) =>
										draggedIds.has(node.id)
											? []
											: [<CanvasNodeRenderer key={node.id} node={node} />],
									)}
								</Group>
							</RenderLayer>
							{/* I2-5: dragged nodes float on their own layer so only it
					    redraws during a drag; the (cached) content layer stays put.
					    Kept as its own physical layer — the one redraw isolation this
					    consolidation must not give up. */}
							<RenderLayer name="drag">
								{surfaceChildren.flatMap((node) =>
									draggedIds.has(node.id)
										? [<CanvasNodeRenderer key={node.id} node={node} />]
										: [],
								)}
							</RenderLayer>
							{/* C-02: persistent guides + layout aids, merged with the
					    selection chrome below into one "overlay" layer. Both only
					    redraw during active interaction and both are editor-only
					    chrome excluded from export (see CHROME_LAYER_NAMES in
					    export-stage.ts) — sharing a layer costs nothing there. Guides
					    stay below selection in paint order. */}
							<RenderLayer name="overlay">
								<Group name="guides">
									<GuideLayoutOverlay />
								</Group>
								<Group name="selection">
									<DraftRenderer />
									<SmartGuideOverlay />
									<PenPreview />
									<PathEditOverlay />
									<CanvasTransformer />
									<CanvasFocusRing />
								</Group>
							</RenderLayer>
							<RenderLayer name="presence" listening={false}>
								<RemoteCursors />
								<RemoteSelections />
							</RenderLayer>
						</CanvasStage>
					</IsolationRenderContext.Provider>
					<ToolInteractionLayer registry={toolRegistry} />
					<TextEditorOverlay />
					<RichTextToolbar />
					<CropEditorOverlay />
					<CornerRadiusOverlay />
					<PenToolOverlay />
				</CanvasBrandKitContext.Provider>
			</CanvasAssetsContext.Provider>
		</CanvasErrorBoundary>
	);
}

export function CanvasStudio({
	initialIR,
	initialActivePageId,
	width,
	height,
	initialTool,
	onChange,
	onChanges,
	onActivePageChange,
	onSelectionChange,
	onPickAsset,
	onAiIntent,
	onError,
	renderErrorDetails,
	onStageReady,
	toolRegistry,
	hidePageNavigator,
	brandKit,
	fontCatalog,
	brandGovernance,
	quarantinedSnapshotKeys,
	onAnalyticsEvent,
	onGovernanceAuditEvent,
	onGovernanceDeepLink,
	templates,
	templateProvider,
	componentProvider,
	externalComponents = false,
	componentVariants = false,
	onCreateDocument,
	messages,
	extensions,
	runtime,
	renderShell,
	continuousCreation = false,
	autoLayout = false,
	localComponents = false,
	onLayoutEvent,
	onComponentEvent,
	persistenceAdapter,
	onLoadError,
	recoveryAdapter,
	autoSave,
	onSaveStateChange,
	onExport,
	assetPicker,
	assetUploader,
	disableLocalAssetFallback = false,
	clipboard,
	children,
}: CanvasStudioProps): React.JSX.Element {
	const {
		sceneStore,
		historyStore,
		toolStore,
		selectionStore,
		focusStore,
		viewportStore,
		pagesStore,
		guidesStore,
		draftStore,
		editingStore,
		aiJobStore,
		cropStore,
		penStore,
		pathEditStore,
		fieldPreviewStore,
		rulerGuideStore,
		isolationStore,
		componentScopeStore,
		exportRequestStore,
		layerRenameStore,
		resolvedDocumentStore,
	} = useEditorStores({ initialIR, initialActivePageId, initialTool, runtime });
	const ir = useSyncExternalStore(
		sceneStore.subscribe,
		() => sceneStore.getState().ir,
		() => sceneStore.getState().ir,
	);
	const [stage, setStage] = useState<Konva.Stage | null>(null);
	// Inline mirror (not `useHostCallbackRef`): the unmount teardown below must
	// read the ref in its cleanup, and only a component-local `useRef` is
	// provably stable there.
	const onStageReadyRef = useRef(onStageReady);
	useEffect(() => {
		onStageReadyRef.current = onStageReady;
	}, [onStageReady]);
	const handleStageReady = useCallback((next: Konva.Stage | null) => {
		setStage(next);
		onStageReadyRef.current?.(next);
	}, []);
	useEffect(() => {
		return () => {
			onStageReadyRef.current?.(null);
		};
	}, []);

	const activePageId = useSyncExternalStore(
		pagesStore.subscribe,
		() => pagesStore.getState().activePageId,
		() => pagesStore.getState().activePageId,
	);

	const onActivePageChangeRef = useHostCallbackRef(onActivePageChange);
	useEffect(() => {
		onActivePageChangeRef.current?.(activePageId);
	}, [activePageId, onActivePageChangeRef]);

	// cp5-R03: same host-callback shape as `onActivePageChange` above, but the
	// subscription lives in <HostSelectionBridge> — see it for why.
	const onSelectionChangeRef = useHostCallbackRef(onSelectionChange);

	// FR-055: the isolation stack is per page — switching pages exits it.
	useEffect(() => {
		isolationStore.getState().exitAll();
	}, [activePageId, isolationStore]);

	// Subscribe so viewportStore changes (hand-tool pan, zoom) re-render
	// <CanvasStage> with the new transform.
	const zoom = useSyncExternalStore(
		viewportStore.subscribe,
		() => viewportStore.getState().zoom,
		() => viewportStore.getState().zoom,
	);
	const panX = useSyncExternalStore(
		viewportStore.subscribe,
		() => viewportStore.getState().panX,
		() => viewportStore.getState().panX,
	);
	const panY = useSyncExternalStore(
		viewportStore.subscribe,
		() => viewportStore.getState().panY,
		() => viewportStore.getState().panY,
	);
	const { commit, commitCoalesced, commitBatch, undo, redo, getIR } =
		useCommitPipeline(
			sceneStore,
			historyStore,
			onChange,
			onChanges,
			componentScopeStore,
		);
	// FR-091: created before `documentStores` so document replacement can abort
	// in-flight uploads; unmount cleanup lives in the effect below.
	const uploadStore = useMemo(() => createUploadStore(), []);
	useEffect(
		() => () => {
			// Abort every in-flight upload on unmount so late responses can't
			// leak work (their tasks are gone; insertion guards on `has()`).
			uploadStore.getState().reset();
		},
		[uploadStore],
	);
	const documentStores = useMemo<DocumentStores>(
		() => ({
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
			uploadStore,
		}),
		[
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
			uploadStore,
		],
	);
	const replaceDocumentIntoStores = useReplaceDocument(documentStores);
	/**
	 * cp1-005: `ir.assets` **as of the last document load**. Its object identity
	 * is the rehydration epoch (see `useRehydratedLocalAssets`), which is why it
	 * is state updated at the swap rather than a `useEffect` on `ir`: assets that
	 * appear LATER — an upload in this session — already carry a live object URL
	 * and must not be re-minted, and only the swap can tell the two apart.
	 *
	 * `replaceDocument` is the one document-swap choke point (`uploadStore.reset()`
	 * already hangs off it), so wrapping it covers `initial-load`, `document-switch`,
	 * `template-load`, `remote-update` and `recovery` in one place.
	 */
	const [loadedAssets, setLoadedAssets] = useState(() => initialIR.assets);
	const replaceDocument = useCallback(
		(next: CanvasIR, source: DocumentSnapshotSource) => {
			replaceDocumentIntoStores(next, source);
			setLoadedAssets(next.assets);
		},
		[replaceDocumentIntoStores],
	);

	// T-M0-04: host-driven load. `CanvasPersistenceAdapter.load` shipped as an
	// optional method that nothing ever called — `<CanvasStudio>` mounted
	// `initialIR` directly, so there was no entry path for a persisted
	// document to be migrated or validated on the way in. When the adapter
	// implements `load`, fetch it, run the one load pipeline, and swap the
	// document via `replaceDocument` (never a bare `setIR`, which leaves the
	// other document stores stale — P0-9).
	//
	// A host that does NOT implement `load` is unaffected: `initialIR` is used
	// exactly as before, and this effect returns immediately.
	const onLoadErrorRef = useHostCallbackRef(onLoadError);
	// Stable so `<RecoverDraftPrompt>`'s effect does not re-run per render.
	const reportLoadError = useCallback(
		(error: Error) => onLoadErrorRef.current?.(error),
		[onLoadErrorRef],
	);
	const initialDocumentId = initialIR.id;
	useEffect(() => {
		const load = persistenceAdapter?.load;
		if (!persistenceAdapter || !load) return;
		// The mount must not be blocked on the network, and a response that
		// arrives after unmount (or after the adapter changed) must not write
		// into a torn-down store.
		let cancelled = false;
		void (async () => {
			try {
				const raw = await load.call(persistenceAdapter, initialDocumentId);
				if (cancelled) return;
				replaceDocument(
					loadCanvasDocument(raw, runtime ? { runtime } : {}),
					"initial-load",
				);
			} catch (error) {
				if (cancelled) return;
				// A failed load leaves `initialIR` mounted and editable. Throwing
				// here would take the whole editor down over a transport error.
				onLoadErrorRef.current?.(
					error instanceof Error ? error : new Error(String(error)),
				);
			}
		})();
		return () => {
			cancelled = true;
		};
	}, [
		persistenceAdapter,
		initialDocumentId,
		replaceDocument,
		runtime,
		onLoadErrorRef,
	]);

	// B-08 save lifecycle. The controller subscribes to history state identity;
	// stable `save`/`canLeave` wrappers go into context so consumers never
	// re-render on controller recreation.
	const saveStatusStore = useMemo(() => createSaveStatusStore(), []);
	const saveControllerRef = useRef<SaveController | null>(null);
	const onSaveStateChangeRef = useHostCallbackRef(onSaveStateChange);
	useEffect(() => {
		if (!persistenceAdapter) return;
		const controller = createSaveController({
			adapter: persistenceAdapter,
			getIR,
			historyStore,
			saveStatusStore,
			...(autoSave !== undefined ? { autoSave } : {}),
			onSaveStateChange: (state) => onSaveStateChangeRef.current?.(state),
		});
		saveControllerRef.current = controller;
		const onBeforeUnload = (e: BeforeUnloadEvent): void => {
			if (!controller.canLeave()) {
				e.preventDefault();
				e.returnValue = "";
				// Browsers do not keep the page alive for Promises here, so an
				// async `flush()` would be a false guarantee. Best-effort
				// persistence is only attempted through the adapter's optional
				// synchronous unload transport (sendBeacon/keepalive/localStorage).
				// T-M5-03: the unload snapshot ships the same capability-complete,
				// materialized document a normal save produces.
				const revision = historyStore.getState().getStateId();
				const ir = prepareDocumentForSave(getIR(), revision);
				persistenceAdapter.saveOnUnload?.({
					ir,
					documentId: ir.id,
					revision,
				});
			}
		};
		window.addEventListener("beforeunload", onBeforeUnload);
		return () => {
			window.removeEventListener("beforeunload", onBeforeUnload);
			// Final flush, then teardown. `flush()` marks its save as protected,
			// so the `dispose()` on the next line aborts only obsolete auto-saves
			// — never the flush it was just paired with (FR-160).
			void controller.flush();
			controller.dispose();
			saveControllerRef.current = null;
		};
	}, [
		persistenceAdapter,
		autoSave,
		getIR,
		historyStore,
		saveStatusStore,
		onSaveStateChangeRef,
	]);
	const save = useCallback(
		() => saveControllerRef.current?.save() ?? Promise.resolve(false),
		[],
	);
	const canLeave = useCallback(
		() => saveControllerRef.current?.canLeave() ?? true,
		[],
	);
	// FR-160/163: awaitable route-leave flush for host routing guards. Unlike
	// `save()`, the save it starts survives controller disposal.
	const flush = useCallback(
		() => saveControllerRef.current?.flush() ?? Promise.resolve(true),
		[],
	);

	// FR-164 (C-10): mirror the document into the recovery adapter, debounced;
	// a successful real save clears the snapshot.
	useEffect(() => {
		if (!recoveryAdapter) return;
		const controller = createRecoveryController({
			adapter: recoveryAdapter,
			getIR,
			historyStore,
			...(persistenceAdapter ? { saveStatusStore } : {}),
		});
		return () => controller.dispose();
	}, [
		recoveryAdapter,
		getIR,
		historyStore,
		persistenceAdapter,
		saveStatusStore,
	]);

	const onPickAssetRef = useHostCallbackRef(onPickAsset);
	const onAiIntentRef = useHostCallbackRef(onAiIntent);

	// P7 i18n resolver: host catalog (per-key) → inline English fallback → key.
	const t = useMemo<CanvasT>(
		() => (key, fallback) => messages?.[key] ?? fallback ?? key,
		[messages],
	);
	// `t`'s identity changes with every fresh `messages` object — for an inline
	// literal, that is every render. The local asset fallback below owns a DOM
	// node and must NOT be rebuilt on that churn, so its callbacks read the
	// latest `t` through a ref and stay stable themselves.
	const tRef = useHostCallbackRef(t);

	/**
	 * cp1-004 (PLAN-0035 §5 P1): does the HOST own asset ingress? Any one of
	 * the three adapters counts, and any one of them suppresses the local
	 * fallback ENTIRELY — a host that wired uploads but not picking gets
	 * exactly the editor it had before this task, with no second storage path
	 * appearing underneath its own. See {@link CanvasStudioProps.disableLocalAssetFallback}
	 * for the three states.
	 */
	const hostOwnsAssets =
		Boolean(assetPicker) || Boolean(assetUploader) || Boolean(onPickAsset);
	const localAssetFallbackEnabled =
		!hostOwnsAssets && !disableLocalAssetFallback;

	/**
	 * cp1-005 (PLAN-0035 §5 P1): the asset table the STAGE renders against —
	 * `ir.assets` with every locally-stored `blob:` entry remapped onto a fresh
	 * object URL, because the one recorded in the document died with the page
	 * that minted it. The document is never rewritten, so a rehydrated URI can
	 * never reach `onChange`, the save pipeline or an export.
	 *
	 * Gated on the SAME flag as the fallback adapters, deliberately: when the
	 * host owns asset ingress there is no local store in play, and this must not
	 * construct one, scan one, or rewrite a URI the host produced. With the flag
	 * false the hook short-circuits before importing the store module at all.
	 */
	const rehydratedAssets = useRehydratedLocalAssets({
		assets: ir.assets,
		loadedAssets,
		enabled: localAssetFallbackEnabled,
	});

	// Published by <CanvasToasterBridge> from inside the shell — see it for why
	// <CanvasStudio>'s own body can never see the real toaster.
	const assetFallbackToasterRef = useRef<CanvasToaster | null>(null);
	const getDocumentId = useCallback(() => getIR().id, [getIR]);
	const describeAssetFallbackFailure = useCallback(
		(failure: LocalAssetFallbackFailure): string => {
			const translate = tRef.current;
			const limit = formatLimitBytes(failure.limitBytes);
			if (failure.code === "asset-too-large") {
				return translate(
					"canvas.upload.localAssetTooLarge",
					"This file is too large to store in this browser (limit {limit}).",
				).replace("{limit}", limit);
			}
			if (failure.code === "store-full") {
				return translate(
					"canvas.upload.localStoreFull",
					"Local image storage is full (limit {limit}). Remove some images and try again.",
				).replace("{limit}", limit);
			}
			return translate(
				"canvas.upload.localIngestFailed",
				"This file could not be added.",
			);
		},
		[tRef],
	);
	const reportAssetFallbackFailure = useCallback(
		(_failure: LocalAssetFallbackFailure, message: string): void => {
			assetFallbackToasterRef.current?.add({
				type: "error",
				title: tRef.current("canvas.upload.failed", "Upload failed"),
				description: message,
			});
		},
		[tRef],
	);

	/**
	 * The zero-config adapters, constructed ONCE and only when the host
	 * supplied none. Every dependency here is render-stable by construction,
	 * so a host re-rendering `<CanvasStudio>` — new inline `messages`, a new
	 * `onChange`, anything — neither rebuilds the pair nor leaks a hidden
	 * `<input>` per render. Nothing is fetched, no DOM node is created and no
	 * IndexedDB connection is opened until the first upload or pick.
	 */
	const localAssetFallback = useMemo(
		() =>
			localAssetFallbackEnabled
				? createLocalAssetFallback({
						getDocumentId,
						describeFailure: describeAssetFallbackFailure,
						reportFailure: reportAssetFallbackFailure,
					})
				: undefined,
		[
			localAssetFallbackEnabled,
			getDocumentId,
			describeAssetFallbackFailure,
			reportAssetFallbackFailure,
		],
	);
	useEffect(() => {
		if (!localAssetFallback) return;
		// The picker owns a hidden <input> on document.body; unmounting without
		// this leaves one behind per editor instance, and strands any pick left
		// awaiting an open dialog.
		return () => localAssetFallback.dispose();
	}, [localAssetFallback]);

	/**
	 * The fallback is a FLOOR, never an override — `??` is the entire
	 * precedence rule. A host adapter is used untouched, and because its mere
	 * presence already set `localAssetFallbackEnabled` false, there is no
	 * fallback in existence for it to have overridden.
	 */
	const effectiveAssetPicker = assetPicker ?? localAssetFallback?.picker;
	const effectiveAssetUploader = assetUploader ?? localAssetFallback?.uploader;

	/**
	 * FR-011: whether the Image tool can actually pick an asset — either
	 * wiring makes it usable. Drives the Tool Strip's disabled state for
	 * "image" (`ToolStrip.tsx`) so a misconfigured host shows an inert
	 * button instead of throwing on first click. cp1-004: the local fallback
	 * satisfies it too, which is what un-gates the tool on a zero-config mount
	 * — wiring only the uploader would have left the button greyed out.
	 */
	const hasImagePicker = Boolean(effectiveAssetPicker) || Boolean(onPickAsset);

	const pickAsset = useCallback(async () => {
		// FR-090 (B-10): a full assetPicker adapter supersedes the legacy
		// single-uri callback; `onPickAsset` keeps working unchanged.
		if (effectiveAssetPicker) {
			const picked = await effectiveAssetPicker.pick({
				multiple: false,
				kind: "image",
			});
			const first = picked[0];
			if (!first) return "";
			return first.id;
		}
		const fn = onPickAssetRef.current;
		if (!fn) {
			throw new Error(
				"onPickAsset prop is required to use the image tool (MVP-6 Task 8).",
			);
		}
		return fn();
	}, [onPickAssetRef, effectiveAssetPicker]);

	/**
	 * FR-090 (B-10) multi-select pick: only meaningful with a full assetPicker
	 * adapter — the legacy `onPickAsset` single-uri callback has no
	 * multi-select concept, so this is omitted from context entirely when
	 * neither a host picker nor the local fallback is in play (see the
	 * `pickAssets` spread below).
	 */
	const pickAssets = useCallback(
		() =>
			effectiveAssetPicker?.pick({ multiple: true, kind: "image" }) ??
			Promise.resolve([]),
		[effectiveAssetPicker],
	);

	// Stable seam for the AI tools (I1-7). Always defined; a no-op when no host
	// wired `onAiIntent`. The AI tools call it on gesture completion.
	const requestAiIntent = useCallback(
		(intent: AiToolIntent) => {
			onAiIntentRef.current?.(intent);
		},
		[onAiIntentRef],
	);

	// I2-5: cache idle static groups on the active page as bitmaps. Renders
	// nothing; clears a group's cache the moment it is selected/edited/dragged.
	useStaticGroupCache({
		stage,
		getIR,
		activePageId,
		ir,
		selectionStore,
		editingStore,
		draftStore,
	});

	// I2-5 drag-layer: a string key for the dragged-node SET. Stable across
	// pointermoves (a `move` draft mutates only currentX/Y), so subscribing here
	// re-renders <CanvasStudio> only on drag start/end — not per move (MVP-7).
	const draggedKey = useSyncExternalStore(
		draftStore.subscribe,
		() => draggedIdsKey(draftStore.getState().draft),
		() => draggedIdsKey(draftStore.getState().draft),
	);
	const draggedIds = useMemo(
		() => new Set(draggedKey ? draggedKey.split(",") : []),
		[draggedKey],
	);

	// Area 1: index extension renderers/inspectors by node kind for
	// <CanvasNodeRenderer> (and the inspector). Stable — rebuilt only on change.
	const { kindRenderers, kindInspectors } = useMemo(() => {
		const renderers: Record<string, CanvasKindRenderer> = {};
		const inspectors: Record<string, CanvasKindInspector> = {};
		for (const ext of extensions ?? []) {
			for (const r of ext.renderers ?? []) renderers[r.kind] = r;
			for (const ins of ext.inspectors ?? []) inspectors[ins.kind] = ins;
		}
		return { kindRenderers: renderers, kindInspectors: inspectors };
	}, [extensions]);

	// Merge extension-contributed tools into the EFFECTIVE registry (FR-010):
	// default tools + extension tools + the `toolRegistry` prop, which wins.
	// No extension tools → the prop untouched (it REPLACES the registry, its
	// pre-FR-010 contract) or the default registry. Handed to both the tool
	// interaction layer and the context, so chrome surfaces (tool strip
	// overflow, Elements panel) list exactly the tools that can run.
	const effectiveToolRegistry = useMemo<ToolRegistry>(() => {
		const extTools = extensions?.flatMap((e) => e.tools ?? []) ?? [];
		if (extTools.length === 0) return toolRegistry ?? defaultToolRegistry;
		const merged: ToolRegistry = { ...defaultToolRegistry };
		for (const tool of extTools) merged[tool.id] = tool;
		if (toolRegistry) Object.assign(merged, toolRegistry);
		return merged;
	}, [toolRegistry, extensions]);

	// Stable half (W16): store handles + callbacks, no live state. Its identity
	// never changes after mount, so `useCanvasStores()` consumers don't re-render
	// on every commit.
	const stableCtxValue = useMemo<CanvasStudioStableValue>(
		() => ({
			historyStore,
			toolStore,
			selectionStore,
			focusStore,
			viewportStore,
			guidesStore,
			draftStore,
			editingStore,
			pagesStore,
			sceneStore,
			aiJobStore,
			cropStore,
			penStore,
			pathEditStore,
			getIR,
			commit,
			commitCoalesced,
			commitBatch,
			undo,
			redo,
			fieldPreviewStore,
			resolvedDocumentStore,
			rulerGuideStore,
			isolationStore,
			componentScopeStore,
			exportRequestStore,
			layerRenameStore,
			replaceDocument,
			pickAsset,
			hasImagePicker,
			requestAiIntent,
			brandKit,
			// cp2-007: the merge happens HERE and only here — one resolved catalog
			// for the picker and the export manifest both. `resolveFontCatalog`
			// returns `DEFAULT_FONT_CATALOG` itself when the host passed nothing,
			// so this is a constant in the common case, not a per-mount allocation.
			fontCatalog: resolveFontCatalog(fontCatalog),
			...(brandGovernance ? { brandGovernance } : {}),
			...(quarantinedSnapshotKeys ? { quarantinedSnapshotKeys } : {}),
			...(onAnalyticsEvent ? { onAnalyticsEvent } : {}),
			...(onGovernanceAuditEvent ? { onGovernanceAuditEvent } : {}),
			...(onGovernanceDeepLink ? { onGovernanceDeepLink } : {}),
			templates,
			templateProvider,
			componentProvider,
			externalComponentsEnabled: externalComponents === true,
			componentVariantsEnabled: componentVariants === true,
			...(onCreateDocument ? { onCreateDocument } : {}),
			...(onExport ? { onExport } : {}),
			t,
			kindRenderers,
			kindInspectors,
			// FR-010: the resolved registry, so chrome lists what can run.
			toolRegistry: effectiveToolRegistry,
			runtime,
			continuousCreation,
			// T-M4-10: opt-in flag — only creation/conversion UI keys off this.
			autoLayoutCreationEnabled:
				autoLayout === true ||
				(typeof autoLayout === "object" && autoLayout.creationUI === true),
			// Plan 0023 M6-07: opt-in flag — only AUTHORING affordances key off
			// this. Resolve/render/export/override/detach are never gated.
			localComponentsEnabled: localComponents === true,
			...(onLayoutEvent ? { onLayoutEvent } : {}),
			...(onComponentEvent ? { onComponentEvent } : {}),
			// Present only with a persistence adapter — the header's save
			// indicator keys its visibility off this field (B-07).
			...(persistenceAdapter ? { saveStatusStore } : {}),
			save,
			canLeave,
			flush,
			// cp1-004: the HOST adapter when there is one, otherwise the local
			// fallback — never both, and never the fallback over a host's.
			...(effectiveAssetPicker
				? { assetPicker: effectiveAssetPicker, pickAssets }
				: {}),
			...(effectiveAssetUploader
				? { assetUploader: effectiveAssetUploader }
				: {}),
			...(clipboard ? { clipboard } : {}),
			uploadStore,
		}),
		[
			historyStore,
			toolStore,
			selectionStore,
			focusStore,
			viewportStore,
			guidesStore,
			draftStore,
			editingStore,
			pagesStore,
			sceneStore,
			aiJobStore,
			cropStore,
			penStore,
			pathEditStore,
			getIR,
			commit,
			commitCoalesced,
			commitBatch,
			undo,
			redo,
			fieldPreviewStore,
			resolvedDocumentStore,
			rulerGuideStore,
			isolationStore,
			componentScopeStore,
			exportRequestStore,
			layerRenameStore,
			replaceDocument,
			pickAsset,
			hasImagePicker,
			requestAiIntent,
			brandKit,
			fontCatalog,
			brandGovernance,
			quarantinedSnapshotKeys,
			onAnalyticsEvent,
			onGovernanceAuditEvent,
			onGovernanceDeepLink,
			templates,
			templateProvider,
			componentProvider,
			externalComponents,
			componentVariants,
			onCreateDocument,
			onExport,
			t,
			kindRenderers,
			kindInspectors,
			effectiveToolRegistry,
			runtime,
			continuousCreation,
			autoLayout,
			localComponents,
			onLayoutEvent,
			onComponentEvent,
			persistenceAdapter,
			saveStatusStore,
			save,
			canLeave,
			flush,
			effectiveAssetPicker,
			pickAssets,
			effectiveAssetUploader,
			clipboard,
			uploadStore,
		],
	);

	// T-M4-11: wire the commit-only diagnostic emitter (see events.ts for the
	// preview-skip + hash-dedupe discipline).
	useEffect(() => {
		if (!onLayoutEvent) return;
		return createLayoutDiagnosticEmitter(
			{
				subscribe: resolvedDocumentStore.subscribe,
				getDiagnostics: () =>
					resolvedDocumentStore.getState().resolved.diagnostics,
				getInputHash: () => resolvedDocumentStore.getState().resolved.inputHash,
				hasPreviews: () =>
					Object.keys(fieldPreviewStore.getState().previews).length > 0,
			},
			onLayoutEvent,
		);
	}, [onLayoutEvent, resolvedDocumentStore, fieldPreviewStore]);

	// Full value = stable half + live state. Changes on every commit (ir) and on
	// page/stage changes — this is what `useCanvasStudio()` consumers subscribe to.
	const ctxValue = useMemo<CanvasStudioContextValue>(
		() => ({
			...stableCtxValue,
			stage,
			activePageId,
			ir,
			// AC-010: WeakMap-cached per document object — free on re-render.
			documentReadOnly: isDocumentCapabilityReadOnly(ir),
		}),
		[stableCtxValue, stage, activePageId, ir],
	);

	// C-09 (FR-055): exterior-dim set while a container is isolated.
	const isolationPath = useSyncExternalStore(
		isolationStore.subscribe,
		() => isolationStore.getState().path,
		() => isolationStore.getState().path,
	);
	const dimmedIds = useMemo(() => {
		if (isolationPath.length === 0) return null;
		const page = ir.pages.find((p) => p.id === activePageId);
		return page ? computeDimmedIds(page, isolationPath) : null;
	}, [isolationPath, ir, activePageId]);

	// FR-172 recovery actions (B-15). Reload rebuilds every store around the
	// CURRENT IR via `replaceDocument` — the document survives; wedged
	// transient state (selection, drafts, history) is discarded. Export
	// downloads the live IR as JSON so nothing is lost even mid-crash.
	// Declared ABOVE the missing-page early return below: hooks after a
	// conditional return crash React ("Rendered fewer hooks than expected")
	// the moment `activePageId` points at a page the IR no longer has.
	const reloadDocument = useCallback(() => {
		replaceDocument(getIR(), "recovery");
	}, [replaceDocument, getIR]);
	const exportRecovery = useCallback(() => {
		const doc = getIR();
		const blob = new Blob([JSON.stringify(doc, null, "\t")], {
			type: "application/json",
		});
		const url = URL.createObjectURL(blob);
		const a = document.createElement("a");
		a.href = url;
		a.download = `canvas-recovery-${doc.id}.json`;
		a.click();
		URL.revokeObjectURL(url);
	}, [getIR]);

	// Plan 0023 M5-03: the Source being edited, if any. Read from the live scope
	// stack so entering/leaving a Source re-renders the stage; `undefined` (the
	// normal case) leaves every path below on the page tree exactly as before. A
	// frame whose definition has since disappeared also falls back to the page
	// rather than rendering nothing — the breadcrumb still offers the way out.
	const activeComponentId = useSyncExternalStore(
		componentScopeStore.subscribe,
		() => componentScopeStore.getState().activeFrame()?.componentId,
		() => undefined,
	);
	const sourceRoot = activeComponentId
		? ir.components?.[activeComponentId]?.root
		: undefined;

	const activePage = ir.pages.find((p) => p.id === activePageId);
	if (!activePage) {
		return (
			<div data-testid="canvas-empty">
				No page with id "{activePageId}" found
			</div>
		);
	}

	// The Konva stage + its overlays. Computed once so it can be slotted either
	// into the legacy bare layout or anywhere a `renderShell` decides to place
	// it (e.g. the centre column of the reference editor grid).
	const stageNode = (
		<EditorStage
			t={t}
			activePage={activePage}
			activePageId={activePageId}
			sourceRoot={sourceRoot}
			assets={rehydratedAssets}
			brandKit={brandKit}
			width={width}
			height={height}
			zoom={zoom}
			panX={panX}
			panY={panY}
			onError={onError}
			onReloadDocument={reloadDocument}
			onExportRecovery={exportRecovery}
			renderErrorDetails={renderErrorDetails}
			onStageReady={handleStageReady}
			draggedIds={draggedIds}
			dimmedIds={dimmedIds}
			toolRegistry={effectiveToolRegistry}
		/>
	);
	// FR-164: the recover-draft prompt rides with the stage so it sits under
	// the workspace's dialog host when a shell is composed around it.
	const stageWithRecovery = recoveryAdapter ? (
		<>
			{stageNode}
			<RecoverDraftPrompt
				adapter={recoveryAdapter}
				onRecoveryError={reportLoadError}
			/>
		</>
	) : (
		stageNode
	);
	// AC-010 affordance (review 0022 P2-2): blocked commits are otherwise
	// invisible — every edit silently no-ops. One status strip keyed off the
	// same check as the commit guards, riding with the stage so the bare
	// layout and any `renderShell` composition both show it. Inline-styled
	// like the bare layout: partial hosts may not load the compiled CSS.
	const stageWithChrome = isDocumentCapabilityReadOnly(ir) ? (
		<>
			<div
				role="status"
				data-testid="canvas-readonly-banner"
				style={{
					background: "rgba(245, 158, 11, 0.15)",
					borderBottom: "1px solid rgba(245, 158, 11, 0.4)",
					fontSize: 12,
					lineHeight: 1.4,
					padding: "6px 12px",
				}}
			>
				{t(
					"canvas.readOnly.banner",
					"This document requires a capability this editor does not support. Editing is disabled; viewing and export remain available.",
				)}
			</div>
			{stageWithRecovery}
		</>
	) : (
		stageWithRecovery
	);
	// cp1-004: the toaster bridge rides with the stage so it lands INSIDE the
	// shell's toast host. Nothing is added to the tree when the host owns asset
	// ingress — that path stays byte-identical to the pre-cp1-004 render.
	const stageContent = localAssetFallback ? (
		<>
			{stageWithChrome}
			<CanvasToasterBridge sink={assetFallbackToasterRef} />
		</>
	) : (
		stageWithChrome
	);
	return (
		<CanvasStudioContext value={ctxValue}>
			<CanvasStudioStableContext value={stableCtxValue}>
				{renderShell ? (
					renderShell(stageContent)
				) : (
					<div
						data-testid="canvas-studio-root"
						style={{ display: "flex", flexDirection: "column" }}
					>
						<ToolAnnouncer />
						<ZoomAnnouncer />
						<LayoutAnnouncer />
						{!hidePageNavigator && <PageNavigator />}
						{stageContent}
					</div>
				)}
				<CanvasKeyboardLayer />
				<SceneAccessibilityTree />
				{onSelectionChange ? (
					<HostSelectionBridge
						selectionStore={selectionStore}
						callbackRef={onSelectionChangeRef}
					/>
				) : null}
				{children}
			</CanvasStudioStableContext>
		</CanvasStudioContext>
	);
}
