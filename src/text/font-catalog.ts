/**
 * The font catalog contract (PLAN-0035 §5 P2, `cp2-001`).
 *
 * WHY THIS LIVES IN THE EDITOR AND NOT IN `canvas-core`.
 *
 * Core is renderer- and font-free by charter: it cannot measure a glyph
 * (`CanvasTextMeasurer` is injected) and it cannot load a face. Its SVG
 * serializer takes `fonts: SvgFontFaceDef[]` as an *export input the host
 * supplies* (`core/src/serialize/svg.ts:1463`), and only ever emits rules for
 * families the document actually paints (`renderFontDefs`, `:2425`). A font
 * catalog in core would invert that dependency story. So the catalog is an
 * editor concern, and `cp2-006` maps catalog → `SvgFontFaceDef` at export
 * time. The IR is untouched: `CanvasFontFamily = string | BrandTokenRef`
 * (`core/src/ir/types.ts:224`) is already open enough to name any family.
 *
 * WHAT THIS MODULE OWES ITS SIX CONSUMERS.
 *
 * - `cp2-002` (default catalog) — an authoring shape with a required SPDX
 *   `license`, plus `upstreamUrl` and `subsets` so a licensing/coverage audit
 *   is a pure read over {@link CanvasFontCatalog.entries}.
 * - `cp2-003` (picker) — `category` + {@link CANVAS_FONT_CATEGORIES} for the
 *   filter, `weights` for the weight control, and `source.kind` so an option
 *   knows how its face is loaded without a type guard of its own.
 * - `cp2-004` (field) — `get()` for "is the value the document already holds a
 *   catalog family?", answered without scanning.
 * - `cp2-005` (recents) — {@link fontFamilyKey} as the one definition of
 *   family identity, so recents and the catalog agree on what a duplicate is.
 * - `cp2-006` (export manifest) — everything an `SvgFontFaceDef` needs, in the
 *   entry, with no second lookup: see {@link CanvasFontFile} and
 *   {@link fontFaceSrc}/{@link fontWeightCss}.
 * - `cp2-007` (host prop) — {@link CanvasFontCatalog} as the prop type and
 *   {@link mergeCatalogs} as the documented merge, with precedence that is a
 *   property of the data rather than of the call site's argument order.
 */

import type { SvgFontFaceDef } from "@anvilkit/canvas-core";

/** The six families of typeface the picker groups and filters by. */
export type CanvasFontCategory =
	| "sans"
	| "serif"
	| "slab"
	| "mono"
	| "display"
	| "handwriting";

/**
 * Every category, in the order the picker's filter should offer them. Exported
 * as data (not just as a type) because `cp2-002` asserts category coverage over
 * it and `cp2-003` renders a control from it — two consumers of one list, so
 * neither has to restate the union and drift from it.
 */
export const CANVAS_FONT_CATEGORIES: readonly CanvasFontCategory[] = [
	"sans",
	"serif",
	"slab",
	"mono",
	"display",
	"handwriting",
];

/**
 * Which tier an entry came from. Precedence is **brand > host > default**.
 *
 * The tier is carried by the entry rather than implied by argument order,
 * which makes {@link mergeCatalogs} associative and impossible to call
 * "backwards": `mergeCatalogs(brand, host, defaults)` and
 * `mergeCatalogs(defaults, host, brand)` produce the same catalog.
 *
 * Note that a brand kit's own `BrandFontToken` (`{id?, name, family}`,
 * `core/src/brand/types.ts:23`) is NOT a catalog entry — it carries no source
 * and no licence, and stays a token end to end (`cp2-004`). The `"brand"` tier
 * is for a catalog that *describes* those brand families with real files and a
 * licence, so an organisation's licensed cut of a family replaces the default
 * catalog's copy of it everywhere, including at export.
 */
export type CanvasFontOrigin = "brand" | "host" | "default";

const ORIGIN_RANK: Record<CanvasFontOrigin, number> = {
	default: 0,
	host: 1,
	brand: 2,
};

/** A variable-font weight axis, as `font-weight: <min> <max>` in CSS. */
export interface CanvasFontWeightRange {
	readonly min: number;
	readonly max: number;
}

/**
 * One static weight (`400`) or a variable axis (`{min: 100, max: 900}`).
 *
 * Both, deliberately: a family advertises `weights` as a *list* whose members
 * may be either, so a static family is `[400, 700]`, a variable family is
 * `[{min: 100, max: 900}]`, and a family shipping both cuts is a list of both.
 * A single list keeps `cp2-003`'s weight control to one code path, and
 * {@link fontWeightCss} turns either shape into the string `SvgFontFaceDef.weight`
 * wants.
 */
export type CanvasFontWeight = number | CanvasFontWeightRange;

export type CanvasFontStyle = "normal" | "italic";

/** The `format(...)` hints a `@font-face` `src` may carry. */
export type CanvasFontFileFormat = "woff2" | "woff" | "truetype" | "opentype";

/**
 * One concrete face file — exactly the four things an `@font-face` rule needs,
 * so `cp2-006` can build an `SvgFontFaceDef` from a catalog entry alone.
 *
 * `unicodeRange` is recorded for completeness (subsetted Google-style files
 * carry one) but has no `SvgFontFaceDef` counterpart; core's `fontFaceRule`
 * emits `font-family`, `src`, `font-weight` and `font-style` only.
 */
export interface CanvasFontFile {
	/** Absolute or app-relative URL of the font file. */
	readonly url: string;
	/** Omitted means "emit no `format(...)` hint" — never guessed from the URL. */
	readonly format?: CanvasFontFileFormat;
	readonly weight: CanvasFontWeight;
	/** Defaults to `"normal"` where omitted. */
	readonly style?: CanvasFontStyle;
	/** CSS `unicode-range` for a subsetted file, e.g. `"U+0000-00FF"`. */
	readonly unicodeRange?: string;
}

/**
 * How a family is obtained, as a discriminated union so a consumer narrows on
 * `source.kind` without writing a type guard.
 *
 * - `"css"` — a stylesheet that declares the family's `@font-face` rules. This
 *   is the default catalog's shape (`cp2-002` ships metadata, not bytes).
 * - `"files"` — per-face files the host serves or bundles itself.
 *
 * A `"css"` source MAY also declare `files`. That is not redundancy: a
 * stylesheet URL is not a usable `@font-face` `src`, so export would otherwise
 * be impossible for exactly the entries the default catalog is made of.
 * `files` is what `cp2-006` reads; `css` is what the picker loads. Both
 * variants expose `files`, so `source.files ?? []` reads it with no narrowing
 * at all — narrowing is for the *loading* decision, which genuinely differs.
 */
export type CanvasFontSource =
	| {
			readonly kind: "css";
			/** Stylesheet URL declaring the family's `@font-face` rules. */
			readonly css: string;
			/** Per-face files for export; absent means this family cannot be embedded. */
			readonly files?: readonly CanvasFontFile[];
	  }
	| {
			readonly kind: "files";
			readonly files: readonly CanvasFontFile[];
	  };

/**
 * A family as its author writes it.
 *
 * `license` is REQUIRED and is an SPDX identifier — `"OFL-1.1"`,
 * `"Apache-2.0"`, `"CC0-1.0"`, or a `LicenseRef-…` for a private/commercial
 * licence a host holds. It is deliberately not narrowed to a closed union: the
 * *default* catalog is restricted to open licences and `cp2-002` enforces that
 * set by test, but a host shipping a licensed corporate face must be able to
 * record its real licence rather than the nearest open lie.
 */
export interface CanvasFontCatalogEntry {
	readonly family: string;
	readonly category: CanvasFontCategory;
	/** What the picker may offer. See {@link CanvasFontWeight}. */
	readonly weights: readonly CanvasFontWeight[];
	/** Whether the family ships an italic cut. Absent means unknown/none. */
	readonly italic?: boolean;
	readonly source: CanvasFontSource;
	/** Script coverage, e.g. `["latin", "latin-ext", "japanese"]`. */
	readonly subsets?: readonly string[];
	/** SPDX identifier. Required — see the interface doc. */
	readonly license: string;
	/** Where the family came from, for the `cp6-006` licensing audit. */
	readonly upstreamUrl?: string;
}

/**
 * An entry as a catalog stores it: the authoring shape plus the tier it was
 * created at. Stamped by {@link createFontCatalog} so authors never repeat it
 * per entry, and preserved by {@link mergeCatalogs} so merging a merged
 * catalog still resolves each family at its true precedence.
 */
export interface CanvasFontCatalogRecord extends CanvasFontCatalogEntry {
	readonly origin: CanvasFontOrigin;
}

/**
 * A resolved catalog: entries ordered by descending precedence, plus a
 * case-insensitive family lookup so `cp2-004`/`cp2-006` never scan.
 */
export interface CanvasFontCatalog {
	readonly entries: readonly CanvasFontCatalogRecord[];
	/** Case-insensitive; see {@link fontFamilyKey}. */
	get(family: string): CanvasFontCatalogRecord | undefined;
}

export interface CreateFontCatalogOptions {
	/**
	 * Defaults to `"host"` — the tier of the only caller outside this package
	 * (`CanvasStudioProps.fontCatalog`, `cp2-007`). The in-repo callers that
	 * need another tier (`cp2-002`'s default catalog, a brand adapter) pass it
	 * explicitly and are covered by their own tests, so the forgetful case is
	 * the one that still lands where its caller meant.
	 */
	readonly origin?: CanvasFontOrigin;
}

/**
 * The one definition of family identity in the catalog.
 *
 * Case-insensitive and trimmed, matching how `canvas-core` already compares a
 * font family against a brand token (`caseInsensitiveEquals`,
 * `core/src/brand/apply.ts:53`) — a document that says `"inter"` and a catalog
 * that says `"Inter"` are the same family, and CSS agrees.
 */
export function fontFamilyKey(family: string): string {
	return family.trim().toLowerCase();
}

/** `400` → `"400"`; `{min: 100, max: 900}` → `"100 900"` (both valid CSS). */
export function fontWeightCss(weight: CanvasFontWeight): string {
	return typeof weight === "number"
		? String(weight)
		: `${weight.min} ${weight.max}`;
}

/**
 * A face file as a CSS `src` value: `url("…") format("…")`.
 *
 * Quotes and backslashes in the URL are CSS-escaped so the value cannot break
 * out of the quoted `url()` token. Core sanitizes further on the way out
 * (`escapeCssUrl` strips `<>{};` and newlines, `core/src/serialize/svg.ts:180`),
 * so this is defence in depth, not the only guard.
 */
export function fontFaceSrc(file: CanvasFontFile): string {
	const url = file.url.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
	return file.format
		? `url("${url}") format("${file.format}")`
		: `url("${url}")`;
}

/**
 * Index records by family, keeping the highest-precedence one.
 *
 * **Whole-entry replacement, never a field-level merge.** A brand entry that
 * inherited a default entry's `license` (or its `source`, or its `subsets`)
 * would be a licensing and provenance bug wearing the costume of a
 * convenience: the resulting entry would claim a licence nobody asserted for
 * those bytes. So the winner replaces the loser outright, and an entry is only
 * ever as complete as its own author made it.
 *
 * Among entries of EQUAL precedence the last one wins (object-spread
 * intuition), while the family keeps the position of its first occurrence
 * (`Map.set` on an existing key does not reorder). Both are deterministic.
 */
function indexRecords(
	records: readonly CanvasFontCatalogRecord[],
): Map<string, CanvasFontCatalogRecord> {
	const byFamily = new Map<string, CanvasFontCatalogRecord>();
	for (const record of records) {
		const key = fontFamilyKey(record.family);
		const current = byFamily.get(key);
		if (!current || ORIGIN_RANK[record.origin] >= ORIGIN_RANK[current.origin]) {
			byFamily.set(key, record);
		}
	}
	return byFamily;
}

function catalogFrom(
	records: readonly CanvasFontCatalogRecord[],
): CanvasFontCatalog {
	const byFamily = indexRecords(records);
	// Stable sort (spec-guaranteed since ES2019): tiers land brand → host →
	// default, and within a tier the index's insertion order is preserved, so
	// `entries[0]` onwards is the order the picker should pin.
	const entries = [...byFamily.values()].sort(
		(a, b) => ORIGIN_RANK[b.origin] - ORIGIN_RANK[a.origin],
	);
	return {
		entries,
		get: (family) => byFamily.get(fontFamilyKey(family)),
	};
}

/**
 * Build a catalog from authored entries, stamping every one with `origin`.
 *
 * Duplicate families within a single call resolve to the last of them — see
 * {@link indexRecords} for why that is a replacement and not a merge.
 */
export function createFontCatalog(
	entries: readonly CanvasFontCatalogEntry[],
	options: CreateFontCatalogOptions = {},
): CanvasFontCatalog {
	const origin = options.origin ?? "host";
	return catalogFrom(entries.map((entry) => ({ ...entry, origin })));
}

/**
 * Merge catalogs with precedence **brand > host > default**.
 *
 * Argument order is irrelevant across tiers and only breaks ties within one,
 * because precedence rides on each record's `origin` (see
 * {@link CanvasFontOrigin}). `undefined` inputs are skipped so the common call
 * — `mergeCatalogs(DEFAULT_FONT_CATALOG, props.fontCatalog)` with an optional
 * prop — needs no filtering at the call site.
 */
export function mergeCatalogs(
	...catalogs: readonly (CanvasFontCatalog | undefined)[]
): CanvasFontCatalog {
	return catalogFrom(
		catalogs.flatMap((catalog) => (catalog ? [...catalog.entries] : [])),
	);
}

// --- type-level invariants ---------------------------------------------------

type Assert<T extends true> = T;

/**
 * Compile-time assertions, erased at runtime.
 *
 * They live in this module rather than in the spec beside it because this
 * package's `tsconfig.json` EXCLUDES `src/**\/__tests__/**` — a
 * `@ts-expect-error` in a test file is documentation, not enforcement, since
 * `pnpm typecheck` never reads it. Here, `tsc --noEmit` is the gate: relax
 * `license` to optional, or `files` on a `"files"` source, and typecheck fails.
 *
 * Exported (rather than a bare unused alias) so no lint rule has to decide
 * whether an unreferenced type is dead code. It is not part of the package's
 * public API — this module is not re-exported from `src/index.ts`.
 *
 * @internal
 */
export type CanvasFontCatalogInvariants = [
	// `license` is REQUIRED: an entry without an SPDX id must not compile.
	Assert<
		Omit<CanvasFontCatalogEntry, "license"> extends CanvasFontCatalogEntry
			? false
			: true
	>,
	// A `"files"` source must actually carry files.
	Assert<
		Omit<
			Extract<CanvasFontSource, { kind: "files" }>,
			"files"
		> extends CanvasFontSource
			? false
			: true
	>,
	// Every stored record knows its tier, so precedence survives re-merging.
	Assert<
		Omit<CanvasFontCatalogRecord, "origin"> extends CanvasFontCatalogRecord
			? false
			: true
	>,
	// `cp2-006` can build an `SvgFontFaceDef` from a catalog record and one of
	// its `source.files` entries alone — no second lookup, no other input. This
	// is the acceptance criterion, asserted rather than asserted-in-prose:
	// `family` comes from the record (see the note below), `src` from
	// `fontFaceSrc`, `weight` from `fontWeightCss`, `style` from the file.
	Assert<
		{
			family: CanvasFontCatalogRecord["family"];
			src: ReturnType<typeof fontFaceSrc>;
			weight: ReturnType<typeof fontWeightCss>;
			style: NonNullable<CanvasFontFile["style"]>;
		} extends SvgFontFaceDef
			? true
			: false
	>,
];

/**
 * MAPPING NOTE FOR `cp2-006`, recorded here because it is a property of core's
 * emitter that the mapping must respect and nothing else states it:
 *
 * 1. `SvgFontFaceDef.family` must be the family string **as the document
 *    spells it**, not `record.family`. `renderFontDefs` indexes the manifest
 *    with a case-SENSITIVE `Map` keyed on `def.family` and looks up members of
 *    `ctx.usedFonts` (`core/src/serialize/svg.ts:2426-2429`), so a document
 *    saying `"inter"` matched against a record saying `"Inter"` — which
 *    {@link CanvasFontCatalog.get} deliberately does — must still emit
 *    `family: "inter"`. CSS family matching is case-insensitive, so the rule
 *    is correct either way; core's lookup is not.
 * 2. Core emits **at most one `@font-face` per used family** (same `Map`: a
 *    second def for a family silently replaces the first). Multiple weights of
 *    one family therefore cannot each get a rule without a core change, which
 *    `cp2-006` explicitly does not make. Prefer a variable file (one rule,
 *    `font-weight: "100 900"` via {@link fontWeightCss}) and otherwise pick a
 *    single representative face — `usedFonts` carries no weight information
 *    (`:1035`), so there is nothing finer to select on.
 */
