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
// ── Clipboard adapter contract (§11.1) ────────────────────────────────────────
export type { CanvasClipboardAdapter } from "./actions/clipboard-adapter.js";
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
	CanvasPickedAsset,
} from "./assets/adapter-types.js";
// ── Core editor + shell ──────────────────────────────────────────────────────
export type {
	CanvasLayoutEditorEvent,
	CanvasLayoutEventHandler,
} from "./auto-layout/events.js";
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
export {
	type CanvasAutoLayoutFlagOptions,
	CanvasStudio,
	type CanvasStudioProps,
} from "./CanvasStudio.js";
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
export { CampaignResizePanel } from "./pages/CampaignResizePanel.js";
export type { CampaignResizeResult } from "./pages/campaign-resize-actions.js";
export { resizeActivePageToVariants } from "./pages/campaign-resize-actions.js";
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
	CanvasUnloadSaveInput,
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
// ── Component Provider (plan 0021 T-018, TD 0016 §7.1) ──────────────────────
// The host-injected catalog behind the Libraries source of the Components
// panel. Same shape and same public surface as the template provider above —
// a second, differently-shaped provider contract would be a coin flip for
// every integrator.
export type {
	CanvasComponentCatalogEntry,
	CanvasComponentCompatibilityQuery,
	CanvasComponentProvider,
	CanvasComponentSearchQuery,
	CanvasComponentSearchResult,
	CanvasComponentUpdate,
	CanvasComponentVersionQuery,
	CanvasComponentVersionResult,
	CanvasProviderRequestContext,
	CanvasStaticComponentEntry,
} from "./component-libraries/component-provider.js";
export { createStaticComponentProvider } from "./component-libraries/component-provider.js";
export { collectRetainedSnapshotKeys } from "./component-libraries/retained-keys.js";
export {
	buildComplianceLookup,
	getComplianceLookup,
	type InstanceComplianceLookup,
	useInstanceCompliance,
} from "./brand-governance/use-instance-compliance.js";
export {
	type CanvasComponentUpdateInfo,
	type CanvasUpdateCheckResult,
	checkForComponentUpdates,
	collectExternalRefUsage,
} from "./component-libraries/use-update-check.js";
export {
	type ComponentChangeVerb,
	SwapComponentDialog,
	UpdateComponentDialog,
	type UpdateComponentDialogProps,
} from "./panels/library/UpdateComponentDialog.js";
export {
	VariantControls,
	type VariantControlsProps,
} from "./panels/library/VariantControls.js";
/* ── Analytics (plan 0021 T-050) ─────────────────────────────────────────── */
export {
	analyticsEventName,
	CANVAS_ANALYTICS_EVENTS,
	CANVAS_ANALYTICS_PREFIX,
	type CanvasAnalyticsEvent,
	type CanvasAnalyticsEventKey,
	type CanvasAnalyticsPayloads,
	type CanvasAnalyticsSink,
	canvasAnalyticsEvent,
	type CanvasLatencyBucket,
	emitCanvasAnalytics,
	hashIdentifier,
	latencyBucket,
} from "./component-libraries/analytics.js";
/* ── Load pipeline (plan 0021 T-045) ─────────────────────────────────────── */
export {
	type CanvasDocumentOrigin,
	type CanvasVerificationMode,
	type LoadVerificationOptions,
	type LoadVerificationResult,
	resolveVerificationMode,
	verifyDocumentSnapshots,
} from "./component-libraries/load-verification.js";
export {
	type CanvasLoadDiagnostics,
	type CanvasLoadResult,
	loadCanvasDocument,
	type LoadCanvasDocumentOptions,
	type LoadCanvasDocumentWithDiagnosticsOptions,
	loadCanvasDocumentWithDiagnostics,
	unsupportedDeclaredCapabilities,
} from "./persistence/load-pipeline.js";
/* ── Brand governance (plan 0021 M4) ─────────────────────────────────────── */
export {
	type BlockedOperationCode,
	blockedOperationCodeOf,
	blockedOperationMessage,
	isCapabilityAvailable,
	isPropertyEditable,
	policyDecisionOf,
	resolveEffectivePolicyContext,
	useEffectivePolicyContext,
} from "./brand-governance/effective-policy-context.js";
export {
	type ComplianceNavigation,
	type ComplianceNavigationTarget,
	resolveComplianceTarget,
	useComplianceNavigation,
} from "./brand-governance/use-compliance-navigation.js";
export {
	BlockedOperationDialog,
	type BlockedOperationDialogProps,
} from "./panels/governance/BlockedOperationDialog.js";
export {
	CompliancePanel,
	type CompliancePanelProps,
} from "./panels/governance/CompliancePanel.js";
export {
	ComplianceIssueRow,
	type ComplianceIssueRowProps,
	severityPresentation,
} from "./panels/governance/ComplianceIssueRow.js";
export type {
	CanvasProviderFailureStatus,
	CanvasProviderRequestStatus,
} from "./component-libraries/provider-errors.js";
export {
	type ExternalComponentFailure,
	type InsertExternalComponentResult,
	insertExternalComponent,
	recoverExternalSnapshot,
	useExternalComponent,
} from "./component-libraries/use-external-component.js";
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
