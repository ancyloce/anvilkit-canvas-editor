# @anvilkit/canvas-editor

## Unreleased

The PRD 0012 delivery (Phases 1a "editing loop", 1b "product chrome", 2
"professional editing"). Behavior changes and opt-outs are catalogued in
[docs/migration.md](./docs/migration.md); this is the feature summary.

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
