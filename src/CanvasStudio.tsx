"use client";

import {
	type CanvasChange,
	type CanvasCommand,
	type CanvasIR,
	commandToChange,
} from "@anvilkit/canvas-core";
import type Konva from "konva";
import {
	useCallback,
	useEffect,
	useMemo,
	useRef,
	useState,
	useSyncExternalStore,
} from "react";
import { CanvasFocusRing } from "./a11y/CanvasFocusRing.js";
import { SceneAccessibilityTree } from "./a11y/SceneAccessibilityTree.js";
import { ToolAnnouncer } from "./a11y/ToolAnnouncer.js";
import { CanvasKeyboardLayer } from "./a11y/useCanvasKeyboard.js";
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
import { CanvasTransformer } from "./selection/CanvasTransformer.js";
import { CropEditorOverlay } from "./selection/CropEditorOverlay.js";
import { PathEditOverlay } from "./selection/PathEditOverlay.js";
import { SmartGuideOverlay } from "./snap/SmartGuideOverlay.js";
import { CanvasAssetsContext } from "./stage/CanvasAssetsContext.js";
import { CanvasBrandKitContext } from "./stage/CanvasBrandKitContext.js";
import { CanvasNodeRenderer } from "./stage/CanvasNodeRenderer.js";
import { CanvasStage } from "./stage/CanvasStage.js";
import { DesignBackground } from "./stage/DesignBackground.js";
import { Grid } from "./stage/Grid.js";
import { RemoteCursors } from "./stage/RemoteCursors.js";
import { RemoteSelections } from "./stage/RemoteSelections.js";
import { RenderLayer } from "./stage/RenderLayer.js";
import { createAiJobStore } from "./stores/ai-job-store.js";
import { createCropStore } from "./stores/crop-store.js";
import { createDraftStore } from "./stores/draft-store.js";
import { createEditingStore } from "./stores/editing-store.js";
import { createFocusStore } from "./stores/focus-store.js";
import { createGuidesStore } from "./stores/guides-store.js";
import { createHistoryStore } from "./stores/history-store.js";
import { createPagesStore } from "./stores/pages-store.js";
import { createPathEditStore } from "./stores/path-edit-store.js";
import { createPenStore } from "./stores/pen-store.js";
import { createSceneStore } from "./stores/scene-store.js";
import { createSelectionStore } from "./stores/selection-store.js";
import { createToolStore, type ToolId } from "./stores/tool-store.js";
import { createViewportStore } from "./stores/viewport-store.js";
import type { CanvasTemplateEntry } from "./templates/template-entry.js";
import type { AiToolIntent } from "./tools/ai-intent.js";
import { DraftRenderer } from "./tools/DraftRenderer.js";
import { PenPreview } from "./tools/PenPreview.js";
import { PenToolOverlay } from "./tools/PenToolOverlay.js";
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
	onChange?: (ir: CanvasIR, command: CanvasCommand) => void;
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
	onStageReady,
	toolRegistry,
	hidePageNavigator,
	brandKit,
	templates,
	messages,
	extensions,
	renderShell,
	children,
}: CanvasStudioProps): React.JSX.Element {
	const [sceneStore] = useState(() => createSceneStore({ initialIR }));
	const ir = useSyncExternalStore(
		sceneStore.subscribe,
		() => sceneStore.getState().ir,
		() => sceneStore.getState().ir,
	);
	const [stage, setStage] = useState<Konva.Stage | null>(null);
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

	const [historyStore] = useState(() => createHistoryStore());
	const [toolStore] = useState(() => createToolStore({ initialTool }));
	const [selectionStore] = useState(() => createSelectionStore());
	const [focusStore] = useState(() => createFocusStore());
	const [viewportStore] = useState(() => createViewportStore());
	const [pagesStore] = useState(() =>
		createPagesStore({
			initialActivePageId: initialActivePageId ?? initialIR.pages[0]?.id ?? "",
		}),
	);
	const activePageId = useSyncExternalStore(
		pagesStore.subscribe,
		() => pagesStore.getState().activePageId,
		() => pagesStore.getState().activePageId,
	);

	const onActivePageChangeRef = useRef(onActivePageChange);
	useEffect(() => {
		onActivePageChangeRef.current = onActivePageChange;
	}, [onActivePageChange]);
	useEffect(() => {
		onActivePageChangeRef.current?.(activePageId);
	}, [activePageId]);

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
	const [guidesStore] = useState(() => createGuidesStore());
	const [draftStore] = useState(() => createDraftStore());
	const [editingStore] = useState(() => createEditingStore());
	const [aiJobStore] = useState(() => createAiJobStore());
	const [cropStore] = useState(() => createCropStore());
	const [penStore] = useState(() => createPenStore());
	const [pathEditStore] = useState(() => createPathEditStore());

	const onChangeRef = useRef(onChange);
	const onChangesRef = useRef(onChanges);
	const onPickAssetRef = useRef(onPickAsset);
	const onAiIntentRef = useRef(onAiIntent);
	useEffect(() => {
		onChangeRef.current = onChange;
	}, [onChange]);
	useEffect(() => {
		onChangesRef.current = onChanges;
	}, [onChanges]);
	useEffect(() => {
		onPickAssetRef.current = onPickAsset;
	}, [onPickAsset]);
	useEffect(() => {
		onAiIntentRef.current = onAiIntent;
	}, [onAiIntent]);

	const commit = useCallback(
		(cmd: CanvasCommand): CanvasIR => {
			const next = historyStore
				.getState()
				.commit(sceneStore.getState().ir, cmd);
			sceneStore.getState().setIR(next);
			onChangeRef.current?.(next, cmd);
			if (onChangesRef.current) {
				const change = commandToChange(cmd);
				onChangesRef.current(change ? [change] : [], next);
			}
			return next;
		},
		[historyStore, sceneStore],
	);

	// Apply many commands as ONE undo entry (multi-select move, transform commit,
	// ungroup). Fires onChange (with the composite batch command) and onChanges once.
	const commitBatch = useCallback(
		(commands: readonly CanvasCommand[], label?: string): CanvasIR => {
			if (commands.length === 0) return sceneStore.getState().ir;
			const next = historyStore
				.getState()
				.commitBatch(sceneStore.getState().ir, commands, label);
			sceneStore.getState().setIR(next);
			const batchCmd: CanvasCommand = {
				type: "batch",
				...(label !== undefined ? { label } : {}),
				commands: [...commands],
			};
			onChangeRef.current?.(next, batchCmd);
			if (onChangesRef.current) {
				const changes = commands
					.map(commandToChange)
					.filter((c): c is CanvasChange => c !== null);
				onChangesRef.current(changes, next);
			}
			return next;
		},
		[historyStore, sceneStore],
	);

	const getIR = useCallback(() => sceneStore.getState().ir, [sceneStore]);

	const pickAsset = useCallback(async () => {
		const fn = onPickAssetRef.current;
		if (!fn) {
			throw new Error(
				"onPickAsset prop is required to use the image tool (MVP-6 Task 8).",
			);
		}
		return fn();
	}, []);

	// Stable seam for the AI tools (I1-7). Always defined; a no-op when no host
	// wired `onAiIntent`. The AI tools call it on gesture completion.
	const requestAiIntent = useCallback((intent: AiToolIntent) => {
		onAiIntentRef.current?.(intent);
	}, []);

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
			commitBatch,
			pickAsset,
			requestAiIntent,
			brandKit,
			templates,
			t,
			kindRenderers,
			kindInspectors,
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
			commitBatch,
			pickAsset,
			requestAiIntent,
			brandKit,
			templates,
			t,
			kindRenderers,
			kindInspectors,
		],
	);

	// Full value = stable half + live state. Changes on every commit (ir) and on
	// page/stage changes — this is what `useCanvasStudio()` consumers subscribe to.
	const ctxValue = useMemo<CanvasStudioContextValue>(
		() => ({ ...stableCtxValue, stage, activePageId, ir }),
		[stableCtxValue, stage, activePageId, ir],
	);

	const activePage = ir.pages.find((p) => p.id === activePageId);
	if (!activePage) {
		return (
			<div data-testid="canvas-empty">
				No page with id "{activePageId}" found
			</div>
		);
	}
	// The stage box scales with zoom so the page grows/shrinks as a whole and
	// Konva pointer mapping stays correct (scaleX=zoom over a zoom-sized box).
	// At zoom = 1 this is the page's natural pixel size (unchanged). This is
	// what lets the multi-page workspace scale every page uniformly via zoom.
	const stageWidth = (width ?? activePage.size.width) * zoom;
	const stageHeight = (height ?? activePage.size.height) * zoom;
	// The Konva stage + its overlays. Computed once so it can be slotted either
	// into the legacy bare layout or anywhere a `renderShell` decides to place
	// it (e.g. the centre column of the reference editor grid).
	const stageNode = (
		<CanvasErrorBoundary
			label={t("canvas.error.canvas", "The canvas failed to render.")}
			resetKey={activePageId}
		>
			<CanvasAssetsContext.Provider value={ir.assets}>
				<CanvasBrandKitContext.Provider value={brandKit ?? EMPTY_BRAND_KIT}>
					<CanvasStage
						width={stageWidth}
						height={stageHeight}
						zoom={zoom}
						panX={panX}
						panY={panY}
						onReady={handleStageReady}
					>
						<RenderLayer name="background" listening={false}>
							<DesignBackground />
							<Grid />
						</RenderLayer>
						<RenderLayer name="objects">
							{activePage.root.children.flatMap((node) =>
								draggedIds.has(node.id)
									? []
									: [<CanvasNodeRenderer key={node.id} node={node} />],
							)}
						</RenderLayer>
						{/* I2-5: dragged nodes float on their own layer so only it
				    redraws during a drag; the (cached) objects layer stays put. */}
						<RenderLayer name="drag">
							{activePage.root.children.flatMap((node) =>
								draggedIds.has(node.id)
									? [<CanvasNodeRenderer key={node.id} node={node} />]
									: [],
							)}
						</RenderLayer>
						<RenderLayer name="selection">
							<DraftRenderer />
							<SmartGuideOverlay />
							<PenPreview />
							<PathEditOverlay />
							<CanvasTransformer />
							<CanvasFocusRing />
						</RenderLayer>
						<RenderLayer name="presence" listening={false}>
							<RemoteCursors />
							<RemoteSelections />
						</RenderLayer>
					</CanvasStage>
					<ToolInteractionLayer registry={effectiveToolRegistry} />
					<TextEditorOverlay />
					<CropEditorOverlay />
					<PenToolOverlay />
				</CanvasBrandKitContext.Provider>
			</CanvasAssetsContext.Provider>
		</CanvasErrorBoundary>
	);
	return (
		<CanvasStudioContext value={ctxValue}>
			<CanvasStudioStableContext value={stableCtxValue}>
				{renderShell ? (
					renderShell(stageNode)
				) : (
					<div
						data-testid="canvas-studio-root"
						style={{ display: "flex", flexDirection: "column" }}
					>
						<ToolAnnouncer />
						{!hidePageNavigator && <PageNavigator />}
						{stageNode}
					</div>
				)}
				<CanvasKeyboardLayer />
				<SceneAccessibilityTree />
				{children}
			</CanvasStudioStableContext>
		</CanvasStudioContext>
	);
}
