"use client";

import type { CanvasCommand, CanvasIR } from "@anvilkit/canvas-core";
import type Konva from "konva";
import type { BrandKit } from "./brand/brand-kit.js";
import {
	useCallback,
	useEffect,
	useMemo,
	useRef,
	useState,
	useSyncExternalStore,
} from "react";
import { ToolAnnouncer } from "./a11y/ToolAnnouncer.js";
import {
	CanvasStudioContext,
	type CanvasStudioContextValue,
} from "./context/canvas-studio-context.js";
import { PageNavigator } from "./pages/PageNavigator.js";
import { CanvasTransformer } from "./selection/CanvasTransformer.js";
import { SmartGuideOverlay } from "./snap/SmartGuideOverlay.js";
import { CanvasAssetsContext } from "./stage/CanvasAssetsContext.js";
import { CanvasNodeRenderer } from "./stage/CanvasNodeRenderer.js";
import { CanvasStage } from "./stage/CanvasStage.js";
import { DesignBackground } from "./stage/DesignBackground.js";
import { Grid } from "./stage/Grid.js";
import { RemoteCursors } from "./stage/RemoteCursors.js";
import { RemoteSelections } from "./stage/RemoteSelections.js";
import { RenderLayer } from "./stage/RenderLayer.js";
import { CropEditorOverlay } from "./selection/CropEditorOverlay.js";
import { PathEditOverlay } from "./selection/PathEditOverlay.js";
import { createAiJobStore } from "./stores/ai-job-store.js";
import { createCropStore } from "./stores/crop-store.js";
import { createDraftStore } from "./stores/draft-store.js";
import { createEditingStore } from "./stores/editing-store.js";
import { createPathEditStore } from "./stores/path-edit-store.js";
import { createPenStore } from "./stores/pen-store.js";
import { createGuidesStore } from "./stores/guides-store.js";
import { createHistoryStore } from "./stores/history-store.js";
import { createPagesStore } from "./stores/pages-store.js";
import { createSceneStore } from "./stores/scene-store.js";
import { createSelectionStore } from "./stores/selection-store.js";
import { createToolStore, type ToolId } from "./stores/tool-store.js";
import { createViewportStore } from "./stores/viewport-store.js";
import { draggedIdsKey } from "./perf/active-nodes.js";
import { useStaticGroupCache } from "./perf/static-cache.js";
import { DraftRenderer } from "./tools/DraftRenderer.js";
import { PenPreview } from "./tools/PenPreview.js";
import { PenToolOverlay } from "./tools/PenToolOverlay.js";
import { TextEditorOverlay } from "./tools/TextEditorOverlay.js";
import { ToolInteractionLayer } from "./tools/ToolInteractionLayer.js";
import type { AiToolIntent } from "./tools/ai-intent.js";
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
	 * Shared brand colors + fonts (I3-4). Hosts map their Studio config to a
	 * {@link BrandKit} and pass it here; the editor surfaces it via
	 * {@link useBrandKit}. Omit to run with no brand kit.
	 */
	brandKit?: BrandKit;
}

export function CanvasStudio({
	initialIR,
	initialActivePageId,
	width,
	height,
	initialTool,
	onChange,
	onActivePageChange,
	onPickAsset,
	onAiIntent,
	onStageReady,
	toolRegistry,
	hidePageNavigator,
	brandKit,
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
	const onPickAssetRef = useRef(onPickAsset);
	const onAiIntentRef = useRef(onAiIntent);
	useEffect(() => {
		onChangeRef.current = onChange;
	}, [onChange]);
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

	const ctxValue = useMemo<CanvasStudioContextValue>(
		() => ({
			historyStore,
			toolStore,
			selectionStore,
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
			pickAsset,
			requestAiIntent,
			brandKit,
			stage,
			activePageId,
			ir,
		}),
		[
			historyStore,
			toolStore,
			selectionStore,
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
			pickAsset,
			requestAiIntent,
			brandKit,
			stage,
			activePageId,
			ir,
		],
	);

	const activePage = ir.pages.find((p) => p.id === activePageId);
	if (!activePage) {
		return (
			<div data-testid="canvas-empty">
				No page with id "{activePageId}" found
			</div>
		);
	}
	const stageWidth = width ?? activePage.size.width;
	const stageHeight = height ?? activePage.size.height;
	return (
		<CanvasStudioContext.Provider value={ctxValue}>
			<div
				data-testid="canvas-studio-root"
				style={{ display: "flex", flexDirection: "column" }}
			>
				<ToolAnnouncer />
				{!hidePageNavigator && <PageNavigator />}
				<CanvasAssetsContext.Provider value={ir.assets}>
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
							{activePage.root.children
								.filter((node) => !draggedIds.has(node.id))
								.map((node) => (
									<CanvasNodeRenderer key={node.id} node={node} />
								))}
						</RenderLayer>
						{/* I2-5: dragged nodes float on their own layer so only it
						    redraws during a drag; the (cached) objects layer stays put. */}
						<RenderLayer name="drag">
							{activePage.root.children
								.filter((node) => draggedIds.has(node.id))
								.map((node) => (
									<CanvasNodeRenderer key={node.id} node={node} />
								))}
						</RenderLayer>
						<RenderLayer name="selection">
							<DraftRenderer />
							<SmartGuideOverlay />
							<PenPreview />
							<PathEditOverlay />
							<CanvasTransformer />
						</RenderLayer>
						<RenderLayer name="presence" listening={false}>
							<RemoteCursors />
							<RemoteSelections />
						</RenderLayer>
					</CanvasStage>
					<ToolInteractionLayer registry={toolRegistry} />
					<TextEditorOverlay />
					<CropEditorOverlay />
					<PenToolOverlay />
				</CanvasAssetsContext.Provider>
			</div>
		</CanvasStudioContext.Provider>
	);
}
