# @anvilkit/canvas-editor

## Unreleased

The PRD 0012 delivery (Phases 1a "editing loop", 1b "product chrome", 2
"professional editing"). Behavior changes and opt-outs are catalogued in
[docs/migration.md](./docs/migration.md); this is the feature summary.

### PRD 0012 completion pass

- **Grid rendering + settings (FR-112)**: `Grid` is a real editor-only
  renderer (page-bounded lines, zoom/pan-aware, bounded line count) with a
  sub-grid, configurable grid/sub-grid colors, an explicit snap-to-grid
  setting **separate from grid visibility and snap-to-objects**, and a
  configurable snap threshold — all reachable from the canvas context menu
  and the new code-split `GridSettingsDialog`. Grid chrome never enters
  exports (named-group exclusion in `exportStageContentDataURL`) and never
  creates history entries.
- **Tool-strip extensibility (FR-010)**: extension-registered tools (now
  describable via additive `label`/`labelKey`/`icon`/`shortcut`/`disabled`
  metadata on `Tool`) surface in a "More tools" overflow and in the Elements
  panel through ONE effective descriptor source; `toolStrip` accepts
  `CanvasToolStripOptions` (`items` rail filter/reorder/promotion, `renderer`
  replacement) alongside the existing `false` opt-out.
- **Upload progress + real cancellation (FR-091/092)**: the upload context
  additively carries `signal` (AbortSignal) and `onProgress` (per-file
  fractions); the editor calls `upload()` once per file so progress and
  cancel attribute per task. Accessible determinate/indeterminate progress
  bars, per-task cancel (aborts the transport when honored; discards the
  result for legacy adapters), retry, partial-batch success insertion, and
  cleanup on document replacement and unmount. Legacy batch adapters keep
  working unchanged.
- **Drag-to-replace (FR-093)**: a single dragged file — or a completed
  upload dragged from the uploads panel — dropped on an image node or
  image-well frame replaces it through the existing `image.replace` pipeline
  (bounds/transform/crop preserved) as one atomic undo entry with its
  `asset.put`; locked/hidden nodes are never targets, multi-file drops still
  insert, and a "Drop to replace" indicator announces the active target.
- **Selection-toolbar completion (FR-180)**: the quick-props pill is
  multi-selection and mixed-value aware (selection-summary + field
  contract), adds text typography (font/size/bold/align/color) and image
  (crop/replace/fit) sections, disables for all-locked selections, and hides
  during inline text editing; `ElementControls` lock now routes through
  `actions.toggleLockSelection()` (one undo entry).
- **Unmount persistence reliability (FR-160/163)**: the cleanup's final
  `flush()` is protected from the `dispose()` issued alongside it (obsolete
  in-flight saves still abort); `beforeunload` only warns — best-effort
  unload persistence moved to the documented optional synchronous
  `CanvasPersistenceAdapter.saveOnUnload` capability; the context now
  exposes an awaitable `flush()` for host routing guards; stale save
  responses can no longer re-dirty a freshly replaced document.
- **FR-074 color entry**: the shared `ColorField` gains an explicit editable
  hex input, R/G/B channel inputs (alpha suffix preserved), and an optional
  feature-detected EyeDropper adapter with graceful fallback.
- **FR-063**: campaign-size variant creation is reachable from Page Settings
  (embedded `CampaignResizePanel`); page backgrounds of the reserved
  `gradient`/`image` kinds render the neutral fallback instead of leaking
  raw strings into Konva `fillStyle` (contract narrowed in core docs; SVG
  export keeps its typed `BACKGROUND_UNSUPPORTED` warning).
- **Tests/i18n**: §17.4 integration Flows 1 (poster), 2 (template), and 4
  (save failure) over the real history store; upload store/actions/panel,
  drop-target, grid, toolstrip, toolbar, and persistence-lifecycle suites;
  29 new `canvas.*` keys in all four locale catalogs (en/zh/ja/ko,
  parity-tested); axe coverage for the new surfaces.

### Gap-closure follow-up

- **Export completeness (FR-151/152/153, §14.5)**: all six formats
  (PNG/JPEG/WebP/SVG/PDF/JSON) are now built into `DEFAULT_CANVAS_EXPORTERS`
  — SVG via core `serializePageToSvg`, multi-page PDF via `rasterizePage` +
  core `serializeDocumentToPdf` (code-split). The export dialog gains a
  selection scope, per-page scope for whole-document formats, custom
  width/height with aspect lock, a quality slider, a transparent/include-
  background toggle, and a sanitized file-name field. File names are
  sanitized (`sanitizeExportFilename`).
- **Export entry points (FR-031/032)**: node-menu "Export selection" and
  page-menu "Export page" open the export dialog preselected via a new
  `exportRequestStore` channel.
- **Context menus (FR-030/031/032)**: added Zoom to fit / Actual size / Page
  settings (canvas), Show-Hide / Rename layer / Export selection (node), and
  Export page (page). New `toggleVisibilitySelection()` action (locked-safe,
  one undo entry).
- **Missing-asset placeholders (FR-095)**: missing/failed/loading `image` and
  `svg` assets render selectable editor placeholder chrome with an accessible
  description instead of silently disappearing; never included in exports.
- **Header page size (FR-003)**: the active page's dimensions show in the
  header, unit-aware and `Intl`-formatted.
- **Open as new document (FR-132)**: `onCreateDocument` prop + Templates-panel
  choice; destructive template replace now confirms when the document is
  dirty.
- **Locked-node enforcement (FR-024/§20.13)**: user-initiated commits now
  enforce locking at the command boundary (`createHistoryStore({
  enforceLocked: true })`); the commit pipeline no-ops on the typed
  `node-locked` rejection. Unlocking a node is always allowed. Undo/redo replay
  inverses unguarded.
- **Action layer through every surface**: the Layer panel's Delete/Backspace
  now routes through `deleteSelection()` (one undo entry, locked-safe,
  descendant-deduped) instead of a per-node commit loop. Keyboard ⌘A routes
  through the isolation-scoped, locked-safe `progressiveSelectAll` path
  (FR-190).
- **Clipboard rejection feedback (AC-002/FR-021)**: an oversized/too-many/
  too-deep/unsupported-version AnvilKit payload surfaces an error toast and
  never silently pastes stale internal content; only genuinely foreign content
  degrades to the internal store.
- **Stable action API (§11.2)**: `useCanvasActions` / `createCanvasEditorActions`
  and the asset-adapter types are now exported from the package root (stable),
  not just `/internal`. The facade gains `save()` and `requestExport(scope)`.
  `pdfExporter`/`svgExporter`/`sanitizeExportFilename` are exported too.
- **Inspector transform completeness (FR-071)**: scale field, aspect-ratio
  lock, reset rotation, flip horizontal/vertical.
- **Fill completion (FR-074)**: no-fill state, fill alpha channel, and a
  recent-colors strip.
- **Text (FR-080/FR-082/FR-083)**: empty text nodes are removed on close; the
  rich-text toolbar gains a font-family control; font-loading states are
  test-covered.
- **Rich-text vertical align (FR-081)**: `top`/`middle`/`bottom` inspector
  control; the Konva renderer offsets the block within its box height.
- **Rich-text auto-width (FR-081)**: `sizing: "auto-width"` now has a renderer
  consumer — the box is laid out unwrapped at its natural width and
  `bounds.width` is reconciled (coalesced) to the measured content width.
- **Corner-radius drag (FR-076)**: a new on-canvas handle
  (`CornerRadiusOverlay`) drags the uniform radius for a selected rect/frame
  (keyboard-accessible; clears per-corner radii; one coalesced undo entry).
- **Image alt text (§12 item 11)**: an Accessibility section in the image
  inspector edits `alt`; the accessibility scene tree announces it.

### Editing loop (Phase 1a)

- Unified `CanvasEditorActions` layer — every mutation (menus, shortcuts,
  toolbars, panels) routes through it; one undo entry per user action.
- Clipboard: copy/cut/paste/duplicate with system-clipboard adapter +
  internal fallback, cross-page paste, hostile-payload validation.
- Workspace shortcut registry (default on, `shortcuts` prop) with
  platform-aware labels; generated reference in
  [docs/shortcut-reference.md](./docs/shortcut-reference.md).
- Context menus (canvas / node / page), all action-layer-routed,
  keyboard-navigable.
- Canvas navigation: wheel pan, pinch/Ctrl+wheel zoom-at-cursor, Space hand,
  zoom-to-fit/selection/actual; 7-step Escape precedence stack.
- Layer panel: rename, multi-select, drag-and-drop reorder/reparent with
  keyboard alternative; virtualization kept ≥ 1,000 rows.
- Tool completion: return-to-Select default (`continuousCreation` opt-out).

### Product chrome (Phase 1b)

- `<CanvasWorkspace>` completion: floating tool strip (`toolStrip` prop),
  header save status/zoom/more-menu, selection toolbar + footer summary,
  responsive layout (resizable persisted panels, overlay ≤ 768px).
- Persistence: `CanvasPersistenceAdapter`, manual + debounced auto-save with
  retry/backoff and stale-response guards, dirty tracking via history
  checkpoints, `beforeunload`/`canLeave()` leave protection.
- Assets: `CanvasAssetPicker`/`CanvasAssetUploader` adapters, drag-and-drop
  upload, uploads panel (legacy `onPickAsset` still works).
- Export dialog: `svg`/`png`/`jpeg`/`webp`/`pdf`/`pdf-print`/`json`, page
  selection, scale presets, chunked progress, PDF fidelity disclosure
  ([docs/export-capability-matrix.md](./docs/export-capability-matrix.md)).
- Page settings dialog (size/orientation/background/resize modes), navigator
  DnD reorder + rename.
- Inspector completion: page properties, multi-selection with Mixed values,
  appearance/stroke/per-corner-radius/fit-mode/text sections, field-input
  contract (transient preview, coalesced commits, Escape revert).
- Toast + dialog + context-menu hosts, code-split; error-boundary recovery
  (reload, recovery-JSON export, copyable error id, `onError`).

### Professional editing (Phase 2)

- Rulers + draggable persisted guides + margin/bleed/safe-area rendering
  (default off; canvas context menu enables).
- Effects (`effects[]`: drop-shadow with spread, blur) and non-destructive
  image adjustments + filter presets, one shared resolver/color matrix with
  core so live rendering and exports agree.
- Copy/paste style, Tidy Up, layer search + cross-page find-layer,
  container isolation mode with progressive select-all.
- Template provider (`CanvasTemplateProvider`) with pagination/filters/
  recents; passive brand warnings; local recovery adapter + recover-draft
  dialog; font loading states; rich-text floating toolbar + overflow
  warnings.
- i18n: full en/zh/ja/ko catalogs (parity CI-enforced).

## 0.1.2

- Baseline: Konva stage renderer, tools, selection/transform, smart guides,
  multi-page artboards, panels, brand kit, export menu, collab prototype.
