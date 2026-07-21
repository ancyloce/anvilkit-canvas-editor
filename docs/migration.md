# Migration guide — PRD 0012 behavior changes

Host-facing behavior changes from the PRD 0012 delivery (Phase 1a "editing
loop", Phase 1b "product chrome", Phase 2 "professional editing"), each with
its opt-out. One rule frames all of it: **headless `<CanvasStudio>` embeds
are unaffected by every shell change** (no keymap, no chrome, auto-confirm /
no-op feedback seams) unless a row says otherwise.

## New defaults and their opt-outs

| Change | Default | Opt-out / override |
| --- | --- | --- |
| **Workspace shortcuts** (FR-040): full core keymap — tools V/H/F/R/O/L/P/T/I, undo/redo, clipboard, group, zoom, Escape cancel stack — installs on the workspace root. Lock is **Ctrl/Cmd+Shift+L** (plain Ctrl+L is browser-reserved). | On | `shortcuts={false}`, or `shortcuts={{ extraBindings }}` (same id replaces a built-in). Reference: [shortcut-reference.md](./shortcut-reference.md). |
| **Return-to-Select after create** (FR-012): creation tools commit one element, then return to Select. | On | `continuousCreation` (both modes; footer badge in the shell). |
| **Floating tool strip** (FR-010). | On | `toolStrip={false}`. |
| **Export dialog** (FR-150..153): `createCanvasExportPlugin` opens the full dialog (format, page scope incl. selection, scale, custom size + aspect lock, quality, transparent/include background, file name, progress, PDF fidelity note). **All six formats — PNG/JPEG/WebP/SVG/PDF/JSON — are now built in** (previously SVG/PDF needed host serializer injection). | Dialog | Inject/override via `createCanvasExportPlugin({ exporters })`; legacy `ExportMenu` popover stays exported. |
| **Export entry points** (FR-031/032): node menu "Export selection" and page menu "Export page" open the export dialog preselected to the right scope. | On in shell | Absent when no export plugin is mounted (entries disable). |
| **Missing-asset placeholders** (FR-095): missing/failed `image`/`svg` assets show selectable editor placeholder chrome instead of vanishing; excluded from exports. | On | No opt-out (renderer semantics). |
| **Open as new document** (FR-132): the Templates panel offers "Open as new document" and warns before a destructive replace when the document is dirty. | "Open as new" shown only with `onCreateDocument` | Omit `onCreateDocument` → choice hidden; replace still guarded by unsaved warning. |
| **Toast + dialog hosts** (FR-170/171): destructive actions confirm via dialog; feedback lands as toasts. | On in shell | Headless keeps auto-confirm/no-op seams. |
| **Context menus** (FR-030..032): canvas/node/page right-click menus replace the browser menu; all entries route through the action layer. | On | No opt-out (shell UI). |
| **Uploads panel + drop zone** (FR-091/092). | Visible; uploads need `assetUploader` | No adapter → info toast, no mutation. |
| **Inspector completion** (FR-070..077): page properties when nothing selected, multi-select with Mixed values, appearance/stroke/radii/fit-mode sections, field contract (live preview, coalesced undo, Escape revert). | On | No opt-out (inspector semantics). |
| **Save status + auto-save** (FR-160..163). | Only with `persistenceAdapter` | Omit the adapter → no change. See [persistence.md](./persistence.md). |
| **Rulers and guides** (FR-110/111, Phase 2) | **Off** | Enable via the canvas context menu. Default-on is a host decision still open for Beta. |
| **Effects precedence** (§9.4): `effects[]` wins over legacy `shadow`; nodes upgrade per-edit (no bulk migration, no IR version bump — see `@anvilkit/canvas-core`'s decision record, `docs/architecture/shadow-effects-normalization-decision.md`, committed in that package's own repo). `effects: []` suppresses the legacy shadow. | On | Don't write `effects` and legacy `shadow` keeps rendering as before. |
| **Recovery** (FR-164) | Only with `recoveryAdapter` | Omit → no recovery dialog. |

## Built-in semantics that replaced host wiring

`ElementControls` duplicate/align/distribute/delete no longer require host
handlers (host handlers still take precedence). Multi-delete, lock-toggle,
align, distribute, duplicate, paste, tidy-up: ONE undo entry each.

## Public API additions (all additive)

- `CanvasStudioProps`: `persistenceAdapter`, `autoSave`, `onSaveStateChange`,
  `recoveryAdapter`, `assetPicker`, `assetUploader`, `templateProvider`,
  `continuousCreation`, `onError`.
- `CanvasWorkspaceProps`: `shortcuts`, `toolStrip`.
- Legacy `onPickAsset` keeps working (compat shim).

## E2E-visible changes for host suites

- Export flow: `workspace-export` opens `export-dialog`; formats
  `export-format-*`; run `export-run` (popover testids are gone).
- Inspector renders `page-properties` instead of `property-inspector-empty`
  when a page exists.
- New chrome testids: `tool-strip`, `workspace-save-status`,
  `workspace-selection-summary`, `panel-resize-handle`, `panel-overlay`.
- Destructive page actions confirm via `canvas-confirm-accept`.

## Reference-mount decision

Both production mounts (`apps/studio` canvas route, docs playground) adopt
ALL new defaults with no opt-outs — the PRD Phase 1b outcome is the default
experience.

## i18n

Editor strings ship as `canvas.*` keys with full **en/zh/ja/ko** catalogs
(four-locale parity is CI-enforced). Hosts overriding `messages` should cover
the same keys.
