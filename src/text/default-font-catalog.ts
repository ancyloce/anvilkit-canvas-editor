/**
 * The default font catalog (PLAN-0035 §5 P2, `cp2-002`) — 37 open-licensed
 * families authored against the `cp2-001` contract in `./font-catalog.ts`.
 *
 * WHY THIS SHIPS METADATA AND NOT BYTES.
 *
 * Thirty-odd woff2 families is several megabytes against a 400 KB gzipped
 * budget (`.size-limit.json`), so every entry is a `"css"` source pointing at
 * the family's Google Fonts CSS2 stylesheet and carries NO `files`. The
 * consequence is deliberate and belongs in the open rather than in a bug
 * report: **an offline or air-gapped host never loads these faces.** That is
 * not an error state — `font-status.ts` already models it as first-class
 * (`CanvasFontStatus = "fallback"`, `./font-status.ts:14`), reached whenever
 * the CSS Font Loading API is absent or the load never settles, and the canvas
 * renders with fallback metrics instead of crashing. A host that needs real
 * bytes offline ships its own `"files"` catalog at the `host` tier, which
 * replaces these entries whole (see `mergeCatalogs`).
 *
 * The same decision is why no entry declares `files` even though the CSS2
 * response contains real woff2 URLs: those URLs are version-pinned and
 * content-hashed (`…/s/inter/v20/UcC73Fwr…woff2`), so hard-coding them would
 * bake in a snapshot that rots on the next upstream release. `cp2-006` reads
 * `source.files ?? []`, finds nothing, and lets core's existing
 * `FONT_NOT_IN_MANIFEST` warning stand — which is the honest outcome, not a
 * silent broken `@font-face`.
 *
 * WHY EVERY ENTRY IS VERIFIABLE.
 *
 * `license`, `weights`, `italic` and `subsets` are transcribed from each
 * family's `METADATA.pb` in the `google/fonts` repository, where the top-level
 * directory IS the licence (`ofl/` → OFL-1.1, `apache/` → Apache-2.0, `ufl/` →
 * Ubuntu Font Licence, which is not in {@link OPEN_FONT_LICENSES} and is why no
 * Ubuntu-licensed family appears here). A variable family records its `wght`
 * axis as one `CanvasFontWeightRange`; a static family records its
 * discrete normal-style weights. `subsets` is that family's real subset list
 * with Google's synthetic `menu` subset removed — it promises exactly the
 * script coverage upstream ships, no more. CJK coverage is real and marked as
 * such: Noto Sans JP/SC/KR and Noto Serif JP carry `japanese`,
 * `chinese-simplified` and `korean`; Kalam carries `devanagari`.
 *
 * The `css` URL of every entry was fetched and confirmed to return
 * `@font-face` rules with woff2 sources, and every `upstreamUrl` specimen page
 * was confirmed reachable, on 2026-08-07.
 */

import {
	type CanvasFontCatalog,
	type CanvasFontCatalogEntry,
	createFontCatalog,
} from "./font-catalog.js";

/**
 * The only SPDX ids a DEFAULT-tier entry may carry.
 *
 * `cp2-001` left {@link CanvasFontCatalogEntry.license} an open `string` on
 * purpose, so a host can record a real `LicenseRef-…` for a corporate face.
 * That freedom stops at this tier: a family we ship to every consumer must be
 * one anybody may redistribute and embed in an export. Exported as data so the
 * `cp6-006` licensing audit and this module's spec share one definition of the
 * allowed set instead of restating it and drifting.
 */
export const OPEN_FONT_LICENSES = ["OFL-1.1", "Apache-2.0", "CC0-1.0"] as const;

export type OpenFontLicense = (typeof OPEN_FONT_LICENSES)[number];

/**
 * A default-tier entry: the shared authoring shape with three fields narrowed.
 *
 * `license` to the open set, and `upstreamUrl`/`subsets` from optional to
 * required — because an entry here without a provenance URL cannot be audited
 * and one without a subset list makes a coverage promise it has not recorded.
 * The narrowing is enforced by `tsc --noEmit`, which reads this file;
 * `__tests__/` is excluded from `tsconfig.json`, so the runtime assertions in
 * the spec are the second gate, not the only one.
 */
export interface DefaultFontCatalogEntry extends CanvasFontCatalogEntry {
	readonly license: OpenFontLicense;
	readonly upstreamUrl: string;
	readonly subsets: readonly string[];
}

/**
 * The families themselves, grouped by category in picker order.
 *
 * Ordering within a category is by how often a design tool's users reach for
 * the family, not alphabetical: `createFontCatalog` preserves insertion order
 * within a tier (`./font-catalog.ts` `indexRecords`), so this list is what
 * `cp2-003` renders top to bottom.
 */
export const DEFAULT_FONT_CATALOG_ENTRIES: readonly DefaultFontCatalogEntry[] =
	[
		// sans — the workhorses, plus the three Noto CJK cuts that are this catalog's
		// only real non-Latin script coverage.
		{
			family: "Inter",
			category: "sans",
			weights: [{ min: 100, max: 900 }],
			italic: true,
			subsets: [
				"cyrillic",
				"cyrillic-ext",
				"greek",
				"greek-ext",
				"latin",
				"latin-ext",
				"vietnamese",
			],
			license: "OFL-1.1",
			upstreamUrl: "https://fonts.google.com/specimen/Inter",
			source: {
				kind: "css",
				css: "https://fonts.googleapis.com/css2?family=Inter:ital,wght@0,100..900;1,100..900&display=swap",
			},
		},
		{
			family: "Roboto",
			category: "sans",
			weights: [{ min: 100, max: 900 }],
			italic: true,
			subsets: [
				"cyrillic",
				"cyrillic-ext",
				"greek",
				"greek-ext",
				"latin",
				"latin-ext",
				"math",
				"symbols",
				"vietnamese",
			],
			license: "OFL-1.1",
			upstreamUrl: "https://fonts.google.com/specimen/Roboto",
			source: {
				kind: "css",
				css: "https://fonts.googleapis.com/css2?family=Roboto:ital,wght@0,100..900;1,100..900&display=swap",
			},
		},
		{
			family: "Open Sans",
			category: "sans",
			weights: [{ min: 300, max: 800 }],
			italic: true,
			subsets: [
				"cyrillic",
				"cyrillic-ext",
				"greek",
				"greek-ext",
				"hebrew",
				"latin",
				"latin-ext",
				"math",
				"symbols",
				"vietnamese",
			],
			license: "OFL-1.1",
			upstreamUrl: "https://fonts.google.com/specimen/Open+Sans",
			source: {
				kind: "css",
				css: "https://fonts.googleapis.com/css2?family=Open+Sans:ital,wght@0,300..800;1,300..800&display=swap",
			},
		},
		{
			family: "Lato",
			category: "sans",
			weights: [100, 200, 300, 400, 500, 600, 700, 800, 900],
			italic: true,
			subsets: [
				"cyrillic",
				"cyrillic-ext",
				"greek",
				"greek-ext",
				"latin",
				"latin-ext",
				"vietnamese",
			],
			license: "OFL-1.1",
			upstreamUrl: "https://fonts.google.com/specimen/Lato",
			source: {
				kind: "css",
				css: "https://fonts.googleapis.com/css2?family=Lato:ital,wght@0,100;0,200;0,300;0,400;0,500;0,600;0,700;0,800;0,900;1,100;1,200;1,300;1,400;1,500;1,600;1,700;1,800;1,900&display=swap",
			},
		},
		{
			family: "Montserrat",
			category: "sans",
			weights: [{ min: 100, max: 900 }],
			italic: true,
			subsets: ["cyrillic", "cyrillic-ext", "latin", "latin-ext", "vietnamese"],
			license: "OFL-1.1",
			upstreamUrl: "https://fonts.google.com/specimen/Montserrat",
			source: {
				kind: "css",
				css: "https://fonts.googleapis.com/css2?family=Montserrat:ital,wght@0,100..900;1,100..900&display=swap",
			},
		},
		{
			family: "Source Sans 3",
			category: "sans",
			weights: [{ min: 200, max: 900 }],
			italic: true,
			subsets: [
				"cyrillic",
				"cyrillic-ext",
				"greek",
				"greek-ext",
				"latin",
				"latin-ext",
				"vietnamese",
			],
			license: "OFL-1.1",
			upstreamUrl: "https://fonts.google.com/specimen/Source+Sans+3",
			source: {
				kind: "css",
				css: "https://fonts.googleapis.com/css2?family=Source+Sans+3:ital,wght@0,200..900;1,200..900&display=swap",
			},
		},
		{
			family: "Noto Sans JP",
			category: "sans",
			weights: [{ min: 100, max: 900 }],
			italic: false,
			subsets: ["cyrillic", "japanese", "latin", "latin-ext", "vietnamese"],
			license: "OFL-1.1",
			upstreamUrl: "https://fonts.google.com/specimen/Noto+Sans+JP",
			source: {
				kind: "css",
				css: "https://fonts.googleapis.com/css2?family=Noto+Sans+JP:wght@100..900&display=swap",
			},
		},
		{
			family: "Noto Sans SC",
			category: "sans",
			weights: [{ min: 100, max: 900 }],
			italic: false,
			subsets: [
				"chinese-simplified",
				"cyrillic",
				"latin",
				"latin-ext",
				"vietnamese",
			],
			license: "OFL-1.1",
			upstreamUrl: "https://fonts.google.com/specimen/Noto+Sans+SC",
			source: {
				kind: "css",
				css: "https://fonts.googleapis.com/css2?family=Noto+Sans+SC:wght@100..900&display=swap",
			},
		},
		{
			family: "Noto Sans KR",
			category: "sans",
			weights: [{ min: 100, max: 900 }],
			italic: false,
			subsets: ["cyrillic", "korean", "latin", "latin-ext", "vietnamese"],
			license: "OFL-1.1",
			upstreamUrl: "https://fonts.google.com/specimen/Noto+Sans+KR",
			source: {
				kind: "css",
				css: "https://fonts.googleapis.com/css2?family=Noto+Sans+KR:wght@100..900&display=swap",
			},
		},

		// serif — text faces first, then display serifs; Noto Serif JP is the CJK cut.
		{
			family: "Lora",
			category: "serif",
			weights: [{ min: 400, max: 700 }],
			italic: true,
			subsets: [
				"cyrillic",
				"cyrillic-ext",
				"latin",
				"latin-ext",
				"math",
				"symbols",
				"vietnamese",
			],
			license: "OFL-1.1",
			upstreamUrl: "https://fonts.google.com/specimen/Lora",
			source: {
				kind: "css",
				css: "https://fonts.googleapis.com/css2?family=Lora:ital,wght@0,400..700;1,400..700&display=swap",
			},
		},
		{
			family: "Merriweather",
			category: "serif",
			weights: [{ min: 300, max: 900 }],
			italic: true,
			subsets: ["cyrillic", "cyrillic-ext", "latin", "latin-ext", "vietnamese"],
			license: "OFL-1.1",
			upstreamUrl: "https://fonts.google.com/specimen/Merriweather",
			source: {
				kind: "css",
				css: "https://fonts.googleapis.com/css2?family=Merriweather:ital,wght@0,300..900;1,300..900&display=swap",
			},
		},
		{
			family: "Playfair Display",
			category: "serif",
			weights: [{ min: 400, max: 900 }],
			italic: true,
			subsets: ["cyrillic", "latin", "latin-ext", "vietnamese"],
			license: "OFL-1.1",
			upstreamUrl: "https://fonts.google.com/specimen/Playfair+Display",
			source: {
				kind: "css",
				css: "https://fonts.googleapis.com/css2?family=Playfair+Display:ital,wght@0,400..900;1,400..900&display=swap",
			},
		},
		{
			family: "EB Garamond",
			category: "serif",
			weights: [{ min: 400, max: 800 }],
			italic: true,
			subsets: [
				"cyrillic",
				"cyrillic-ext",
				"greek",
				"greek-ext",
				"latin",
				"latin-ext",
				"vietnamese",
			],
			license: "OFL-1.1",
			upstreamUrl: "https://fonts.google.com/specimen/EB+Garamond",
			source: {
				kind: "css",
				css: "https://fonts.googleapis.com/css2?family=EB+Garamond:ital,wght@0,400..800;1,400..800&display=swap",
			},
		},
		{
			family: "Libre Baskerville",
			category: "serif",
			weights: [{ min: 400, max: 700 }],
			italic: true,
			subsets: ["latin", "latin-ext"],
			license: "OFL-1.1",
			upstreamUrl: "https://fonts.google.com/specimen/Libre+Baskerville",
			source: {
				kind: "css",
				css: "https://fonts.googleapis.com/css2?family=Libre+Baskerville:ital,wght@0,400..700;1,400..700&display=swap",
			},
		},
		{
			family: "Source Serif 4",
			category: "serif",
			weights: [{ min: 200, max: 900 }],
			italic: true,
			subsets: [
				"cyrillic",
				"cyrillic-ext",
				"greek",
				"latin",
				"latin-ext",
				"vietnamese",
			],
			license: "OFL-1.1",
			upstreamUrl: "https://fonts.google.com/specimen/Source+Serif+4",
			source: {
				kind: "css",
				css: "https://fonts.googleapis.com/css2?family=Source+Serif+4:ital,wght@0,200..900;1,200..900&display=swap",
			},
		},
		{
			family: "Noto Serif JP",
			category: "serif",
			weights: [{ min: 200, max: 900 }],
			italic: false,
			subsets: ["cyrillic", "japanese", "latin", "latin-ext", "vietnamese"],
			license: "OFL-1.1",
			upstreamUrl: "https://fonts.google.com/specimen/Noto+Serif+JP",
			source: {
				kind: "css",
				css: "https://fonts.googleapis.com/css2?family=Noto+Serif+JP:wght@200..900&display=swap",
			},
		},

		// slab — Roboto Slab is the catalog's only Apache-2.0 family (`google/fonts`
		// ships it under `apache/`, not `ofl/`).
		{
			family: "Roboto Slab",
			category: "slab",
			weights: [{ min: 100, max: 900 }],
			italic: false,
			subsets: [
				"cyrillic",
				"cyrillic-ext",
				"greek",
				"greek-ext",
				"latin",
				"latin-ext",
				"vietnamese",
			],
			license: "Apache-2.0",
			upstreamUrl: "https://fonts.google.com/specimen/Roboto+Slab",
			source: {
				kind: "css",
				css: "https://fonts.googleapis.com/css2?family=Roboto+Slab:wght@100..900&display=swap",
			},
		},
		{
			family: "Zilla Slab",
			category: "slab",
			weights: [300, 400, 500, 600, 700],
			italic: true,
			subsets: ["latin", "latin-ext"],
			license: "OFL-1.1",
			upstreamUrl: "https://fonts.google.com/specimen/Zilla+Slab",
			source: {
				kind: "css",
				css: "https://fonts.googleapis.com/css2?family=Zilla+Slab:ital,wght@0,300;0,400;0,500;0,600;0,700;1,300;1,400;1,500;1,600;1,700&display=swap",
			},
		},
		{
			family: "Bitter",
			category: "slab",
			weights: [{ min: 100, max: 900 }],
			italic: true,
			subsets: ["cyrillic", "cyrillic-ext", "latin", "latin-ext", "vietnamese"],
			license: "OFL-1.1",
			upstreamUrl: "https://fonts.google.com/specimen/Bitter",
			source: {
				kind: "css",
				css: "https://fonts.googleapis.com/css2?family=Bitter:ital,wght@0,100..900;1,100..900&display=swap",
			},
		},
		{
			family: "Arvo",
			category: "slab",
			weights: [400, 700],
			italic: true,
			subsets: ["latin"],
			license: "OFL-1.1",
			upstreamUrl: "https://fonts.google.com/specimen/Arvo",
			source: {
				kind: "css",
				css: "https://fonts.googleapis.com/css2?family=Arvo:ital,wght@0,400;0,700;1,400;1,700&display=swap",
			},
		},
		{
			family: "Josefin Slab",
			category: "slab",
			weights: [{ min: 100, max: 700 }],
			italic: true,
			subsets: ["latin"],
			license: "OFL-1.1",
			upstreamUrl: "https://fonts.google.com/specimen/Josefin+Slab",
			source: {
				kind: "css",
				css: "https://fonts.googleapis.com/css2?family=Josefin+Slab:ital,wght@0,100..700;1,100..700&display=swap",
			},
		},

		// mono — code faces; Fira Code and JetBrains Mono carry programming ligatures.
		{
			family: "JetBrains Mono",
			category: "mono",
			weights: [{ min: 100, max: 800 }],
			italic: true,
			subsets: [
				"cyrillic",
				"cyrillic-ext",
				"greek",
				"latin",
				"latin-ext",
				"vietnamese",
			],
			license: "OFL-1.1",
			upstreamUrl: "https://fonts.google.com/specimen/JetBrains+Mono",
			source: {
				kind: "css",
				css: "https://fonts.googleapis.com/css2?family=JetBrains+Mono:ital,wght@0,100..800;1,100..800&display=swap",
			},
		},
		{
			family: "Fira Code",
			category: "mono",
			weights: [{ min: 300, max: 700 }],
			italic: false,
			subsets: [
				"cyrillic",
				"cyrillic-ext",
				"greek",
				"greek-ext",
				"latin",
				"latin-ext",
				"symbols2",
			],
			license: "OFL-1.1",
			upstreamUrl: "https://fonts.google.com/specimen/Fira+Code",
			source: {
				kind: "css",
				css: "https://fonts.googleapis.com/css2?family=Fira+Code:wght@300..700&display=swap",
			},
		},
		{
			family: "IBM Plex Mono",
			category: "mono",
			weights: [100, 200, 300, 400, 500, 600, 700],
			italic: true,
			subsets: ["cyrillic", "cyrillic-ext", "latin", "latin-ext", "vietnamese"],
			license: "OFL-1.1",
			upstreamUrl: "https://fonts.google.com/specimen/IBM+Plex+Mono",
			source: {
				kind: "css",
				css: "https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:ital,wght@0,100;0,200;0,300;0,400;0,500;0,600;0,700;1,100;1,200;1,300;1,400;1,500;1,600;1,700&display=swap",
			},
		},
		{
			family: "Source Code Pro",
			category: "mono",
			weights: [{ min: 200, max: 900 }],
			italic: true,
			subsets: [
				"cyrillic",
				"cyrillic-ext",
				"greek",
				"greek-ext",
				"latin",
				"latin-ext",
				"vietnamese",
			],
			license: "OFL-1.1",
			upstreamUrl: "https://fonts.google.com/specimen/Source+Code+Pro",
			source: {
				kind: "css",
				css: "https://fonts.googleapis.com/css2?family=Source+Code+Pro:ital,wght@0,200..900;1,200..900&display=swap",
			},
		},
		{
			family: "Space Mono",
			category: "mono",
			weights: [400, 700],
			italic: true,
			subsets: ["latin", "latin-ext", "vietnamese"],
			license: "OFL-1.1",
			upstreamUrl: "https://fonts.google.com/specimen/Space+Mono",
			source: {
				kind: "css",
				css: "https://fonts.googleapis.com/css2?family=Space+Mono:ital,wght@0,400;0,700;1,400;1,700&display=swap",
			},
		},
		{
			family: "Inconsolata",
			category: "mono",
			weights: [{ min: 200, max: 900 }],
			italic: false,
			subsets: ["latin", "latin-ext", "vietnamese"],
			license: "OFL-1.1",
			upstreamUrl: "https://fonts.google.com/specimen/Inconsolata",
			source: {
				kind: "css",
				css: "https://fonts.googleapis.com/css2?family=Inconsolata:wght@200..900&display=swap",
			},
		},

		// display — headline weights only. Every one is a single static 400.
		{
			family: "Bebas Neue",
			category: "display",
			weights: [400],
			italic: false,
			subsets: ["latin", "latin-ext"],
			license: "OFL-1.1",
			upstreamUrl: "https://fonts.google.com/specimen/Bebas+Neue",
			source: {
				kind: "css",
				css: "https://fonts.googleapis.com/css2?family=Bebas+Neue:wght@400&display=swap",
			},
		},
		{
			family: "Anton",
			category: "display",
			weights: [400],
			italic: false,
			subsets: ["latin", "latin-ext", "vietnamese"],
			license: "OFL-1.1",
			upstreamUrl: "https://fonts.google.com/specimen/Anton",
			source: {
				kind: "css",
				css: "https://fonts.googleapis.com/css2?family=Anton:wght@400&display=swap",
			},
		},
		{
			family: "Abril Fatface",
			category: "display",
			weights: [400],
			italic: false,
			subsets: ["latin", "latin-ext"],
			license: "OFL-1.1",
			upstreamUrl: "https://fonts.google.com/specimen/Abril+Fatface",
			source: {
				kind: "css",
				css: "https://fonts.googleapis.com/css2?family=Abril+Fatface:wght@400&display=swap",
			},
		},
		{
			family: "Bungee",
			category: "display",
			weights: [400],
			italic: false,
			subsets: ["latin", "latin-ext", "vietnamese"],
			license: "OFL-1.1",
			upstreamUrl: "https://fonts.google.com/specimen/Bungee",
			source: {
				kind: "css",
				css: "https://fonts.googleapis.com/css2?family=Bungee:wght@400&display=swap",
			},
		},
		{
			family: "Alfa Slab One",
			category: "display",
			weights: [400],
			italic: false,
			subsets: ["latin", "latin-ext", "vietnamese"],
			license: "OFL-1.1",
			upstreamUrl: "https://fonts.google.com/specimen/Alfa+Slab+One",
			source: {
				kind: "css",
				css: "https://fonts.googleapis.com/css2?family=Alfa+Slab+One:wght@400&display=swap",
			},
		},

		// handwriting — Kalam is also the catalog's only Devanagari coverage.
		{
			family: "Caveat",
			category: "handwriting",
			weights: [{ min: 400, max: 700 }],
			italic: false,
			subsets: ["cyrillic", "cyrillic-ext", "latin", "latin-ext"],
			license: "OFL-1.1",
			upstreamUrl: "https://fonts.google.com/specimen/Caveat",
			source: {
				kind: "css",
				css: "https://fonts.googleapis.com/css2?family=Caveat:wght@400..700&display=swap",
			},
		},
		{
			family: "Dancing Script",
			category: "handwriting",
			weights: [{ min: 400, max: 700 }],
			italic: false,
			subsets: ["latin", "latin-ext", "vietnamese"],
			license: "OFL-1.1",
			upstreamUrl: "https://fonts.google.com/specimen/Dancing+Script",
			source: {
				kind: "css",
				css: "https://fonts.googleapis.com/css2?family=Dancing+Script:wght@400..700&display=swap",
			},
		},
		{
			family: "Pacifico",
			category: "handwriting",
			weights: [400],
			italic: false,
			subsets: ["cyrillic", "cyrillic-ext", "latin", "latin-ext", "vietnamese"],
			license: "OFL-1.1",
			upstreamUrl: "https://fonts.google.com/specimen/Pacifico",
			source: {
				kind: "css",
				css: "https://fonts.googleapis.com/css2?family=Pacifico:wght@400&display=swap",
			},
		},
		{
			family: "Indie Flower",
			category: "handwriting",
			weights: [400],
			italic: false,
			subsets: ["latin", "latin-ext", "vietnamese"],
			license: "OFL-1.1",
			upstreamUrl: "https://fonts.google.com/specimen/Indie+Flower",
			source: {
				kind: "css",
				css: "https://fonts.googleapis.com/css2?family=Indie+Flower:wght@400&display=swap",
			},
		},
		{
			family: "Kalam",
			category: "handwriting",
			weights: [300, 400, 700],
			italic: false,
			subsets: ["devanagari", "latin", "latin-ext"],
			license: "OFL-1.1",
			upstreamUrl: "https://fonts.google.com/specimen/Kalam",
			source: {
				kind: "css",
				css: "https://fonts.googleapis.com/css2?family=Kalam:wght@300;400;700&display=swap",
			},
		},
	];

/**
 * The default catalog, stamped `origin: "default"` — the lowest tier, so a
 * host or brand entry for the same family replaces it outright.
 *
 * Passing `origin` is required rather than decorative: `createFontCatalog`
 * defaults to `"host"`, and a default catalog stamped `host` would outrank a
 * host's own override of the same family.
 *
 * Built eagerly at module scope, and that is measured rather than assumed.
 * Today this module is not reachable from `src/index.ts`, so it adds **0 bytes**
 * to the entry chunk (114,527 B gzipped of a 409,600 budget, unchanged). Adding
 * it to the public entry — which `cp2-007` will effectively do — costs
 * **+12,931 B raw / +1,714 B gzipped**, or 0.42% of the budget, measured by
 * bundling the package with and without this subpath re-exported.
 *
 * Left eager on that number. Buying back 0.42% is not worth making every reader
 * of the catalog async, including `cp2-006`'s export path, which is synchronous.
 * If the catalog ever grows an order of magnitude, revisit the trade — the data
 * already lives in its own module behind a single import, so
 * `await import("./default-font-catalog.js")` is the whole change.
 */
export const DEFAULT_FONT_CATALOG: CanvasFontCatalog = createFontCatalog(
	DEFAULT_FONT_CATALOG_ENTRIES,
	{ origin: "default" },
);

// --- type-level invariants ---------------------------------------------------

type Assert<T extends true> = T;

/**
 * Compile-time assertions, erased at runtime. Placed here and not in the spec
 * for the reason `font-catalog.ts` records: `tsconfig.json` excludes
 * `src/**\/__tests__/**`, so only a directive in a compiled file is a gate.
 *
 * @internal
 */
export type DefaultFontCatalogInvariants = [
	// The licence narrowing survives: widening it back to `string` must fail.
	Assert<string extends DefaultFontCatalogEntry["license"] ? false : true>,
	// Provenance is required at this tier, so the `cp6-006` audit is a pure read.
	Assert<
		Omit<DefaultFontCatalogEntry, "upstreamUrl"> extends DefaultFontCatalogEntry
			? false
			: true
	>,
	// A default entry is still an ordinary catalog entry — `createFontCatalog`
	// must accept the array with no cast.
	Assert<DefaultFontCatalogEntry extends CanvasFontCatalogEntry ? true : false>,
];
