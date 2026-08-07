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
| `svg` | SVG | Vector | Reference output. Text as `<text>`/`<tspan>` (fonts via manifest `@font-face`; measured wrapping when the host supplies a text measurer, approximate otherwise + warning). Images referenced or embedded (`images` option; embedding remote URIs needs a fetcher). Browser-local (`blob:`) assets are always embedded — see [Browser-local assets](#browser-local-assets-and-portability). |
| `png` | Konva | Raster | Lossless raster of the live-canvas rendering at export scale. |
| `jpeg` | Konva | Raster | As `png` plus JPEG quality knob; no alpha. |
| `webp` | Konva | Raster | As `png` with WebP encoding (browser-dependent encoder). |
| `pdf` | Konva | Raster-embed | One PDF page per canvas page, sized to physical points, raster drawn to fill. Text is NOT selectable; shapes are not vector (FR-151 fidelity disclosure — the export dialog states this). Missing/undecodable page rasters degrade per page with typed warnings. |
| `pdf-print` | Konva | Raster-embed | `pdf` plus the print-safety pass (`PRINT_UNSAFE` warnings: bleed/margin/DPI checks). |
| `json` | — | Lossless | Raw Canvas IR round-trip. Exact by definition, but only *portable* when every asset URI is. Browser-local assets are inlined as `data:` URIs under a cap, and warned about above it — see [Browser-local assets](#browser-local-assets-and-portability). |

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
| **Motion — `meta.animation` / `page.animation`** | ❌ never played (no timeline, preview or scrubber; nothing in the editor reads the field) | ❌ never represented. `pdf`/`pdf-print` warn `ANIMATION_IGNORED` per animated **page**; `png`/`jpeg`/`webp` drop it **silently** | ❌ never represented + `ANIMATION_IGNORED` per animated **node** and per animated **page** |
| Missing/failed `image` / `svg` asset (FR-095) | selectable placeholder chrome | never exported (renders nothing) | never exported + `MISSING_ASSET` warning |
| Browser-local (`blob:`) image asset | ✅ (bytes in this browser's store) | ✅ unaffected — the raster is pixels, not a URI | ✅ embedded as `data:` bytes; `MISSING_ASSET` if the store no longer holds them |
| Rulers/guides/margins/bleed/safe-area, isolation dimming, selection chrome | editor-only | never exported | never exported |

\* PDF inherits the raster column by construction (it embeds the Konva
raster) — including the `spread` approximation and the vector-blur gap. If a
document leans on either, export `svg` for exact output.

## Browser-local assets and portability

When no host wired an `assetPicker`/`assetUploader`/`onPickAsset`, the editor
stores uploaded images in the browser itself and references them by `blob:`
URI. **A `blob:` URI is meaningless outside the session that minted it** — not
just on another machine, but after a reload on this one. Every format therefore
has to answer the same question, and they answer it differently because they
carry different things:

| Format | What happens to a browser-local asset |
| --- | --- |
| `png` / `jpeg` / `webp` | **Nothing to do.** These carry pixels, read off the Konva stage (or the offscreen rasterizer), never a URI. Byte-identical output whether the asset is local or remote. |
| `pdf` / `pdf-print` | As above by construction — PDF embeds those rasters. |
| `svg` | **Embedded.** The exporter supplies core's existing `SvgFetchAsset` seam, backed by the browser-local store, so the `<image href>` carries real base64 bytes and the `blob:` URI never appears in the output. When the store no longer holds the bytes the image is omitted with `MISSING_ASSET` — matching the missing-asset placeholder the canvas is already showing. |
| `json` | **Inlined under a cap, warned above it.** Local assets become `data:` URIs when their combined *source* size is at most `DEFAULT_JSON_INLINE_ASSET_BYTES` (10 MiB — ~14 MB once base64 inflates it). Above the cap nothing is inlined and the artifact carries one warning **per** asset, naming it, so the user knows which image to re-add. It never emits an unresolvable URI silently. |

Configure the cap per host — the existing exporter override is the channel,
there is no second one:

```ts
createCanvasExportPlugin({
  exporters: { json: createJsonExporter({ maxInlineAssetBytes: 4 * 1024 * 1024 }) },
});
```

### Warning codes

All three ride `CanvasExportArtifact.warnings` in `@anvilkit/canvas-core`'s
`CanvasExportWarning` shape, so they surface through the export popover exactly
like every other fidelity warning.

| Code | Level | Emitted when |
| --- | --- | --- |
| `MISSING_ASSET` | `warn` | A browser-local URI whose bytes the store does not hold (SVG and JSON both). Deliberately the same code core already uses for "the bytes this document points at are not there" — the canvas is showing the missing-asset placeholder for exactly these assets. |
| `LOCAL_ASSET_NOT_PORTABLE` | `warn` | JSON only. The bytes exist but the document's local images exceed the inline cap; one warning per asset, naming it and its size, plus the total and the limit. |
| `LOCAL_ASSET_VOLATILE_STORE` | `error` | JSON only, alongside the above, when the browser could not open IndexedDB and the store degraded to memory. Stronger than "another machine cannot open this": those bytes do not survive a reload here either. Never emitted once the bytes are inlined — the artifact is then portable regardless of what the store is made of. |

**Above the cap it is all-or-nothing, deliberately.** Greedy smallest-first
packing would rescue a few more images, but it makes the outcome depend on the
sizes of *other* assets — adding one small logo could silently push a different
photo out on the next export. The answer stays one bit: this file is
self-contained, or it is not and here is every image it is missing.

The `images` option stays at its `"auto"` default; the fetcher is consulted
only for URIs that could not be *referenced* at all. Switching the exporter to
`images: "embed"` would also fetch-and-inline every remote URI — CORS-dependent
reads, a much larger file, and a warning wherever a fetch fails.

## Motion: there is no motion output format

**Every format above is a still.** `DEFAULT_CANVAS_EXPORTERS` ships PNG, JPEG,
WebP, SVG, PDF, `pdf-print` and JSON — and none of them is a motion format.
There is no GIF, APNG, MP4, WebM or Lottie exporter, and the SVG output
contains no SMIL and no CSS animation. A host may register one via
`createCanvasExportPlugin({ exporters })`, but nothing in this repository
provides one.

`CanvasAnimation` (`meta.animation` on a node, `page.animation` on a page —
the seven kinds `fade`, `slide`, `scale`, `rotate`, `pop`, `typewriter`,
`motion-path`, with `delay`/`duration`/`easing`) is therefore **metadata-only
on every path**:

| Path | What happens to animation metadata |
| --- | --- |
| Live canvas | Never played. There is no timeline, preview or scrubber, and no editor code reads the field — the stage renders the resting state. |
| `svg` | Dropped, **warned**: `ANIMATION_IGNORED` once per animated node *and* once per animated page (`canvas-core/src/serialize/svg.ts`). |
| `pdf` / `pdf-print` | Dropped, **warned**: `ANIMATION_IGNORED` once per animated page. Page-scoped by construction — PDF embeds a flat raster and cannot see nodes (`canvas-core/src/serialize/pdf.ts`). |
| `png` / `jpeg` / `webp` | Dropped **silently** — these are direct `stage.toDataURL` captures of a stage that never animated, so no warning is produced. |
| `json` | Round-trips verbatim. Losslessly persisted, still never played. |

Static output is never *divergent*: an animated node or page exports in its
normal resting state (its own `transform`/`opacity`/etc.), exactly as if the
field were absent. The warning is informational, never a second competing
appearance.

The same holds for media playback — `video` exports its `poster` still at
best (`VIDEO_UNSUPPORTED`) and `audio` exports nothing at all
(`AUDIO_UNSUPPORTED`), on every path. Full per-kind detail:
[`@anvilkit/canvas-core`'s node-kind capability matrix](../../core/README.md#built-in-node-kind-capability-matrix).

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
- Browser-local asset portability is pinned by
  `editor/src/header/__tests__/export-portability.test.ts` (SVG embeds real
  bytes, JSON inlines-or-warns) and
  `editor/src/assets/__tests__/local-asset-export.test.ts` (the scan and the
  cap), with the raster/PDF "unchanged" claim asserted as byte equality
  between a local-asset and a remote-asset document rather than assumed.
  The core-side seam is pinned by
  `canvas-core/src/serialize/__tests__/svg-local-object-uri.test.ts`,
  including the negative case: a `javascript:` URI is never offered to a
  fetcher.
