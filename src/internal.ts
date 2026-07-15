/**
 * `@anvilkit/canvas-editor/internal` — the editor's ADVANCED / EXTENSION surface
 * (W1). These exports back the editor's own implementation: tool definitions,
 * store factories, stage primitives, snap engine, and geometry helpers. They are
 * NOT part of the stable host-facing contract (that lives in the package root)
 * and may change between minor versions without notice. Import from here only
 * when building a custom tool/stage/store on top of the editor; prefer the root
 * entry for normal integration.
 */

// ── a11y ─────────────────────────────────────────────────────────────────────
export { TOOL_LABELS } from "./a11y/tool-labels.js";
// ── actions (M0-01 unified editor action layer) ──────────────────────────────
export {
	type CanvasDistributeAxis,
	type CanvasEditorActions,
	createCanvasEditorActions,
	useCanvasActions,
} from "./actions/editor-actions.js";
// ── chrome ───────────────────────────────────────────────────────────────────
export type { ChromeIcon, ToolDescriptor } from "./chrome/icons.js";
export { ChromeIcons, TOOL_RAIL_ITEMS } from "./chrome/icons.js";

// ── pages ────────────────────────────────────────────────────────────────────
export { regenerateIds } from "./pages/clone-page.js";

// ── selection (overlays + actions) ───────────────────────────────────────────
export { CanvasTransformer } from "./selection/CanvasTransformer.js";
export { CropEditorOverlay } from "./selection/CropEditorOverlay.js";
export {
	beginCrop,
	type CropDragMode,
	cancelCrop,
	commitCrop,
	computeCropDrag,
} from "./selection/crop-actions.js";
export {
	canGroupSelection,
	canUngroupSelection,
	groupSelection,
	ungroupSelection,
} from "./selection/group-actions.js";
export { PathEditOverlay } from "./selection/PathEditOverlay.js";
export {
	beginPathEdit,
	commitPathD,
	endPathEdit,
} from "./selection/path-edit-actions.js";

// ── snap ─────────────────────────────────────────────────────────────────────
export {
	getNodeWorldRect,
	getOtherNodeRects,
} from "./snap/get-node-rect.js";
export { SmartGuideOverlay } from "./snap/SmartGuideOverlay.js";
export {
	SMART_GUIDE_COLOR,
	SMART_GUIDE_DASH,
} from "./snap/smart-guide-constants.js";
export { computeSnap, DEFAULT_SNAP_THRESHOLD } from "./snap/snap-engine.js";
export type {
	SmartGuide,
	SnapAxis,
	SnapInput,
	SnapRect,
	SnapResult,
} from "./snap/snap-types.js";

// ── stage ────────────────────────────────────────────────────────────────────
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

// ── stores (factories + types) ───────────────────────────────────────────────
export type {
	AiJobEntry,
	AiJobRegistration,
	AiJobState,
	AiJobStoreApi,
} from "./stores/ai-job-store.js";
export { createAiJobStore } from "./stores/ai-job-store.js";
export type {
	CropRect,
	CropState,
	CropStoreApi,
} from "./stores/crop-store.js";
export { createCropStore } from "./stores/crop-store.js";
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
	AnyCanvasCommand,
	CommandApplyFn,
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
	PathEditState,
	PathEditStoreApi,
} from "./stores/path-edit-store.js";
export { createPathEditStore } from "./stores/path-edit-store.js";
export type {
	PenAnchor,
	PenState,
	PenStoreApi,
} from "./stores/pen-store.js";
export { createPenStore } from "./stores/pen-store.js";
export type {
	DocumentSnapshotSource,
	DocumentStores,
	ReplaceDocumentSnapshotOptions,
} from "./stores/replace-document.js";
export { replaceDocumentSnapshot } from "./stores/replace-document.js";
export type {
	SelectionState,
	SelectionStoreApi,
} from "./stores/selection-store.js";
export { createSelectionStore } from "./stores/selection-store.js";
export type {
	CreateToolStoreOptions,
	ToolState,
	ToolStoreApi,
} from "./stores/tool-store.js";
export { createToolStore, DEFAULT_TOOL } from "./stores/tool-store.js";
export type {
	CreateViewportStoreOptions,
	ViewportState,
	ViewportStoreApi,
} from "./stores/viewport-store.js";
export {
	createViewportStore,
	DEFAULT_GRID_SIZE,
} from "./stores/viewport-store.js";

// ── tools (implementations, overlays, geometry, registry) ────────────────────
export { aiBrushTool } from "./tools/ai-brush-tool.js";
export { aiImageTool } from "./tools/ai-image-tool.js";
export type {
	AiBrushSelectIntent,
	AiImageMarqueeIntent,
	AiToolIntent,
} from "./tools/ai-intent.js";
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
export { PenPreview } from "./tools/PenPreview.js";
export { PenToolOverlay } from "./tools/PenToolOverlay.js";
export {
	movePathControl,
	type ParsedPath,
	type PathControl,
	type PathControlRef,
	type PathSeg,
	type Pt,
	parsePathD,
	pathControlPoints,
	serializeParsedPath,
} from "./tools/path-edit-geometry.js";
export {
	cancelPenPath,
	commitPenPath,
	type PenCommitContext,
} from "./tools/pen-actions.js";
export { buildPathD, type PenBounds, penBounds } from "./tools/pen-geometry.js";
export { penTool } from "./tools/pen-tool.js";
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
