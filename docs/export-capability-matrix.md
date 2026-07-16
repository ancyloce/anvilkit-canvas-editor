# Export capability matrix

Per-format fidelity for everything the export dialog / `CanvasExportFormat`
vocabulary can produce (PRD 0012 §23; FR-150..154). The complementary
per-node-kind matrix lives in the [README](../README.md#built-in-node-kind-capability-matrix-p1-1).

## The two rendering paths

Every format renders through one of exactly two paths:

- **Konva path** — the live stage renderer (`<CanvasNodeRenderer>`), reused
  verbatim by `rasterizePage` (`stage.toDataURL`, default `pixelRatio` 2).
  Feeds `png`, `jpeg`, `webp`, **and both PDF formats** (PDF embeds these
  rasters).
- **SVG path** — `@anvilkit/canvas-core`'s `serializePageToSvg`. Feeds `svg`.

Where the paths share math they cannot drift: image adjustments compile to
one color matrix and effects resolve through one resolver, both in core,
consumed by both paths. Where Konva lacks infrastructure the live/raster side
*approximates*; the table is explicit about each case.

**All six formats are built in (FR-151 / AC-010).** `DEFAULT_CANVAS_EXPORTERS`
ships PNG, JPEG, WebP, SVG (core `serializePageToSvg`), PDF (multi-page
raster-embed via `rasterizePage` + core `serializeDocumentToPdf`), and JSON —
no host serializer injection required. Hosts may still override any format via
`createCanvasExportPlugin({ exporters })`. SVG/PDF weight is code-split behind
a dynamic `import()` so the eager editor bundle is unaffected.

**Page scope (FR-152).** The dialog exports the current page, all pages, or the
current selection (FR-031 "Export selection" synthesizes a page framed to the
selection AABB). Whole-document formats (PDF/JSON) receive a scoped IR so the
chosen scope applies uniformly; per-page formats (PNG/JPEG/WebP/SVG) emit one
file per page. Custom width/height with an aspect-ratio lock and a
transparent/include-background toggle (FR-153) drive the raster path.

## Formats

| Format | Path | Nature | Fidelity notes |
| --- | --- | --- | --- |
| `svg` | SVG | Vector | Reference output. Text as `<text>`/`<tspan>` (fonts via manifest `@font-face`; measured wrapping when the host supplies a text measurer, approximate otherwise + warning). Images referenced or embedded (`images` option; embedding remote URIs needs a fetcher). |
| `png` | Konva | Raster | Lossless raster of the live-canvas rendering at export scale. |
| `jpeg` | Konva | Raster | As `png` plus JPEG quality knob; no alpha. |
| `webp` | Konva | Raster | As `png` with WebP encoding (browser-dependent encoder). |
| `pdf` | Konva | Raster-embed | One PDF page per canvas page, sized to physical points, raster drawn to fill. Text is NOT selectable; shapes are not vector (FR-151 fidelity disclosure — the export dialog states this). Missing/undecodable page rasters degrade per page with typed warnings. |
| `pdf-print` | Konva | Raster-embed | `pdf` plus the print-safety pass (`PRINT_UNSAFE` warnings: bleed/margin/DPI checks). |
| `json` | — | Lossless | Raw Canvas IR round-trip. Exact by definition. |

## Feature fidelity across paths

| Feature | Live canvas | `png`/`jpeg`/`webp`/`pdf`* | `svg` |
| --- | --- | --- | --- |
| Solid/gradient/brand-token fills | ✅ | ✅ | ✅ (`<defs>`; unresolved tokens degrade + warning) |
| Legacy `shadow` | ✅ | ✅ | ✅ (`feDropShadow`) |
| Drop-shadow effect `spread` (C-03) | ⚠ approximated as widened blur | ⚠ same approximation | ✅ exact (`feMorphology` dilate) |
| Standalone `blur` effect on vector shapes | ❌ not rendered (needs per-shape caching) | ❌ same gap | ✅ exact (`feGaussianBlur`) |
| Image adjustments incl. blur (C-04) | ✅ (same color matrix, Konva filter) | ✅ | ✅ (`feColorMatrix`) |
| Stroke opacity/dash/cap/join, arrowheads (B-03a) | ✅ | ✅ | ✅ (SVG `<marker>` for arrowheads) |
| Per-corner radii (B-03b) | ✅ | ✅ | ✅ (path emission) |
| Image fit modes (B-02) | ✅ | ✅ | ✅ (`original`/`center` without intrinsic dims approximate as `fit` + `IMAGE_FIT_MODE_APPROXIMATED`) |
| Rich text (two-tier model) | ✅ | ✅ | ✅ one `<tspan>` per styled run; wrapping needs the host measurer |
| `svg` node kind | ⚠ rendered as `<image>` | ⚠ same | ⚠ same + `SVG_INLINE_UNSUPPORTED` (no inline vector) |
| `video` / `audio` / `ai-placeholder` | poster/placeholder chrome | poster or nothing | poster or nothing + typed warning |
| Missing/failed `image` / `svg` asset (FR-095) | selectable placeholder chrome | never exported (renders nothing) | never exported + `ASSET_UNRESOLVED` warning |
| Rulers/guides/margins/bleed/safe-area, isolation dimming, selection chrome | editor-only | never exported | never exported |

\* PDF inherits the raster column by construction (it embeds the Konva
raster) — including the `spread` approximation and the vector-blur gap. If a
document leans on either, export `svg` for exact output.

## Regression protection

- SVG output is pinned by golden snapshots
  (`canvas-core/src/serialize/__tests__/svg-golden.test.ts`), including a
  dedicated style/effects/adjustments golden, with structural
  well-formedness checks (balanced tags, no duplicate attributes).
- Path consistency is enforced by construction (one color matrix, one effect
  resolver in core) plus Konva-side unit tests for the documented
  approximations.
- Pixel-level browser screenshot comparison is a CI concern — it cannot run
  on WSL2 dev boxes (headless-Chromium readback is broken there).
