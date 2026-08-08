# Typography integration guide

How font families get into a document: the built-in catalog, the
`<CanvasStudio fontCatalog>` seam that extends it, the merge rules, and what
each of those choices means at **export** time. Contract shapes are in
`src/text/font-catalog.ts`; the picker UI is `FontPickerField`.

**No font wiring is required.** A bare `<CanvasStudio initialIR={…} />` already
offers 37 open-licensed families through the font picker. Wiring `fontCatalog`
*extends* that default; it is not a precondition for the picker working.

> **The default catalog ships metadata, not font bytes.** Every default family
> is a version-pinned Google Fonts **stylesheet URL** — no bundled `woff2`. Two
> consequences follow, and both are load-bearing: the editor **needs network
> access** to render those faces, and an SVG export emits **no `@font-face`
> rule** for any of them. Read
> [Metadata-only, and what it costs](#metadata-only-and-what-it-costs) before
> shipping on the default.

## The catalog model

A catalog is a resolved set of `CanvasFontCatalogRecord`s plus a
case-insensitive `get(family)`. Each record is an authored
`CanvasFontCatalogEntry` — `family`, `category`, `weights`, optional `italic`
and `subsets`, a **required SPDX `license`**, and a `source` — stamped with the
tier (`origin`) it was created at.

```ts
import { createFontCatalog } from "@anvilkit/canvas-editor";

const catalog = createFontCatalog([
	{
		family: "Acme Grotesk",
		category: "sans",
		weights: [{ min: 100, max: 900 }],
		license: "LicenseRef-Acme-Corporate",
		source: {
			kind: "files",
			files: [
				{
					url: "https://cdn.acme.example/acme-grotesk-var.woff2",
					format: "woff2",
					weight: { min: 100, max: 900 },
				},
			],
		},
	},
]);
```

`license` is required **at the type level** — an entry without an SPDX id does
not compile. It is an open `string` rather than a closed union on purpose: the
default catalog is restricted to open licences and enforced by test, but a host
shipping a licensed corporate face must be able to record its real licence
rather than the nearest open lie. `LicenseRef-…` is the SPDX form for one.

Two source shapes, and the difference matters more than it looks:

| `source.kind` | What it is | Picker | SVG export |
| --- | --- | --- | --- |
| `"css"` | A stylesheet URL that declares the family's `@font-face` rules | Loads it, lazily | **Cannot embed** — a stylesheet URL is not a usable `@font-face` `src` |
| `"files"` | Per-face files the host serves or bundles | Loads them | Embeds one representative face |

A `"css"` source **may also carry `files`**. That is not redundancy: `css` is
what the picker loads, `files` is what the exporter embeds, and a family that
wants both needs both.

## The `fontCatalog` prop

```tsx
<CanvasStudio initialIR={ir} fontCatalog={catalog} />
```

`CanvasWorkspaceProps` extends `CanvasStudioProps`, so the same prop works on
`<CanvasWorkspace>`.

The editor resolves `mergeCatalogs(DEFAULT_FONT_CATALOG, fontCatalog)` **once**
and puts the single result on the studio context. Both consumers read that one
value:

- the **font picker** (`useCanvasFontCatalog()`), and
- the **SVG export `@font-face` manifest**, through
  `CanvasExportContext.fontCatalog`.

That is deliberate. A second merge somewhere else is how "the picker offered it
but the export ignored it" happens, so there is exactly one.

Reading it yourself, inside the editor tree:

```tsx
import { useCanvasFontCatalog } from "@anvilkit/canvas-editor";

const catalog = useCanvasFontCatalog(); // resolved; never undefined
```

## Merge semantics: brand > host > default

**Precedence is a property of the data, not of the argument order.** Every
record carries an `origin` stamped by `createFontCatalog` and preserved by
`mergeCatalogs`, so `mergeCatalogs(a, b)` and `mergeCatalogs(b, a)` agree across
tiers and differ only *within* one. This is the part a host is most likely to
get wrong by "fixing" the order at its own call site — don't; set the tier
instead:

```ts
createFontCatalog(entries);                      // origin: "host"  (the default)
createFontCatalog(entries, { origin: "brand" }); // outranks host and default
```

Three rules follow:

1. **A duplicate family resolves to the highest tier.** A host `Inter` replaces
	the default `Inter`; a brand `Inter` replaces both.
2. **Replacement is whole-entry, never field-level.** A host entry never
	inherits the default entry's `license` or `source`. A field merge would let
	an entry claim a licence nobody asserted for those bytes — a licensing bug
	wearing the costume of a convenience.
3. **`undefined` inputs are skipped**, so an optional prop needs no filtering at
	the call site.

**What this cannot do:** the prop never *removes* a default family. Override
`Inter` and you get your `Inter`, but the other 36 default families still appear
in the picker. Shipping a curated list only is not expressible through this prop
today.

## Metadata-only, and what it costs

All **37** default entries are `source: { kind: "css" }` with **no `files`**,
asserted by test. Nothing about that is accidental — bundling ~30 families as
bytes would add multiple MB to a package with a size budget, and the CSS
response's woff2 URLs are version-pinned and content-hashed
(`…/s/inter/v20/UcC73Fwr…woff2`), so hard-coding them would bake in a snapshot
that rots on the next upstream release.

Two consequences, both first-class rather than error states:

**1. Offline and air-gapped hosts render on fallback metrics.** Without network
access the stylesheet never loads, and `font-status.ts` reports the terminal
`"fallback"` state (`src/text/font-status.ts:18`) — one of five modelled
statuses, not a failure. The picker still lists every family and still renders
every option's name legibly; only the *face* is the system fallback. The same
path covers SSR and jsdom, which have no CSS Font Loading API at all.

**2. An SVG export emits no `@font-face` for a default family.** The derived
manifest is `catalog ∩ painted-families`, minus every entry with no resolvable
`src` — and a stylesheet URL is not one. Inlining an `@import` instead would
make the exported SVG depend on a network fetch, defeating the portability the
export exists for. So a default family is **skipped**, and core's existing
`FONT_NOT_IN_MANIFEST` warning stands (`core/src/serialize/svg.ts:2435`),
surfacing in the export dialog's warnings list. The document still renders — on
whatever the viewer's system resolves for that family name.

### How to supply bundled font bytes

**A family is embedded in an SVG export only if its catalog entry carries
`source.files` with a real, fetchable URL.** That is the whole rule. Serve or
bundle the faces yourself and point at them:

```ts
import { createFontCatalog, mergeCatalogs } from "@anvilkit/canvas-editor";

// Bundler-resolved URLs, or your own CDN — anything the viewer can fetch.
import interVar from "./fonts/inter-var.woff2";

const catalog = createFontCatalog([
	{
		family: "Inter", // same name as the default entry → replaces it
		category: "sans",
		weights: [{ min: 100, max: 900 }],
		italic: true,
		license: "OFL-1.1",
		upstreamUrl: "https://fonts.google.com/specimen/Inter",
		source: {
			kind: "files",
			files: [
				{ url: interVar, format: "woff2", weight: { min: 100, max: 900 } },
			],
		},
	},
]);
```

Three things worth knowing before you write that list:

- **Core emits at most one `@font-face` per used family.** Its manifest is a
	`Map` keyed on family name, so a second rule for the same family silently
	replaces the first. **Prefer a variable file** — one rule whose
	`font-weight: 100 900` covers every weight the document uses. Otherwise the
	exporter picks a single representative deterministically: upright over
	italic, then variable, then 400, then the first candidate.
- **A `data:` URL works** and is the fully self-contained option — the export
	then carries the bytes with it, at the cost of size. A same-origin HTTPS URL
	keeps the file small but makes the SVG depend on that host resolving.
- **An entry with an empty `url` is skipped**, not emitted as a broken
	`@font-face`. Skipping degrades to the documented fallback; a rule with an
	unresolvable `src` degrades to nothing at all.

Keep the `css` source alongside `files` if you also want the picker to load the
family the cheap way:

```ts
source: {
	kind: "css",
	css: "https://fonts.example/css2?family=Inter",
	files: [{ url: interVar, format: "woff2", weight: { min: 100, max: 900 } }],
}
```

### Overriding the manifest outright

A host that already builds its own `SvgFontFaceDef[]` keeps doing so and gets
byte-identical output — the explicit manifest wins over any catalog:

```ts
createCanvasExportPlugin({
	exporters: { svg: createSvgExporter({ fonts: myManifest }) },
});
```

Precedence inside the exporter is `options.fonts` → `options.fontCatalog` →
`CanvasExportContext.fontCatalog` (what `<CanvasStudio fontCatalog>` resolved).
With none of the three, the serializer is called exactly as it was before the
catalog existed.

## What the picker does with the catalog

`FontPickerField` groups the resolved catalog **Brand → Recent → Catalog**, with
a category filter built from `CANVAS_FONT_CATEGORIES`, a diacritic-folding
search, and a trailing **Custom** row so a family the catalog has never heard of
can still be named by hand.

Per-option previews render in the option's own face, but only for options the
viewport actually shows — the load is gated on `IntersectionObserver`, so
opening the picker against 37 families triggers ~8 stylesheet loads, not 37.
Where there is no observer (jsdom/SSR) it falls back to a fixed window of the
first `FONT_PREVIEW_FALLBACK_WINDOW` options. An option whose face has not
loaded shows its name in the fallback face — never blank space.

Every string in the picker resolves through a `canvas.fontPicker.*` message key
present in all four locale packs (en/zh/ja/ko), with the unavailable-face
tooltip reusing `canvas.inspector.fontMissing`.

## Brand fonts are not catalog entries

A brand kit's `fonts` are family *names* (`BrandKit.fonts`, surfaced by
`useBrandFonts()`). They carry no source and no licence, and they stay brand
tokens end to end — resolved through `resolveBrandToken` on the stage and again
at export, so a `BrandTokenRef` font is one family name in both places.

The catalog's `"brand"` tier is a different thing: a catalog that *describes*
those families with real files and a real licence, so an organisation's licensed
cut of a family replaces the default catalog's copy of it everywhere, including
at export. Build it with `createFontCatalog(entries, { origin: "brand" })` and
pass it as `fontCatalog` like any other.

## Licensing

Every default entry carries an SPDX id transcribed from that family's
`METADATA.pb` in the `google/fonts` repository — **36 × OFL-1.1**, **1 ×
Apache-2.0** (Roboto Slab) — plus an `upstreamUrl`. The allowed set for the
default catalog is `OPEN_FONT_LICENSES` (`OFL-1.1`, `Apache-2.0`, `CC0-1.0`),
enforced by test rather than by convention.

Host entries are **not** restricted to that set — see `license` above — but they
are still required to declare one, so a licensing audit is a pure read over
`catalog.entries`.

## Known limits

- **The prop extends; it cannot subtract.** No way to hide a default family.
- **One `@font-face` per family** at export (core's limit). Multiple static
	weights of one family cannot each get a rule; use a variable file.
- **`unicodeRange` is recorded but not emitted.** `CanvasFontFile.unicodeRange`
	has no `SvgFontFaceDef` counterpart, so a subsetted file embeds without its
	range. `subsets` on the entry is metadata for the picker and for audits only.
- **PDF export does not embed fonts** from the catalog — the built-in PDF path
	is raster-embed, so type is baked into pixels. See
	[export-capability-matrix.md](./export-capability-matrix.md).
