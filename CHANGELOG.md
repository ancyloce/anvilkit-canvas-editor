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
