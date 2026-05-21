export type { CanvasStudioProps } from "./CanvasStudio.js";
export { CanvasStudio } from "./CanvasStudio.js";
export type {
	CanvasIRGetter,
	CanvasStudioContextValue,
} from "./context/canvas-studio-context.js";
export {
	CanvasStudioContext,
	useCanvasStudio,
} from "./context/canvas-studio-context.js";
export type { ClonePageOptions } from "./pages/clone-page.js";
export { clonePage, regenerateIds } from "./pages/clone-page.js";
export type { PageNavigatorProps } from "./pages/PageNavigator.js";
export { PageNavigator } from "./pages/PageNavigator.js";
export type { AddPageOptions } from "./pages/page-actions.js";
export {
	addPage,
	deletePage,
	duplicateCurrentPage,
	renamePage,
	reorderPage,
	switchToPage,
} from "./pages/page-actions.js";
export type { LayerPanelProps } from "./panels/LayerPanel.js";
export { LayerPanel } from "./panels/LayerPanel.js";
export type { PropertyInspectorProps } from "./panels/PropertyInspector.js";
export { PropertyInspector } from "./panels/PropertyInspector.js";
export type {
	RasterizePageInput,
	RasterizePageResult,
} from "./render/rasterize-page.js";
export { rasterizePage } from "./render/rasterize-page.js";
export { CanvasTransformer } from "./selection/CanvasTransformer.js";
export {
	getNodeWorldRect,
	getOtherNodeRects,
} from "./snap/get-node-rect.js";
export {
	SMART_GUIDE_COLOR,
	SMART_GUIDE_DASH,
	SmartGuideOverlay,
} from "./snap/SmartGuideOverlay.js";
export {
	computeSnap,
	DEFAULT_SNAP_THRESHOLD,
} from "./snap/snap-engine.js";
export type {
	SmartGuide,
	SnapAxis,
	SnapInput,
	SnapRect,
	SnapResult,
} from "./snap/snap-types.js";
export {
	CanvasAssetsContext,
	useCanvasAsset,
} from "./stage/CanvasAssetsContext.js";
export type { CanvasNodeRendererProps } from "./stage/CanvasNodeRenderer.js";
export { CanvasNodeRenderer } from "./stage/CanvasNodeRenderer.js";
export type { CanvasStageProps } from "./stage/CanvasStage.js";
export { CanvasStage } from "./stage/CanvasStage.js";
export { DesignBackground } from "./stage/DesignBackground.js";
export { Grid } from "./stage/Grid.js";
export { RemoteCursors } from "./stage/RemoteCursors.js";
export { RemoteSelections } from "./stage/RemoteSelections.js";
export type { RenderLayerName, RenderLayerProps } from "./stage/RenderLayer.js";
export { RenderLayer } from "./stage/RenderLayer.js";
export type {
	DraftState,
	DraftStoreApi,
	DrawDraft,
} from "./stores/draft-store.js";
export { createDraftStore } from "./stores/draft-store.js";
export type {
	EditingState,
	EditingStoreApi,
} from "./stores/editing-store.js";
export { createEditingStore } from "./stores/editing-store.js";
export type { GuidesState, GuidesStoreApi } from "./stores/guides-store.js";
export { createGuidesStore } from "./stores/guides-store.js";
export type {
	CreateHistoryStoreOptions,
	HistoryState,
	HistoryStoreApi,
} from "./stores/history-store.js";
export {
	createHistoryStore,
	DEFAULT_HISTORY_LIMIT,
} from "./stores/history-store.js";
export type {
	CreatePagesStoreOptions,
	PagesState,
	PagesStoreApi,
} from "./stores/pages-store.js";
export { createPagesStore } from "./stores/pages-store.js";
export type {
	SelectionState,
	SelectionStoreApi,
} from "./stores/selection-store.js";
export { createSelectionStore } from "./stores/selection-store.js";
export type {
	CreateToolStoreOptions,
	ToolId,
	ToolState,
	ToolStoreApi,
} from "./stores/tool-store.js";
export {
	createToolStore,
	DEFAULT_TOOL,
} from "./stores/tool-store.js";
export type {
	CreateViewportStoreOptions,
	ViewportState,
	ViewportStoreApi,
} from "./stores/viewport-store.js";
export {
	createViewportStore,
	DEFAULT_GRID_SIZE,
} from "./stores/viewport-store.js";
export {
	DRAFT_DASH,
	DRAFT_STROKE_COLOR,
	DraftRenderer,
} from "./tools/DraftRenderer.js";
export { snapPoint } from "./tools/draw-snap.js";
export { ellipseTool } from "./tools/ellipse-tool.js";
export type { StagePointer } from "./tools/get-stage-pointer.js";
export { getStagePointer } from "./tools/get-stage-pointer.js";
export { handTool } from "./tools/hand-tool.js";
export { imageTool } from "./tools/image-tool.js";
export { lineTool } from "./tools/line-tool.js";
export { rectTool } from "./tools/rect-tool.js";
export { selectTool } from "./tools/select-tool.js";
export { TextEditorOverlay } from "./tools/TextEditorOverlay.js";
export type { ToolInteractionLayerProps } from "./tools/ToolInteractionLayer.js";
export { ToolInteractionLayer } from "./tools/ToolInteractionLayer.js";
export { textTool } from "./tools/text-tool.js";
export {
	buildToolRegistry,
	defaultToolRegistry,
} from "./tools/tool-registry.js";
export type {
	Tool,
	ToolContext,
	ToolPointerEvent,
	ToolRegistry,
} from "./tools/tool-types.js";
