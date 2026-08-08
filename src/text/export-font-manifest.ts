/**
 * Catalog → SVG `@font-face` manifest (PLAN-0035 §5 P2, `cp2-006`).
 *
 * WHAT THIS SOLVES. `canvas-core`'s SVG serializer emits `@font-face` rules
 * from a manifest the HOST supplies (`SvgSerializeOptions.fonts`,
 * `core/src/serialize/svg.ts:1497`), and only for families the document
 * actually paints — `renderFontDefs` (`:2425`) indexes the manifest by family
 * and iterates `ctx.usedFonts` (`:2428`), warning `FONT_NOT_IN_MANIFEST`
 * (`:2435`) for a painted family the manifest does not cover. A host that
 * adopts the font catalog but never builds that manifest therefore gets a
 * silently degraded export: the picker offers 37 families and every one of
 * them renders on system fallback metrics. This module builds the manifest
 * from the catalog so the host does not have to.
 *
 * CORE IS NOT MODIFIED. `cp2-001` put the catalog in the editor precisely
 * because core is font-free by charter; the mapping happens here, at export
 * time, and core keeps taking the same `SvgFontFaceDef[]` it always took.
 *
 * WHAT THE DEFAULT CATALOG DOES — STATED PLAINLY, BECAUSE IT SURPRISES.
 * `DEFAULT_FONT_CATALOG` produces **zero** `@font-face` rules, and that is the
 * correct outcome. All 37 default entries are `source: {kind: "css"}` with no
 * `files` (`cp2-002`), and a stylesheet URL is not a usable `@font-face`
 * `src` — inlining an `@import` would make the exported SVG depend on a
 * network fetch, defeating the portability the export is for. So a default
 * family is skipped here and core's existing `FONT_NOT_IN_MANIFEST` warning
 * stands. Embedded fonts require a **host or brand** catalog entry carrying
 * `source.files`; see {@link buildCatalogFontManifest}.
 */

import type {
	CanvasFontFamily,
	CanvasPage,
	SvgFontFaceDef,
	SvgResolveBrandToken,
} from "@anvilkit/canvas-core";
import { DEFAULT_RICH_TEXT_STYLE, walkPage } from "@anvilkit/canvas-core";
import type {
	CanvasFontCatalog,
	CanvasFontCatalogRecord,
	CanvasFontFile,
} from "./font-catalog.js";
import { fontFaceSrc, fontWeightCss } from "./font-catalog.js";

/** Options shared by the scan and the derived manifest. */
export interface ExportFontManifestOptions {
	/**
	 * The SAME brand-token resolver the serializer is given, so a
	 * `BrandTokenRef` font resolves to the same family name here as it will
	 * when the `<text>` element is emitted (`core/src/serialize/svg.ts:1035`).
	 * Only a `string` result is a family; a gradient is not.
	 */
	readonly resolveBrandToken?: SvgResolveBrandToken;
}

/**
 * Every font family the given page will actually paint.
 *
 * This mirrors what core accumulates into `SvgEmitContext.usedFonts`
 * (`core/src/serialize/svg.ts:461`): a `text` node's `fontFamily` (`:1035`),
 * and for `rich-text` the resolved defaults plus each span's own family
 * (`:1221`, `:1228`) — with core's early return for a paragraph-less node
 * (`:1213`) mirrored so an empty block contributes nothing.
 *
 * **Both kinds of inaccuracy are safe, by construction.** Over-collect and
 * core simply never emits the extra def, because `renderFontDefs` iterates
 * `usedFonts` and not the manifest. Under-collect and the family degrades to
 * exactly today's behaviour — a `FONT_NOT_IN_MANIFEST` warning and system
 * fallback. So this scan can never emit a rule for a family the document does
 * not paint, and can never make an export worse than it is now. That is what
 * makes a second traversal acceptable rather than a divergence risk.
 *
 * Invisible nodes are skipped because core skips them too (`skipInvisible`
 * defaults to `true`, `:472`/`:1698`). The check is per-node rather than
 * per-subtree, so children of an invisible group are still visited — the
 * harmless direction of the two.
 */
export function collectPaintedFontFamilies(
	page: CanvasPage,
	options: ExportFontManifestOptions = {},
): Set<string> {
	const families = new Set<string>();
	const add = (family: CanvasFontFamily | undefined): void => {
		if (family === undefined) return;
		if (typeof family === "string") {
			families.add(family);
			return;
		}
		const resolved = options.resolveBrandToken?.(family);
		if (typeof resolved === "string") families.add(resolved);
	};
	walkPage(page, ({ node }) => {
		if (node.visible === false) return;
		if (node.type === "text") {
			add(node.fontFamily);
			return;
		}
		if (node.type !== "rich-text" || node.paragraphs.length === 0) return;
		add(DEFAULT_RICH_TEXT_STYLE.fontFamily);
		for (const paragraph of node.paragraphs) {
			for (const span of paragraph.spans) add(span.fontFamily);
		}
	});
	return families;
}

/** A file with nothing to point at cannot become an `src`. */
function isEmbeddable(file: CanvasFontFile): boolean {
	return file.url.trim().length > 0;
}

/**
 * The one face that will represent a family in the export.
 *
 * Core emits **at most one `@font-face` per used family** — `renderFontDefs`
 * builds a `Map` keyed on `def.family`, so a second def for the same family
 * silently replaces the first (`core/src/serialize/svg.ts:2426`). Multiple
 * weights of one family therefore cannot each get a rule without a core
 * change, which `cp2-006` explicitly does not make, and `usedFonts` carries no
 * weight information to select on anyway.
 *
 * So the choice is deterministic and stated: prefer an upright face over an
 * italic one (an italic-only family still embeds, rather than nothing), then a
 * variable file — one rule whose `font-weight: <min> <max>` covers every
 * weight the document uses — then regular 400, then the first candidate.
 */
function pickRepresentativeFile(
	record: CanvasFontCatalogRecord,
): CanvasFontFile | undefined {
	const files = (record.source.files ?? []).filter(isEmbeddable);
	if (files.length === 0) return undefined;
	const upright = files.filter((file) => (file.style ?? "normal") === "normal");
	const candidates = upright.length > 0 ? upright : files;
	return (
		candidates.find((file) => typeof file.weight === "object") ??
		candidates.find((file) => file.weight === 400) ??
		candidates[0]
	);
}

/**
 * One catalog record → one `SvgFontFaceDef`, or `undefined` when the record
 * carries no embeddable file (every default-catalog entry, and any entry whose
 * only file has an empty URL).
 *
 * `family` is the caller's spelling, NOT `record.family`, and that is
 * load-bearing: core's manifest `Map` is case-SENSITIVE and is probed with
 * members of `usedFonts` (`core/src/serialize/svg.ts:2428`), while
 * {@link CanvasFontCatalog.get} is deliberately case-insensitive. A document
 * saying `"inter"` matched against a record saying `"Inter"` must emit
 * `font-family:"inter"` or core will never find the def. CSS family matching
 * is case-insensitive, so the emitted rule is correct either way.
 */
export function catalogFontFaceDef(
	record: CanvasFontCatalogRecord,
	family: string,
): SvgFontFaceDef | undefined {
	const file = pickRepresentativeFile(record);
	if (!file) return undefined;
	return {
		family,
		src: fontFaceSrc(file),
		weight: fontWeightCss(file.weight),
		style: file.style ?? "normal",
	};
}

/**
 * The manifest for a set of painted families: catalog ∩ painted, minus every
 * family with no resolvable `src`.
 *
 * Skipping (rather than emitting a rule with an empty `url("")`) is what keeps
 * `cp2-006`'s fourth acceptance criterion true, and it costs nothing in
 * diagnostics — a skipped family is a family core still sees as used and still
 * reports through `FONT_NOT_IN_MANIFEST`, the serializer's existing warning
 * mechanism. There is deliberately no second warning channel here.
 */
export function buildCatalogFontManifest(
	catalog: CanvasFontCatalog,
	families: Iterable<string>,
): SvgFontFaceDef[] {
	const defs: SvgFontFaceDef[] = [];
	const seen = new Set<string>();
	for (const family of families) {
		if (seen.has(family)) continue;
		seen.add(family);
		const record = catalog.get(family);
		if (!record) continue;
		const def = catalogFontFaceDef(record, family);
		if (def) defs.push(def);
	}
	return defs;
}

/**
 * The whole derivation in one call: scan the page, intersect with the catalog,
 * map to `SvgFontFaceDef`. Hand the result straight to
 * `serializePageToSvg(…, { fonts })`.
 */
export function deriveSvgFontManifest(
	page: CanvasPage,
	catalog: CanvasFontCatalog,
	options: ExportFontManifestOptions = {},
): SvgFontFaceDef[] {
	return buildCatalogFontManifest(
		catalog,
		collectPaintedFontFamilies(page, options),
	);
}
