"use client";

import {
	type CanvasChange,
	type CanvasCommand,
	CanvasCommandError,
	type CanvasIR,
	type CanvasRuntime,
	commandToChange,
} from "@anvilkit/canvas-core";
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
import { SceneAccessibilityTree } from "./a11y/SceneAccessibilityTree.js";
import { ToolAnnouncer } from "./a11y/ToolAnnouncer.js";
import { CanvasKeyboardLayer } from "./a11y/useCanvasKeyboard.js";
import type {
	CanvasAssetPicker,
	CanvasAssetUploader,
} from "./assets/adapter-types.js";
import type { BrandKit } from "./brand/brand-kit.js";
import { EMPTY_BRAND_KIT } from "./brand/brand-kit.js";
import { CanvasErrorBoundary } from "./CanvasErrorBoundary.js";
import {
	CanvasStudioContext,
	type CanvasStudioContextValue,
	CanvasStudioStableContext,
	type CanvasStudioStableValue,
	type CanvasT,
} from "./context/canvas-studio-context.js";
import type {
	CanvasEditorExtension,
	CanvasKindInspector,
	CanvasKindRenderer,
} from "./extensions/editor-extension.js";
import { PageNavigator } from "./pages/PageNavigator.js";
import { draggedIdsKey } from "./perf/active-nodes.js";
import { useStaticGroupCache } from "./perf/static-cache.js";
import { RecoverDraftPrompt } from "./persistence/RecoverDraftPrompt.js";
import {
	type CanvasRecoveryAdapter,
	createRecoveryController,
} from "./persistence/recovery.js";
import {
	createSaveController,
	type SaveController,
} from "./persistence/save-controller.js";
import type {
	CanvasAutoSaveOptions,
	CanvasPersistenceAdapter,
} from "./persistence/types.js";
import { CanvasTransformer } from "./selection/CanvasTransformer.js";
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
import { createRulerGuideStore } from "./stores/ruler-guide-store.js";
import type { CanvasSaveState } from "./stores/save-status-store.js";
import { createSaveStatusStore } from "./stores/save-status-store.js";
import { createSceneStore } from "./stores/scene-store.js";
import { createSelectionStore } from "./stores/selection-store.js";
import { createToolStore, type ToolId } from "./stores/tool-store.js";
import { createUploadStore } from "./stores/upload-store.js";
import { createViewportStore } from "./stores/viewport-store.js";
import type { CanvasTemplateEntry } from "./templates/template-entry.js";
import type { CanvasTemplateProvider } from "./templates/template-provider.js";
import type { AiToolIntent } from "./tools/ai-intent.js";
import { DraftRenderer } from "./tools/DraftRenderer.js";
import { PenPreview } from "./tools/PenPreview.js";
import { PenToolOverlay } from "./tools/PenToolOverlay.js";
import { RichTextToolbar } from "./tools/RichTextToolbar.js";
import { TextEditorOverlay } from "./tools/TextEditorOverlay.js";
import { ToolInteractionLayer } from "./tools/ToolInteractionLayer.js";
import { defaultToolRegistry } from "./tools/tool-registry.js";
import type { ToolRegistry } from "./tools/tool-types.js";

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
	 * FR-160 host persistence (B-08). When present, edits mark the document
	 * dirty, auto-save runs per `autoSave` (default on), a beforeunload guard
	 * warns while unsaved (FR-163), and pending changes flush on unmount.
	 */
	persistenceAdapter?: CanvasPersistenceAdapter;
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
	 * FR-090 asset picker adapter (B-10). When present it supersedes
	 * `onPickAsset` for tools (single pick) and powers multi-select flows;
	 * the legacy `onPickAsset` keeps working unchanged.
	 */
	assetPicker?: CanvasAssetPicker;
	/** FR-091 upload adapter (B-10) — enables drag-and-drop + the Uploads panel. */
	assetUploader?: CanvasAssetUploader;
	/**
	 * Shared brand colors + fonts (I3-4). Hosts map their Studio config to a
	 * {@link BrandKit} and pass it here; the editor surfaces it via
	 * {@link useBrandKit}. Omit to run with no brand kit.
	 */
	brandKit?: BrandKit;
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
	const [exportRequestStore] = useState(() => createExportRequestStore());
	const [layerRenameStore] = useState(() => createLayerRenameStore());
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
		exportRequestStore,
		layerRenameStore,
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
) {
	const onChangeRef = useHostCallbackRef(onChange);
	const onChangesRef = useHostCallbackRef(onChanges);

	const commit = useCallback(
		(cmd: AnyCanvasCommand): CanvasIR => {
			const current = sceneStore.getState().ir;
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
		[historyStore, sceneStore, onChangeRef, onChangesRef],
	);

	// §10 field-input contract commit half (B-12): same pipeline as `commit`,
	// but successive calls sharing `mergeKey` inside the history store's merge
	// window fold into one undo entry.
	const commitCoalesced = useCallback(
		(cmd: AnyCanvasCommand, mergeKey: string): CanvasIR => {
			const current = sceneStore.getState().ir;
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
		[historyStore, sceneStore, onChangeRef, onChangesRef],
	);

	// Apply many commands as ONE undo entry (multi-select move, transform commit,
	// ungroup). Fires onChange (with the composite batch command) and onChanges once.
	const commitBatch = useCallback(
		(commands: readonly AnyCanvasCommand[], label?: string): CanvasIR => {
			if (commands.length === 0) return sceneStore.getState().ir;
			const current = sceneStore.getState().ir;
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

	const getIR = useCallback(() => sceneStore.getState().ir, [sceneStore]);

	return { commit, commitCoalesced, commitBatch, getIR };
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
	const storesRef = useRef(stores);
	storesRef.current = stores;
	return useCallback((ir: CanvasIR, source: DocumentSnapshotSource) => {
		replaceDocumentSnapshot(storesRef.current, ir, { source });
	}, []);
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
	onStageReady,
	draggedIds,
	dimmedIds,
	toolRegistry,
}: {
	t: CanvasT;
	activePage: CanvasIR["pages"][number];
	activePageId: string;
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
	const stageWidth = (width ?? activePage.size.width) * zoom;
	const stageHeight = (height ?? activePage.size.height) * zoom;
	return (
		<CanvasErrorBoundary
			label={t("canvas.error.canvas", "The canvas failed to render.")}
			resetKey={activePageId}
			{...(onError ? { onError } : {})}
			onReloadDocument={onReloadDocument}
			onExportRecovery={onExportRecovery}
			labels={{
				retry: t("canvas.error.retry", "Try again"),
				reloadDocument: t("canvas.error.reloadDocument", "Reload document"),
				exportRecovery: t(
					"canvas.error.exportRecovery",
					"Export recovery JSON",
				),
				copyErrorId: t("canvas.error.copyErrorId", "Copy error ID"),
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
									{activePage.root.children.flatMap((node) =>
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
								{activePage.root.children.flatMap((node) =>
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
	onPickAsset,
	onAiIntent,
	onError,
	onStageReady,
	toolRegistry,
	hidePageNavigator,
	brandKit,
	templates,
	templateProvider,
	onCreateDocument,
	messages,
	extensions,
	runtime,
	renderShell,
	continuousCreation = false,
	persistenceAdapter,
	recoveryAdapter,
	autoSave,
	onSaveStateChange,
	assetPicker,
	assetUploader,
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
		exportRequestStore,
		layerRenameStore,
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
	const { commit, commitCoalesced, commitBatch, getIR } = useCommitPipeline(
		sceneStore,
		historyStore,
		onChange,
		onChanges,
	);
	const replaceDocument = useReplaceDocument({
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
	});

	// B-08 save lifecycle. The controller subscribes to history state identity;
	// stable `save`/`canLeave` wrappers go into context so consumers never
	// re-render on controller recreation.
	const saveStatusStore = useMemo(() => createSaveStatusStore(), []);
	const uploadStore = useMemo(() => createUploadStore(), []);
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
				void controller.flush();
			}
		};
		window.addEventListener("beforeunload", onBeforeUnload);
		return () => {
			window.removeEventListener("beforeunload", onBeforeUnload);
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

	const pickAsset = useCallback(async () => {
		// FR-090 (B-10): a full assetPicker adapter supersedes the legacy
		// single-uri callback; `onPickAsset` keeps working unchanged.
		if (assetPicker) {
			const picked = await assetPicker.pick({ multiple: false, kind: "image" });
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
	}, [onPickAssetRef, assetPicker]);

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

	// P7 i18n resolver: host catalog (per-key) → inline English fallback → key.
	const t = useMemo<CanvasT>(
		() => (key, fallback) => messages?.[key] ?? fallback ?? key,
		[messages],
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

	// Merge extension-contributed tools into the registry handed to the tool
	// interaction layer (default tools + extension tools + the `toolRegistry`
	// prop, which wins). No extension tools → pass the prop through untouched so
	// the layer falls back to the default registry.
	const effectiveToolRegistry = useMemo(() => {
		const extTools = extensions?.flatMap((e) => e.tools ?? []) ?? [];
		if (extTools.length === 0) return toolRegistry;
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
			fieldPreviewStore,
			rulerGuideStore,
			isolationStore,
			exportRequestStore,
			layerRenameStore,
			replaceDocument,
			pickAsset,
			requestAiIntent,
			brandKit,
			templates,
			templateProvider,
			...(onCreateDocument ? { onCreateDocument } : {}),
			t,
			kindRenderers,
			kindInspectors,
			runtime,
			continuousCreation,
			// Present only with a persistence adapter — the header's save
			// indicator keys its visibility off this field (B-07).
			...(persistenceAdapter ? { saveStatusStore } : {}),
			save,
			canLeave,
			...(assetPicker ? { assetPicker } : {}),
			...(assetUploader ? { assetUploader } : {}),
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
			fieldPreviewStore,
			rulerGuideStore,
			isolationStore,
			exportRequestStore,
			layerRenameStore,
			replaceDocument,
			pickAsset,
			requestAiIntent,
			brandKit,
			templates,
			templateProvider,
			onCreateDocument,
			t,
			kindRenderers,
			kindInspectors,
			runtime,
			continuousCreation,
			persistenceAdapter,
			saveStatusStore,
			save,
			canLeave,
			assetPicker,
			assetUploader,
			uploadStore,
		],
	);

	// Full value = stable half + live state. Changes on every commit (ir) and on
	// page/stage changes — this is what `useCanvasStudio()` consumers subscribe to.
	const ctxValue = useMemo<CanvasStudioContextValue>(
		() => ({ ...stableCtxValue, stage, activePageId, ir }),
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
			assets={ir.assets}
			brandKit={brandKit}
			width={width}
			height={height}
			zoom={zoom}
			panX={panX}
			panY={panY}
			onError={onError}
			onReloadDocument={reloadDocument}
			onExportRecovery={exportRecovery}
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
			<RecoverDraftPrompt adapter={recoveryAdapter} />
		</>
	) : (
		stageNode
	);
	return (
		<CanvasStudioContext value={ctxValue}>
			<CanvasStudioStableContext value={stableCtxValue}>
				{renderShell ? (
					renderShell(stageWithRecovery)
				) : (
					<div
						data-testid="canvas-studio-root"
						style={{ display: "flex", flexDirection: "column" }}
					>
						<ToolAnnouncer />
						{!hidePageNavigator && <PageNavigator />}
						{stageWithRecovery}
					</div>
				)}
				<CanvasKeyboardLayer />
				<SceneAccessibilityTree />
				{children}
			</CanvasStudioStableContext>
		</CanvasStudioContext>
	);
}
