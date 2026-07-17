/**
 * `@anvilkit/canvas-editor` — public, host-facing API (W1).
 *
 * This root entry is the STABLE surface for integrating the canvas editor: the
 * `<CanvasStudio>` core, the `<CanvasWorkspace>` shell, the context hooks, the
 * mountable panels + inspector fields, page/export actions, and the brand kit.
 *
 * The editor's ADVANCED / EXTENSION internals (tool definitions, store
 * factories, stage primitives, snap engine, geometry helpers) are intentionally
 * NOT re-exported here — they carry no stability guarantee. Reach them via the
 * `@anvilkit/canvas-editor/internal` entry, or a specific deep subpath (e.g.
 * `@anvilkit/canvas-editor/stores/viewport-store`) when you need exactly one.
 */

// ── a11y ─────────────────────────────────────────────────────────────────────
export { ToolAnnouncer } from "./a11y/ToolAnnouncer.js";
// ── Editor action layer (§11.2 stable high-level actions) ─────────────────────
// The unified action facade behind every editor mutation. Hosts drive common
// operations (copy/cut/paste/duplicate/delete, group/ungroup, align/distribute,
// zoom, save, requestExport) through `useCanvasActions()` without coordinating
// low-level stores. Behavior — locked-node protection, batch boundaries,
// one-action/one-undo — is identical to the built-in UI.
export {
	type CanvasDistributeAxis,
	type CanvasEditorActions,
	type CanvasEditorActionsDeps,
	createCanvasEditorActions,
	useCanvasActions,
} from "./actions/editor-actions.js";
// ── Asset adapter contracts (FR-090/091) ─────────────────────────────────────
export type {
	CanvasAssetPicker,
	CanvasAssetUploader,
} from "./assets/adapter-types.js";
// ── Brand kit ────────────────────────────────────────────────────────────────
export type { BrandColor, BrandKit } from "./brand/brand-kit.js";
export {
	brandKitDefinitionToBrandKit,
	EMPTY_BRAND_KIT,
} from "./brand/brand-kit.js";
// Resolve a `BrandTokenRef` the SAME way the stage does — pass
// `(ref) => resolveBrandToken(ref, brandKit)` to core's SVG serializer's
// `resolveBrandToken` option so a host's SVG export agrees with the canvas.
export { resolveBrandToken } from "./brand/resolve-brand-token.js";
export {
	useBrandColors,
	useBrandFonts,
	useBrandKit,
	useBrandKitDefinition,
	useBrandLogos,
	useBrandRules,
	useBrandTypography,
} from "./brand/use-brand-kit.js";
export {
	CanvasErrorBoundary,
	type CanvasErrorBoundaryProps,
} from "./CanvasErrorBoundary.js";
// ── Core editor + shell ──────────────────────────────────────────────────────
export { CanvasStudio, type CanvasStudioProps } from "./CanvasStudio.js";
// ── Context + hooks ──────────────────────────────────────────────────────────
export {
	type CanvasIRGetter,
	CanvasStudioContext,
	type CanvasStudioContextValue,
	CanvasStudioStableContext,
	type CanvasStudioStableValue,
	type CanvasT,
	useCanvasStores,
	useCanvasStudio,
	useCanvasT,
} from "./context/canvas-studio-context.js";
export type {
	CanvasEditorExtension,
	CanvasKindInspector,
	CanvasKindRenderer,
} from "./extensions/editor-extension.js";
// ── Export / header ──────────────────────────────────────────────────────────
export type {
	CanvasExportActionRequest,
	CanvasExportArtifact,
	CanvasExportContext,
	CanvasExporter,
	CanvasExportFormat,
	CanvasExportPluginOptions,
	CanvasExportRequest,
	CanvasExportResult,
	CanvasExportResultArtifact,
	CanvasHeaderPlugin,
	CanvasStudioActions,
} from "./header/index.js";
export {
	CanvasExportCancelledError,
	CanvasExportEmptyError,
	createCanvasExportPlugin,
	createCanvasStudioActions,
	DEFAULT_CANVAS_EXPORTERS,
	downloadCanvasArtifact,
	ExportMenu,
	jpegExporter,
	jsonExporter,
	pdfExporter,
	pngExporter,
	sanitizeExportFilename,
	svgExporter,
	useCanvasStudioActions,
	webpExporter,
} from "./header/index.js";
// ── Pages ────────────────────────────────────────────────────────────────────
export { type ClonePageOptions, clonePage } from "./pages/clone-page.js";
export {
	PageNavigator,
	type PageNavigatorProps,
} from "./pages/PageNavigator.js";
export {
	type AddPageOptions,
	addPage,
	deletePage,
	duplicateCurrentPage,
	renamePage,
	reorderPage,
	switchToPage,
} from "./pages/page-actions.js";
export {
	SizePresetPicker,
	type SizePresetPickerProps,
} from "./pages/SizePresetPicker.js";
// ── Panels + inspector field primitives ──────────────────────────────────────
export { BrandPanel, type BrandPanelProps } from "./panels/BrandPanel.js";
export { CampaignResizePanel } from "./panels/CampaignResizePanel.js";
export type { CampaignResizeResult } from "./panels/campaign-resize-actions.js";
export { resizeActivePageToVariants } from "./panels/campaign-resize-actions.js";
export {
	ElementsPanel,
	type ElementsPanelProps,
} from "./panels/ElementsPanel.js";
export {
	ColorField,
	type ColorFieldProps,
	type CommitPatch,
	type FieldContractTarget,
	FieldRow,
	NumberField,
	type NumberFieldProps,
	Section,
	TextField,
	type TextFieldProps,
	useCommitPatch,
} from "./panels/fields.js";
export { LayerPanel, type LayerPanelProps } from "./panels/LayerPanel.js";
export {
	PropertyInspector,
	type PropertyInspectorProps,
} from "./panels/PropertyInspector.js";
export { TemplatesPanel } from "./panels/TemplatesPanel.js";
export type { TemplateActionResult } from "./panels/template-actions.js";
export {
	insertTemplateAsNewPages,
	loadTemplate,
} from "./panels/template-actions.js";
// ── Local recovery (C-10, FR-164) ────────────────────────────────────────────
export type {
	CanvasRecoveryAdapter,
	CanvasRecoverySnapshot,
} from "./persistence/recovery.js";
export { createIndexedDbRecoveryAdapter } from "./persistence/recovery.js";
// ── Persistence (B-08, FR-160..163) ─────────────────────────────────────────
export type {
	CanvasAutoSaveOptions,
	CanvasPersistenceAdapter,
	CanvasSaveInput,
	CanvasSaveResult,
} from "./persistence/types.js";
// ── Render utilities (host export bridges) ───────────────────────────────────
export type { ExportStageContentOptions } from "./render/export-stage.js";
export { exportStageContentDataURL } from "./render/export-stage.js";
export type {
	RasterizePageInput,
	RasterizePageResult,
} from "./render/rasterize-page.js";
export { rasterizePage } from "./render/rasterize-page.js";
export type {
	CanvasSaveState,
	SaveStatusState,
	SaveStatusStoreApi,
} from "./stores/save-status-store.js";
// ── Tool id (host may set `initialTool` / drive tool selection) ──────────────
export type { ToolId } from "./stores/tool-store.js";
export type { CanvasTemplateEntry } from "./templates/template-entry.js";
// ── Template provider (C-06, FR-131) ────────────────────────────────────────
export type {
	CanvasTemplateProvider,
	CanvasTemplateSearchQuery,
	CanvasTemplateSearchResult,
} from "./templates/template-provider.js";
export { createStaticTemplateProvider } from "./templates/template-provider.js";
// The stage's `CanvasTextMeasurer` — pass to core's `serializePageToSvg` (or
// `@anvilkit/plugin-export-canvas`'s `canvasToSvg`) so a rich-text export
// wraps at the same points the stage does.
export { createCanvasTextMeasurer } from "./text/canvas-text-measurer.js";
// `<CanvasWorkspace>`, the panel registry, dock config, and workspace UI hooks.
export * from "./workspace/index.js";
