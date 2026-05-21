"use client";

import type { CanvasCommand, CanvasIR } from "@anvilkit/canvas-core";
import type Konva from "konva";
import {
	useCallback,
	useEffect,
	useMemo,
	useRef,
	useState,
	useSyncExternalStore,
} from "react";
import {
	CanvasStudioContext,
	type CanvasStudioContextValue,
} from "./context/canvas-studio-context.js";
import { CanvasAssetsContext } from "./stage/CanvasAssetsContext.js";
import { CanvasNodeRenderer } from "./stage/CanvasNodeRenderer.js";
import { CanvasStage } from "./stage/CanvasStage.js";
import { DesignBackground } from "./stage/DesignBackground.js";
import { Grid } from "./stage/Grid.js";
import { RemoteCursors } from "./stage/RemoteCursors.js";
import { RemoteSelections } from "./stage/RemoteSelections.js";
import { RenderLayer } from "./stage/RenderLayer.js";
import { CanvasTransformer } from "./selection/CanvasTransformer.js";
import { SmartGuideOverlay } from "./snap/SmartGuideOverlay.js";
import { createDraftStore } from "./stores/draft-store.js";
import { createEditingStore } from "./stores/editing-store.js";
import { createGuidesStore } from "./stores/guides-store.js";
import { createHistoryStore } from "./stores/history-store.js";
import { createPagesStore } from "./stores/pages-store.js";
import { createSelectionStore } from "./stores/selection-store.js";
import { createToolStore, type ToolId } from "./stores/tool-store.js";
import { createViewportStore } from "./stores/viewport-store.js";
import { PageNavigator } from "./pages/PageNavigator.js";
import { DraftRenderer } from "./tools/DraftRenderer.js";
import { TextEditorOverlay } from "./tools/TextEditorOverlay.js";
import { ToolInteractionLayer } from "./tools/ToolInteractionLayer.js";
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
	/** Required for the image tool (MVP-6 Task 8). Host opens picker, returns asset id. */
	onPickAsset?: () => Promise<string>;
	/** Tool registry override (mainly for tests). Defaults to the built-in registry. */
	toolRegistry?: ToolRegistry;
	/** Suppress the built-in `<PageNavigator>` (e.g. hosts that bring their own). */
	hidePageNavigator?: boolean;
}

export function CanvasStudio({
	initialIR,
	initialActivePageId,
	width,
	height,
	initialTool,
	onChange,
	onPickAsset,
	toolRegistry,
	hidePageNavigator,
}: CanvasStudioProps): React.JSX.Element {
	const [ir, setIR] = useState<CanvasIR>(initialIR);
	const irRef = useRef<CanvasIR>(ir);
	const [stage, setStage] = useState<Konva.Stage | null>(null);

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

	const onChangeRef = useRef(onChange);
	const onPickAssetRef = useRef(onPickAsset);
	useEffect(() => {
		onChangeRef.current = onChange;
	}, [onChange]);
	useEffect(() => {
		onPickAssetRef.current = onPickAsset;
	}, [onPickAsset]);

	const commit = useCallback(
		(cmd: CanvasCommand): CanvasIR => {
			const next = historyStore.getState().commit(irRef.current, cmd);
			irRef.current = next;
			setIR(next);
			onChangeRef.current?.(next, cmd);
			return next;
		},
		[historyStore],
	);

	const getIR = useCallback(() => irRef.current, []);

	const pickAsset = useCallback(async () => {
		const fn = onPickAssetRef.current;
		if (!fn) {
			throw new Error(
				"onPickAsset prop is required to use the image tool (MVP-6 Task 8).",
			);
		}
		return fn();
	}, []);

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
			getIR,
			commit,
			pickAsset,
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
			getIR,
			commit,
			pickAsset,
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
				{!hidePageNavigator && <PageNavigator />}
				<CanvasAssetsContext.Provider value={ir.assets}>
					<CanvasStage
						width={stageWidth}
						height={stageHeight}
						zoom={zoom}
						panX={panX}
						panY={panY}
						onReady={setStage}
					>
						<RenderLayer name="background" listening={false}>
							<DesignBackground />
							<Grid />
						</RenderLayer>
						<RenderLayer name="objects">
							{activePage.root.children.map((node) => (
								<CanvasNodeRenderer key={node.id} node={node} />
							))}
						</RenderLayer>
						<RenderLayer name="selection">
							<DraftRenderer />
							<SmartGuideOverlay />
							<CanvasTransformer />
						</RenderLayer>
						<RenderLayer name="presence" listening={false}>
							<RemoteCursors />
							<RemoteSelections />
						</RenderLayer>
					</CanvasStage>
					<ToolInteractionLayer registry={toolRegistry} />
					<TextEditorOverlay />
				</CanvasAssetsContext.Provider>
			</div>
		</CanvasStudioContext.Provider>
	);
}
