# @anvilkit/canvas-editor

<!--
RELEASE CONVENTION — settled by PLAN-0035 `cp6-005`, 2026-08-11.

This package is versioned by CHANGESETS, like every other published
`@anvilkit/*` package (`@anvilkit/core`, `@anvilkit/ui` and the plugins all
carry `changeset version` output). Every user-visible change ships a file in
the SUPERPROJECT's `.changeset/`; that file is what bumps the version and what
becomes the released entry. ADR 0008 decision 4 condition 1 mandates the same
for the Elements panel break.

The prose under `## Unreleased` is the LONG-FORM NARRATIVE for those same
changes. It is not release metadata and it is not a substitute for a changeset.
Two operational rules follow, because the two mechanisms collide if nobody
does anything:

  1. `changeset version` inserts its generated `## <version>` block
     IMMEDIATELY UNDER THE `#` TITLE — i.e. ABOVE this section. The releaser
     must then retitle `## Unreleased` to the version just cut and open a
     fresh empty `## Unreleased`, or the narrative for shipped work goes on
     claiming to be unreleased. `packages/runtime/core/CHANGELOG.md` shows
     what a skipped retitle looks like: an `## Unreleased` heading stranded
     below three released versions. The block lands above THIS COMMENT too —
     `@changesets/apply-release-plan`'s `prependFile` splices at the file's
     first newline — so move the comment back under the `#` title in the
     same pass, or the next editor never sees the rule.
  2. `.changeset/` lives in the SUPERPROJECT while this package is a
     SUBMODULE. `changeset version` therefore edits this file and
     `package.json` inside the submodule working tree, which the superproject
     records only as a gitlink — the submodule must be committed and pushed
     on its own before the superproject's release commit.
-->

## Unreleased

The PRD 0012 delivery (Phases 1a "editing loop", 1b "product chrome", 2
"professional editing"), plus the PLAN-0035 work called out by its own
sections. Behavior changes and opt-outs are catalogued in
[docs/migration.md](./docs/migration.md); this is the feature summary.

### Elements panel and the drawing tools (PLAN-0035 P3) — **breaking**

ADR 0008 decision 4 (owner sign-off 2026-08-07), landed across `cp3-003` (the
panel rebuild), `cp3-004` (insertion), `cp3-005` (recolouring) and `cp3-009`
(the tool move).

- **`<ElementsPanel>` is a content browser, not a tool picker.** It renders a
  category tab strip and a paginated grid over a `CanvasElementProvider`,
  defaulting to a built-in **425-entry** catalog — 307 icons, 53 shapes, 25
  lines, 18 frames, 22 stickers — that is fetched on the panel's first query,
  **never at editor mount** (statically importing it would add ~56 KB gzipped
  to the eager chunk, so two tests guard the dynamic edge). Every entry is
  `MIT`, carries an SPDX id and an upstream provenance URL, and is built from
  real IR geometry rather than an `svg` asset, which is what makes an inserted
  icon recolourable and exportable rather than an opaque image. Attribution
  ships in the tarball at
  [docs/element-catalog-attribution.md](./docs/element-catalog-attribution.md)
  and as the machine-readable `DEFAULT_ELEMENT_ATTRIBUTIONS`. New props:
  `elementProvider`, `onSelect`.
- **Inserting is two gestures and one implementation.** Click (or Enter/Space
  — the cells are real buttons) inserts at the **viewport centre**; dragging a
  cell onto the canvas inserts at the **drop point**, parented into the frame
  under the cursor and slotted into its Auto Layout flow when it has one. Both
  go through one function, commit exactly **one `node.create`** — a 22-part
  sticker included, so undo removes it in a single step — and select the new
  node, matching every other insertion path in the editor. The drag reuses
  `<CanvasDropZone>`'s existing handlers; no second drop surface, drop-target
  resolver or screen→page mapping was added. `onSelect` **overrides** the
  built-in insert rather than observing it (that is what an element *picker*
  needs); a host that wants both calls the newly exported
  `insertElementAtViewportCenter(ctx, entry)` itself.
- **New public exports:** `insertCanvasElement`, `insertElementAtPoint`,
  `insertElementAtViewportCenter`, `CanvasElementInsertOptions`,
  `createDefaultElementProvider`, `createStaticElementProvider`,
  `createLazyElementProvider`, and the element contract types
  (`CanvasElementEntry`, `CanvasElementProvider`, `CanvasElementCategory`,
  `CanvasElementPreview`, `CanvasElementRecolor`, `CanvasElementNode`, …).
- **Inserted elements recolour through the ordinary inspector controls** — no
  new control was built and no catalog data bakes in a colour. Each entry
  declares how it repaints (`fill` 222 · `stroke` 181 · `multi` 22 · `none` 0)
  and a catalog-wide audit fails any entry that would only half-repaint, which
  is the "reads as a bug" outcome this was written to prevent. Fills accept a
  brand token and it stays unresolved in the node, so an inserted icon is
  brand-token-aware from the first frame. The 22 multi-colour stickers keep
  their authored accents: a `group` has no fill in the IR, so the Group
  inspector section now **says so** — *"A group has no color of its own.
  Select a part to recolor it."* (one new key, all four locales) instead of
  showing `Children: 3` and nothing else.
- **The drawing tools moved to the floating tool strip, which is now their only
  surface.** All 14 built-ins (`select`, `text`, `rich-text`, `frame`, `rect`,
  `ellipse`, `polygon`, `star`, `line`, `path`, `image`, `hand`, `ai-image`,
  `ai-brush`) keep their icon, their label and their **keyboard shortcut — no
  shortcut changed**; the strip has been mounted by `<CanvasWorkspace>` all
  along (`toolStrip` defaults to `true`), so nothing was unreachable at any
  point during the move.
- **Removed: `ElementsPanelProps.tools`.** It only ever governed the deleted
  tool grid and was `@deprecated` in the previous release of this section.
  Replacement: `<CanvasWorkspace toolStrip={{ items }} />`.
- **Regression, stated deliberately (ADR 0008 decision 4, condition 2):
  extension-registered tools lose their first-class surface.** The panel used
  to render built-ins and extension tools in ONE flat grid. The strip's rail
  renders built-ins only (`descriptors.filter((d) => d.builtin)`) and pushes
  every extension tool into the **"More tools" overflow menu**. They stay fully
  reachable and keep their label, icon, shortcut hint and `disabled` probe —
  but they stop being visible at a glance, which is a real discoverability loss
  for extension authors. **Mitigation:** promote the tool into the rail with
  `<CanvasWorkspace toolStrip={{ items: ["my-tool", "select", …] }} />`; a
  promoted extension tool leaves the overflow. `toolStrip={{ renderer }}`
  replaces the strip's rendering entirely if you want your own arrangement.
- **Also lost with the grid:** the Tab Panel's search box no longer filters
  tools by localized label (it now searches the element catalog). The tool
  strip has no search; the keyboard shortcuts are the fast path.
- **Test selectors:** `elements-tool-<id>` → `tool-strip-<id>`, or
  `tool-strip-more-<id>` for a tool in the overflow. `data-active` is unchanged
  on both.

### Host selection seam — `onSelectionChange` (PLAN-0035 P5, `cp5-R03`)

- **New prop: `onSelectionChange?: (nodeId: string \| null) => void`**
  (`CanvasStudioProps`, inherited by `CanvasWorkspaceProps`; optional). It
  mirrors `onActivePageChange` exactly: it fires **once on mount** with the
  initial value and thereafter **only on change**. Redundant fires are
  suppressed structurally — the bridge subscribes to a derived `string | null`,
  not to the selection array, so calling `setSelection(["r1"])` repeatedly
  (a fresh array every time) does not re-notify.
- **A multi-selection reports `null`.** The callback names *one* node; naming
  one of N would be arbitrary, and a host acting on it could then mutate a node
  the user did not choose.
- **It costs an unwired host nothing.** The subscription lives in a leaf
  component that is mounted only when the prop is supplied, so a host that does
  not pass it renders exactly the tree it rendered before.
- **Why it exists:** it is the missing half of an AI round trip. A host can now
  know which node is selected and commit an `image.replace` against it, which
  is what closes the loop from "the panel produced a result" to "the result is
  on the canvas". Note the host obligation this exposes: an AI result names an
  asset in the *host's* registry, not in the document, so a host must commit
  the `asset.put` alongside the `image.replace` — the same atomic pair the
  drag-to-replace path has always used.

### Frame clip shapes on the canvas, and the masking UX (PLAN-0035 P4)

`@anvilkit/canvas-core` `cp4-001` added `CanvasFrameNode.shape` and the one
resolver; this is the editor half — the live stage, every raster export, and
the controls that let a user reach it. ADR 0008 decisions 1 and 2 (owner
sign-off 2026-08-07), landed across `cp4-003` and `cp4-004`.

- **A shaped, clipping frame renders as its shape everywhere the editor
  draws.** `ellipse`, `polygon`, `star` and `path` clips are traced through
  Konva's `clipFunc`; `polygon`/`star` vertices come from **the same
  `computePolygonVertices` / `computeStarVertices` core's SVG emitter calls**,
  and the two paths are pinned against each other by a geometry-level parity
  suite so they cannot drift. Because the offscreen rasterizer mounts the same
  renderer, **PNG/JPEG/WebP and PDF get shape clipping too** — PDF is
  raster-embed, so this is the only way it could.
- **Nothing is cached to achieve it.** No Konva `cache()` and no
  `destination-in` composite was introduced, so there is no offscreen canvas
  allocation on the clip path and no new drag-performance risk from it. A
  `blendMode` and a shape clip on the same frame compose: Konva pushes the clip
  first and the composite operation second.
- **A frame that resolves to a rectangle emits exactly the props it emitted
  before**, so every pre-existing document renders byte-for-byte as it did.
- **New inspector *Shape* section on a frame** — a six-option picker (None,
  Rectangle, Ellipse, Polygon, Star, Custom path) with the per-kind parameters
  (`sides`, `points`, inner-radius ratio, path data), a **Release shape**
  button, and a status line for the two cases a user would otherwise read as a
  bug: a shape sitting on an unclipped frame (inert), and geometry that could
  not be honoured (degraded to the box). Apply and release are each **one undo
  step**.
- **Two deliberate asymmetries, because the obvious symmetry breaks
  documents.** Applying a shape **turns `clip` on** — otherwise the picker
  would look broken, since a shape on an unclipped frame is inert by contract.
  Releasing a shape **does not turn `clip` back off**: a cover-filled photo is
  wider than its frame by construction, so un-clipping on release would spill
  it across the page. Applying a shape to an **empty, placeholder-less** frame
  also makes it an image well, so "shape it, then drop a photo on it" works; a
  frame that already holds children is never promoted, because that would
  change what the next drop does to its content.
- **Repositioning the photo inside a shaped well is now discoverable.**
  Double-clicking a filled, clipping image well opens the reposition editor
  (ordered ahead of isolation entry — every other container still isolates),
  and a **Reposition image** button in the inspector calls the identical path
  for anyone who does not find the gesture. Changing the shape never discards a
  deliberate reposition, and repositioning never alters the shape.
- **Fixed: the reposition overlay was mis-anchored for every nested image.** It
  read the node's parent-local transform instead of composing its ancestors, so
  the handles landed in the wrong place for *every* image inside a well — which
  is every well photo there is. It now composes the ancestor chain through the
  same helper the text and rich-text overlays use.
- **Drag-and-drop tells you what you are about to fill.** The drop zone carries
  `data-drop-target-shape` for the hovered well's resolved clip kind and shows
  a "Drop to fill shape" badge.
- **`{ kind: "path" }` data is in the frame's LOCAL units**, not page units —
  the picker seeds a fresh path from the frame's own box for that reason. A
  size-independent default would land off-box on every frame but one.
- **Public surface:** `ToolContext.cropStore` (optional) and `BeginCropContext`
  (exported from `./internal`); both additive and source-compatible. 16 new
  `canvas.inspector.frameShape*` / `canvas.inspector.repositionImage` /
  `canvas.upload.replaceTargetShape` keys in all four locales.
- **Alpha masking was not built and is not coming.** ADR 0008 decision 3
  deprecates `CanvasImageNode.maskAssetId` instead; masking lives on the frame.

### Template tags and tag faceting (PLAN-0035 P3, `cp3-006`)

- **`CanvasTemplateEntry.tags` is now optional.** It used to be required
  (inherited from `CanvasTemplateDefinition`), and the provider spread it
  unguarded — so a host catalog whose entries simply omit the key **threw**.
  This is a pure widening: every catalog that satisfied the old shape still
  satisfies this one, and an untagged catalog now lists, free-text searches,
  filters by category and size, and paginates without error.
- **New search facet: `CanvasTemplateSearchQuery.tags?: readonly string[]`** —
  **AND**-matched (an entry must carry every listed tag), case-insensitive and
  whitespace-trimmed through the new exported `normalizeTemplateTag`, and
  composable with `category`, `text`, `size` and the offset cursor.
- **The Templates panel renders tags as toggle chips**, with the active tag
  echoed in a filter row that carries its own clear button — without that row,
  a facet matching nothing would remove the only affordance to undo it along
  with the results. Untagged entries render no chip row at all. Three new
  `canvas.templates.tag*` keys in all four locales.
- Free-text search already reached tags; it now does so safely on entries that
  have none.

### Font catalog and the `fontCatalog` prop (PLAN-0035 P2)

- **A real font catalog, and a picker built over it.** Font choice used to have
  no source beyond `brandKit.fonts` — a free-text box wherever a host
  configured none. The editor now ships `DEFAULT_FONT_CATALOG`: **37
  open-licensed families** (`sans 9 · serif 7 · slab 5 · mono 6 · display 5 ·
  handwriting 5`), each with an SPDX id transcribed from `google/fonts`
  `METADATA.pb` (36 × OFL-1.1, 1 × Apache-2.0), an upstream URL, real
  weight/italic/subset metadata, and a test that fails if an entry's licence
  falls outside `OPEN_FONT_LICENSES`. The new `FontPickerField` groups a
  catalog **Brand → Recent → Catalog** with a category filter and a
  diacritic-folding search, previews each option in its own face **only when
  the option is on screen** (~8 stylesheet loads on open, not 37), and keeps a
  **Custom** row so a family the catalog has never heard of can still be typed
  by hand. 16 new `canvas.fontPicker.*` keys in all four locales.
- **New prop: `fontCatalog?: CanvasFontCatalog`** (`CanvasStudioProps`,
  inherited by `CanvasWorkspaceProps`; optional). Build one with
  `createFontCatalog(entries)` and the editor resolves
  `mergeCatalogs(DEFAULT_FONT_CATALOG, fontCatalog)` **once**, handing the same
  object to the font picker *and* to the SVG export `@font-face` manifest —
  one catalog, two consumers, so "the picker offered it but the export ignored
  it" cannot happen. Merge precedence is **brand > host > default** and rides
  on each record's `origin` (stamped by `createFontCatalog`, `"host"` by
  default; pass `{ origin: "brand" }` to outrank it), **not** on argument
  order — so no call site can get the order "wrong". A duplicate family is
  replaced whole-entry, never field-merged, so an entry never inherits another
  entry's licence. Read it inside the tree with the new
  `useCanvasFontCatalog()`.
- **⚠️ The default catalog ships metadata, not font bytes.** Every default
  entry is a version-pinned Google Fonts *stylesheet URL* with no
  `source.files`. Two consequences, both deliberate: those families **need
  network access** to render (offline/air-gapped hosts get the first-class
  `"fallback"` font status, not an error), and an **SVG export emits no
  `@font-face` rule** for any of them — a stylesheet URL is not a usable
  `@font-face` `src`, and inlining an `@import` would make the exported SVG
  depend on a network fetch. Those families are skipped and core's existing
  `FONT_NOT_IN_MANIFEST` warning stands. **To embed a family in an SVG export,
  give its catalog entry a `source.files` pointing at real font files** —
  prefer a variable file, because core emits at most one `@font-face` per
  family. Full detail:
  [docs/typography.md](./docs/typography.md#metadata-only-and-what-it-costs).
- **SVG export derives the manifest for you.** `serializePageToSvg` has always
  taken a host-built `fonts: SvgFontFaceDef[]`; the built-in exporter now
  derives it from the catalog ∩ the families the page actually paints, skipping
  any entry with no resolvable `src` rather than emitting a broken rule.
  Precedence is `createSvgExporter({ fonts })` → `createSvgExporter({
  fontCatalog })` → `CanvasExportContext.fontCatalog`; with none of the three
  the serializer call is unchanged, and a host passing its own manifest gets
  byte-identical output to before. `CanvasExportContext` gained an additive
  optional `fontCatalog` (older host exporters ignore it).
- **New public exports:** `DEFAULT_FONT_CATALOG`, `createFontCatalog`,
  `mergeCatalogs`, `CANVAS_FONT_CATEGORIES`, `resolveFontCatalog`,
  `useCanvasFontCatalog`, and the catalog types (`CanvasFontCatalog`,
  `CanvasFontCatalogEntry`, `CanvasFontCatalogRecord`, `CanvasFontCategory`,
  `CanvasFontOrigin`, `CanvasFontSource`, `CanvasFontFile`,
  `CanvasFontFileFormat`, `CanvasFontStyle`, `CanvasFontWeight`,
  `CanvasFontWeightRange`, `CreateFontCatalogOptions`).
- **Known limits, recorded not buried.** `fontCatalog` extends the default; it
  cannot *remove* a default family. Core emits one `@font-face` per family, so
  multiple static weights of one family cannot each get a rule. PDF export is
  raster-embed and never embeds catalog fonts. See
  [docs/typography.md → Known limits](./docs/typography.md#known-limits).

### Zero-config asset ingress (PLAN-0035 P1)

- **Images work with no adapter wired.** Previously a `<CanvasStudio>` mounted
  without `assetPicker` / `assetUploader` / `onPickAsset` could not get an
  image onto the canvas by any route: the Image tool was gated off and a drop
  showed *"This workspace has no upload service configured"*. The editor now
  falls back to built-in local adapters that store the original bytes as a
  `Blob` in the browser's own IndexedDB (database `anvilkit-canvas-assets`),
  reference them from `ir.assets` by `blob:` URI, and read intrinsic
  dimensions per file so inserted nodes are correctly sized. Caps are **25 MiB
  per asset** and **200 MiB total**, both reported to the user through the
  existing upload error toast (three new `canvas.upload.*` keys, all four
  locales). Where IndexedDB is unavailable — private browsing, disabled site
  storage, SSR — the store degrades to an in-memory `Map` with one console
  warning and never throws.
- **Adapters became overrides, not requirements.** Precedence is any-of, not
  per-slot: a host passing **any** of `assetPicker`, `assetUploader`, or the
  legacy `onPickAsset` keeps its own adapters and **the fallback is never
  constructed** — behaviour is identical to the previous build, asserted by a
  regression test that fails if the fallback is ever built under a host
  adapter. Wiring only `assetUploader` therefore does not hand you a fallback
  picker.
- **New prop: `disableLocalAssetFallback?: boolean`** (`CanvasStudioProps`,
  inherited by `CanvasWorkspaceProps`; optional, defaults to `false`). It is
  the third state between "host adapter" and "default fallback": with no host
  adapter and the flag set, images are genuinely unavailable and the
  pre-PLAN-0035 hard stop returns, "no upload service configured" toast
  included. Set it when browser-local storage would be the wrong promise —
  documents that must move between devices, or a policy against writing user
  content to the browser.
- **Locally-stored images survive a reload.** Object URLs die with the page, so
  on document load the editor re-mints a fresh `blob:` URL for every id the
  local store still holds and publishes it to the stage through the assets
  context. **The document is never rewritten** — the fresh URI cannot reach
  `onChange`, a save, or an export — and revocation is balanced against
  minting across mount, document swap, asset delete and unmount. An id the
  store no longer holds degrades to the existing missing-asset placeholder.
- **Export carries local bytes off the machine.** `svg` embeds them as real
  base64 through core's existing `SvgFetchAsset` seam (the `blob:` URI never
  reaches the output); `png`/`jpeg`/`webp`/`pdf`/`pdf-print` were never
  affected, since they carry pixels. `json` inlines local assets as `data:`
  URIs while their combined source size is at most the new
  `DEFAULT_JSON_INLINE_ASSET_BYTES` (10 MiB) and, above that, emits one
  `LOCAL_ASSET_NOT_PORTABLE` warning **per** image rather than a silently
  unresolvable URI — plus `LOCAL_ASSET_VOLATILE_STORE` (`level: "error"`) when
  the store had degraded to memory. New public exports: `createJsonExporter`,
  `CanvasJsonExporterOptions`, `DEFAULT_JSON_INLINE_ASSET_BYTES`; override the
  cap through the existing exporter channel,
  `createCanvasExportPlugin({ exporters: { json: createJsonExporter({ maxInlineAssetBytes }) } })`.
- **Known gaps, recorded not buried.** Page thumbnails and the offscreen
  raster/PDF export path still read the raw `ir.assets` rather than the
  rehydrated table, so after a reload each shows the missing-asset placeholder
  for an image the stage paints correctly. Both are zero-config-only and both
  need the same public-surface change to fix. See
  [docs/assets.md → Known gaps](./docs/assets.md#known-gaps).
- Full detail: [docs/assets.md](./docs/assets.md),
  [docs/adapters.md](./docs/adapters.md), and
  [docs/export-capability-matrix.md](./docs/export-capability-matrix.md).

### Motion and media are labelled contract-only (PLAN-0035 P0, `cp0-002`)

**No behaviour changed and no export output moved** — this closes an honesty
gap by disclosure, not by implementation. `@anvilkit/canvas-core`'s half of the
same change is in its own CHANGELOG (`cp0-001`).

- **A selected `video` or `audio` node now renders a `Media` inspector
  section** carrying a *"Static preview"* badge and one kind-correct sentence:
  a `video` renders **its poster still only**, on the canvas and in every
  export; an `audio` node renders **nothing anywhere** — an editor-only
  placeholder on the canvas, omitted from every export, with the layer keeping
  only the asset reference. Deliberately static: a badge and a sentence, no
  controls and no playback affordance, since anything interactive belongs to
  the deferred motion programme.
- **It also fixes a latent misclassification.** Neither kind had a branch in
  the inspector's kind dispatch, so both fell through to the *extension*
  `kindInspectors` lookup — which returns `null` for a built-in — and rendered
  no kind-specific inspector at all. The product therefore said nothing about
  any of this.
- **Four new message keys** (`canvas.inspector.media`, `.mediaStaticBadge`,
  `.mediaStaticVideo`, `.mediaStaticAudio`) in all four locale packs; no
  literal user-facing text in the component.
- **[docs/export-capability-matrix.md](./docs/export-capability-matrix.md)
  gained a motion row and a "Motion: there is no motion output format"
  section**, stating the four-way split rather than over-claiming: SVG warns
  `ANIMATION_IGNORED` per animated node **and** per page, `pdf`/`pdf-print`
  warn per page only, `png`/`jpeg`/`webp` drop motion **silently**, and `json`
  round-trips the metadata verbatim.
- **Fixed: a warning code that does not exist.** The same matrix documented
  `ASSET_UNRESOLVED` for a missing or failed `image`/`svg` asset. Nothing emits
  that code; the real one is `MISSING_ASSET`. A code a reader greps for and
  cannot find is precisely the failure this disclosure exists to prevent.

### PRD 0012 completion pass

- **Unit/DPI export-only decision formalized (FR-063, OD-1)**: Page Settings
  intentionally has no unit/DPI control — `@anvilkit/canvas-core`'s
  `docs/architecture/unit-dpi-export-only-decision.md` now records the
  rationale. `PageSettingsDialog.test.tsx` gained a regression test locking
  in the absence of a unit/DPI control. No code behavior change.
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
  metadata on `Tool`) surface in a "More tools" overflow — and, until
  `cp3-009` deleted it, in the Elements panel's tool grid too — through ONE
  effective descriptor source; `toolStrip` accepts
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
  `actions.toggleLockSelection()` (one undo entry). **Now also adds Position
  (X/Y, per-node `transform` patch, same convention as the inspector's
  `TransformSection`) and, for a single image, an Adjust popover reusing the
  inspector's `renderAdjustmentFields` verbatim** — both mixed-value aware,
  disabled for all-locked selections, and committing through the same §10
  field contract as every other toolbar control.
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
