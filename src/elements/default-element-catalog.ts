import {
	filledPathEntry,
	ICON_DEFAULT_SIZE,
	strokedPathEntry,
} from "./catalog-builders.js";
import {
	BOOTSTRAP_ATTRIBUTION,
	BOOTSTRAP_ICON_ROWS,
	BOOTSTRAP_VIEWBOX,
	bootstrapUpstreamUrl,
	type CatalogAttribution,
	type CatalogIconRow,
	HEROICONS_ATTRIBUTION,
	HEROICONS_ICON_ROWS,
	HEROICONS_STROKE_WIDTH,
	HEROICONS_VIEWBOX,
	heroiconsUpstreamUrl,
} from "./catalog-icons.js";
import {
	FRAME_ENTRIES,
	LINE_ENTRIES,
	OWN_WORK_ATTRIBUTION,
	SHAPE_ENTRIES,
	STICKER_ENTRIES,
} from "./catalog-primitives.js";
import type { CanvasElementEntry } from "./element-entry.js";

/**
 * The default element catalog (PLAN-0035 §5 P3, `cp3-002`).
 *
 * THIS MODULE IS A LAZY CHUNK. IT MUST STAY ONE.
 *
 * A bare editor today offers drawing tools and nothing to insert; this is the
 * content behind `cp3-001`'s provider. It is also ~180 KB of source, which is
 * why **nothing may import it eagerly**. The one supported way in is
 * `createDefaultElementProvider()` in `default-element-provider.ts`, whose
 * `import()` of this file is the only edge that reaches it. Add a static import
 * from anywhere in `src/` and the catalog joins the eager editor bundle, which
 * `cp3-002`'s acceptance criterion forbids and `cp6-002` asserts against
 * directly rather than trusting the budget number.
 *
 * WHAT IS IN IT
 *
 * | Category | Count | Built as | `recolor` |
 * | --- | --- | --- | --- |
 * | `icon` | 307 | one `path` | 151 `fill`, 156 `stroke` |
 * | `shape` | 53 | `rect`/`ellipse`/`polygon`/`star`, or one `path` | `fill` |
 * | `line` | 25 | `line` or one stroked `path` | `stroke` |
 * | `frame` | 18 | `frame` (empty image well) | `fill` |
 * | `sticker` | 22 | `group` of primitives | `multi` |
 *
 * 425 entries. Every one is a **single node** except the stickers, which are
 * deliberately multi-coloured compositions and say so. That is what makes
 * `cp3-005`'s recolouring one fill (or one stroke) mutation for 403 of the 425,
 * and an honest `"multi"` for the other 22.
 *
 * LICENSING
 *
 * Four SPDX ids are allowed — `OFL-1.1`, `MIT`, `Apache-2.0`, `CC0-1.0` — and a
 * test asserts every entry carries one of them. In practice all 425 are `MIT`:
 * 307 from two vendored sets whose LICENSE files were read from their published
 * npm tarballs, and 118 original to this package. The notices they require are
 * discharged by {@link DEFAULT_ELEMENT_ATTRIBUTIONS} (which ships in `dist`)
 * and `docs/element-catalog-attribution.md` (which ships in the tarball).
 */

/** SPDX ids the default catalog is allowed to ship. */
export const ALLOWED_ELEMENT_LICENSES = [
	"OFL-1.1",
	"MIT",
	"Apache-2.0",
	"CC0-1.0",
] as const;

export type AllowedElementLicense = (typeof ALLOWED_ELEMENT_LICENSES)[number];

/**
 * Every licence notice the default catalog owes, upstream and own-work alike.
 *
 * ONE list rather than "the vendored ones, plus whatever is implicit about
 * ours": `cp6-006`'s audit and any in-app credits screen should not have to
 * know which entries came from where to render a complete notice.
 */
export const DEFAULT_ELEMENT_ATTRIBUTIONS: readonly CatalogAttribution[] = [
	BOOTSTRAP_ATTRIBUTION,
	HEROICONS_ATTRIBUTION,
	OWN_WORK_ATTRIBUTION,
];

function bootstrapEntry(row: CatalogIconRow): CanvasElementEntry {
	return filledPathEntry(
		{
			id: row.id,
			name: row.name,
			category: "icon",
			tags: row.tags,
			keywords: row.keywords,
			license: BOOTSTRAP_ATTRIBUTION.license,
			upstreamUrl: bootstrapUpstreamUrl(row.source),
		},
		{ d: row.d, viewBox: BOOTSTRAP_VIEWBOX },
		ICON_DEFAULT_SIZE,
	);
}

function heroiconsEntry(row: CatalogIconRow): CanvasElementEntry {
	return strokedPathEntry(
		{
			id: row.id,
			name: row.name,
			category: "icon",
			tags: row.tags,
			keywords: row.keywords,
			license: HEROICONS_ATTRIBUTION.license,
			upstreamUrl: heroiconsUpstreamUrl(row.source),
		},
		{
			d: row.d,
			viewBox: HEROICONS_VIEWBOX,
			strokeWidth: HEROICONS_STROKE_WIDTH,
		},
		ICON_DEFAULT_SIZE,
	);
}

/** The `icon` category: filled (Bootstrap) then outline (Heroicons). */
export const ICON_ENTRIES: readonly CanvasElementEntry[] = [
	...BOOTSTRAP_ICON_ROWS.map(bootstrapEntry),
	...HEROICONS_ICON_ROWS.map(heroiconsEntry),
];

/**
 * Every default entry, in the order {@link CANVAS_ELEMENT_CATEGORIES} lists the
 * panel's tabs — `shape`, `icon`, `line`, `frame`, `sticker`. The provider
 * filters by category, so this order is what an unfiltered "all" search shows,
 * and leading with shapes puts the cheapest, most-used content first.
 */
export const DEFAULT_ELEMENTS: readonly CanvasElementEntry[] = [
	...SHAPE_ENTRIES,
	...ICON_ENTRIES,
	...LINE_ENTRIES,
	...FRAME_ENTRIES,
	...STICKER_ENTRIES,
];
