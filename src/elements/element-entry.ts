/**
 * The element catalog contract (PLAN-0035 §5 P3, `cp3-001`).
 *
 * WHAT IS BROKEN TODAY.
 *
 * The "Elements" panel is a misnomer. It maps the drawing-tool registry to
 * buttons and filters them by localized label (`panels/ElementsPanel.tsx:47-70`),
 * announcing itself as `aria-label` **"Drawing tools"** (`:91`). There is no
 * shape library, no icon set, no graphics. This module defines the contract
 * behind a real one; `cp3-009` retires the tool-filter panel (ADR 0008
 * decision 4).
 *
 * THE KEY DECISION: `build()` RETURNS A NODE, NOT AN ASSET REFERENCE.
 *
 * An inserted icon must become real editable geometry, not an opaque picture.
 * The IR makes that decision consequential rather than stylistic, in two ways
 * a type alone would not reveal:
 *
 * 1. `CanvasSvgNode` holds ONLY an `assetId` — "raw SVG markup never enters
 *    Canvas IR" (`core/src/ir/types.ts:844-857`). Serializers render it through
 *    the same `<image>` path an `image` node uses and **always** warn
 *    `SVG_INLINE_UNSUPPORTED` (`core/src/serialize/svg.ts:2321`, asserted at
 *    `core/src/serialize/__tests__/svg.test.ts:1092`). An `svg` node is
 *    therefore a bitmap wearing a vector's name: it has no `fill`, so the
 *    inspector's fill control cannot reach it and `cp3-005` would be
 *    impossible.
 * 2. Every asset-referencing kind needs a matching entry in `ir.assets`, or
 *    `validateCanvasIRInvariants` reports `dangling-asset-reference`
 *    (`core/src/ir/invariants.ts:66-102`). A node factory that cannot see the
 *    document cannot satisfy that, so an asset-referencing `build()` would be
 *    *structurally* unable to pass this task's own acceptance criterion.
 *
 * So {@link CanvasElementNode} narrows `CanvasNode` to the kinds that are both
 * self-contained (no document-level state to co-write) and paintable through
 * `CanvasFill` — which is exactly `group | frame | rect | ellipse | polygon |
 * star | line | path`. The exclusions are asserted at compile time below, so a
 * later "let's just ship them as SVG assets" cannot land quietly.
 *
 * WHAT THIS MODULE OWES ITS FOUR CONSUMERS.
 *
 * - `cp3-002` (default catalog) — an authoring shape with a required SPDX
 *   {@link CanvasElementEntry.license} and `upstreamUrl`, so the `cp6-006`
 *   licensing audit is a pure read; {@link CanvasElementEntry.keywords} so
 *   "bin"/"trash"/"delete" all find the same icon; and
 *   `checkElementEntry` (`./element-audit.js`) as the catalog-wide test it
 *   would otherwise have to invent.
 * - `cp3-003` (panel rebuild) — {@link CanvasElementPreview} as a thumbnail
 *   that costs no `build()` call and no markup injection,
 *   {@link CANVAS_ELEMENT_CATEGORIES} for the category tabs, and
 *   {@link CanvasElementEntry.defaultSize} for a grid cell's aspect ratio
 *   before anything is built.
 * - `cp3-004` (insertion) — {@link CanvasElementBuildContext} carries the drop
 *   point, the target size and an id factory, so one `build()` serves both the
 *   drag path and the click-to-viewport-centre path.
 * - `cp3-005` (recolouring) — {@link CanvasElementRecolor} makes "can this be
 *   recoloured?" a declared, audited property instead of something a user
 *   discovers by trying it.
 */

import type {
	CanvasBounds,
	CanvasFill,
	CanvasNode,
} from "@anvilkit/canvas-core";

/**
 * The five content categories the panel tabs across.
 *
 * Deliberately a CLOSED union, unlike `CanvasTemplateDefinition.category`
 * (an open `string`). A template catalog is host content whose taxonomy the
 * host owns; the element panel ships a fixed set of tabs, and an open string
 * would mean the tab strip is only knowable by scanning every entry.
 */
export type CanvasElementCategory =
	| "shape"
	| "icon"
	| "sticker"
	| "line"
	| "frame";

/**
 * Every category, in the order the panel's tabs should offer them. Exported as
 * data (not just as a type) because `cp3-002` asserts category coverage over it
 * and `cp3-003` renders a control from it — two consumers of one list, so
 * neither restates the union and drifts from it.
 */
export const CANVAS_ELEMENT_CATEGORIES = [
	"shape",
	"icon",
	"line",
	"frame",
	"sticker",
] as const satisfies readonly CanvasElementCategory[];

/**
 * The node kinds a catalog entry may build.
 *
 * See the module doc for why this is a narrowing rather than a bare
 * `CanvasNode`. In one line: these are the kinds that are self-contained (they
 * reference nothing in `ir.assets`, `ir.components` or a job queue) and whose
 * paint is reachable from `CanvasFill`. A `frame` qualifies — an empty image
 * well (`placeholder: { kind: "image" }` with no `assetId`) is what the
 * `"frame"` category is for, and it references no asset until a user fills it.
 */
export type CanvasElementNode = Extract<
	CanvasNode,
	{
		type:
			| "group"
			| "frame"
			| "rect"
			| "ellipse"
			| "polygon"
			| "star"
			| "line"
			| "path";
	}
>;

export type CanvasElementNodeKind = CanvasElementNode["type"];

/**
 * Runtime companion to {@link CanvasElementNodeKind}. `element-audit.ts` needs
 * it to walk a built subtree — a `group` may legally contain any `CanvasNode`
 * as far as core's types go, so "the whole subtree is buildable" is a fact only
 * a runtime walk can establish.
 */
export const CANVAS_ELEMENT_NODE_KINDS = [
	"group",
	"frame",
	"rect",
	"ellipse",
	"polygon",
	"star",
	"line",
	"path",
] as const satisfies readonly CanvasElementNodeKind[];

/**
 * A catalog thumbnail.
 *
 * Deliberately NOT a raw SVG markup string. `canvas-core` refuses raw SVG in
 * the IR because parsing and sanitizing it is an ingest-time host
 * responsibility (`core/src/ir/types.ts:844-851`); a panel that rendered
 * catalog markup through `dangerouslySetInnerHTML` would reintroduce exactly
 * that risk one layer up, for 300-500 third-party entries. Both variants here
 * are attribute-only, so nothing can break out of the element it is set on.
 *
 * - `"path"` — the common case for `cp3-002`'s single-path icons. `cp3-003`
 *   renders `<svg viewBox={viewBox}><path d={d} /></svg>`, which costs no
 *   `build()` call per grid cell and inherits `currentColor`, so the thumbnail
 *   tracks the panel's theme instead of being baked light or dark.
 * - `"image"` — a URL or data URI, for stickers and multi-part graphics that
 *   no single path describes.
 */
export type CanvasElementPreview =
	| {
			readonly kind: "path";
			/** SVG path data, as it would appear in a `<path d="…">`. */
			readonly d: string;
			/** Defaults to `0 0 24 24` where omitted — the icon-set convention. */
			readonly viewBox?: string;
	  }
	| {
			readonly kind: "image";
			/** URL or data URI for an `<img src>`. */
			readonly src: string;
	  };

/**
 * How an inserted entry answers the inspector's colour controls (`cp3-005`).
 *
 * Required on every entry, and audited by `checkElementEntry`, because the
 * failure this prevents is silent: an icon whose fill control moves *some* of
 * its geometry reads as a bug, not as a limitation. Declaring the answer makes
 * `cp3-003` able to say so in the UI and `cp3-005` able to test it catalog-wide.
 *
 * - `"fill"` — one fill mutation repaints the whole element.
 * - `"stroke"` — a stroke-drawn element; the stroke control repaints all of it.
 * - `"multi"` — deliberately multi-coloured. Per-part editing works by
 *   selecting the part; a single top-level fill does NOT repaint everything,
 *   and that is declared rather than discovered.
 * - `"none"` — fixed colours by design (a flag, a brand mark under a licence
 *   that forbids recolouring).
 */
export type CanvasElementRecolor = "fill" | "stroke" | "multi" | "none";

/**
 * Everything {@link CanvasElementEntry.build} may be told about the insertion
 * that is about to happen. Every field is optional and every omission has a
 * defined default, matching how `canvas-core`'s own node builders take options
 * (`core/src/ir/builders.ts:361`) — so `entry.build()` with no argument is
 * always valid and always produces something insertable.
 */
export interface CanvasElementBuildContext {
	/**
	 * Node id factory. Defaults to whatever `canvas-core`'s builders use
	 * (`crypto.randomUUID` with an RFC4122 fallback). Every node in a built
	 * subtree must get a FRESH id on every call — two insertions of the same
	 * entry that shared ids would trip `duplicate-node-id`, which silently makes
	 * every `findNode`/`parentOf` resolve to the wrong node
	 * (`core/src/ir/invariants.ts:179-182`). Audited by `checkElementEntry`.
	 */
	readonly newId?: () => string;
	/**
	 * Top-left of the element in page coordinates. Defaults to the origin.
	 *
	 * Top-left rather than centre so it maps straight onto `transform.x/y`,
	 * which is what `node.create` persists. `cp3-004`'s click-to-centre path
	 * computes `centre - defaultSize / 2` itself — it already knows the
	 * viewport, and {@link CanvasElementEntry.defaultSize} is readable without
	 * building anything.
	 */
	readonly at?: { readonly x: number; readonly y: number };
	/** Target size. Defaults to {@link CanvasElementEntry.defaultSize}. */
	readonly size?: CanvasBounds;
	/**
	 * Initial fill, for entries whose {@link CanvasElementRecolor} is `"fill"`
	 * or `"multi"`. A `BrandTokenRef` is legal here and stays unresolved in the
	 * node, exactly as a hand-drawn shape's brand-token fill does — that is what
	 * makes an inserted icon brand-token-aware from the first frame rather than
	 * only after a trip through the inspector.
	 */
	readonly fill?: CanvasFill;
	/**
	 * Initial stroke colour, for entries whose {@link CanvasElementRecolor} is
	 * `"stroke"`. A plain CSS colour string, not a `CanvasFill`: every
	 * stroke-bearing IR kind types `stroke` as `string`
	 * (`core/src/ir/types.ts:1160-1161`).
	 */
	readonly stroke?: string;
}

/**
 * One catalog entry.
 *
 * `license` is REQUIRED and is an SPDX identifier — `"MIT"`, `"Apache-2.0"`,
 * `"CC0-1.0"`, `"OFL-1.1"`, or a `LicenseRef-…` for a private licence a host
 * holds. Not narrowed to a closed union, for the same reason the font catalog
 * declined to (`text/font-catalog.ts:156-165`): `cp3-002` restricts the
 * *default* catalog to open licences and enforces that set by test, but a host
 * shipping its own artwork must be able to record its real licence rather than
 * the nearest open lie.
 */
export interface CanvasElementEntry {
	/** Stable, catalog-unique. Not a node id — `build()` mints those. */
	readonly id: string;
	/** Human-readable, already localized by whoever supplied the catalog. */
	readonly name: string;
	readonly category: CanvasElementCategory;
	/** Coarse facets the panel may show as chips. Searched. */
	readonly tags: readonly string[];
	/**
	 * Search synonyms that are NOT worth showing as chips — "bin", "trash",
	 * "delete", "remove" for one icon. Searched exactly like `tags`. Templates
	 * have no equivalent because a template's title and description already
	 * carry its vocabulary; an icon's name is one word.
	 */
	readonly keywords?: readonly string[];
	readonly preview: CanvasElementPreview;
	/**
	 * Intrinsic size, in page units. Required — it is the element analogue of
	 * a template's always-present `document.pages[0].size`, which
	 * `TemplatesPanel` relies on for both the card's aspect ratio and its size
	 * caption. `cp3-003` needs it before building anything, and `cp3-004`'s
	 * click-to-centre path needs it to place the element.
	 */
	readonly defaultSize: CanvasBounds;
	/** SPDX identifier. Required — see the interface doc. */
	readonly license: string;
	/** Provenance, for the `cp6-006` licensing audit. */
	readonly upstreamUrl?: string;
	/** Required. See {@link CanvasElementRecolor} for why. */
	readonly recolor: CanvasElementRecolor;
	/**
	 * Mint the node this entry inserts.
	 *
	 * Pure and side-effect-free apart from id generation: the same context must
	 * produce the same geometry, and a fresh id set, on every call. Returns a
	 * {@link CanvasElementNode} — always a `CanvasNode`, never an asset
	 * reference. See the module doc for why that is load-bearing.
	 */
	build(context?: CanvasElementBuildContext): CanvasElementNode;
}

// --- type-level invariants ---------------------------------------------------

type Assert<T extends true> = T;

/**
 * Compile-time assertions, erased at runtime.
 *
 * They live in this module rather than beside it in a test because this
 * package's `tsconfig.json` EXCLUDES `src/**\/__tests__/**` — a
 * `@ts-expect-error` in a test file is documentation, not enforcement, since
 * `pnpm typecheck` never reads it. Here `tsc --noEmit` is the gate: relax
 * `license` to optional, or widen `build()` to return an `svg` node, and
 * typecheck fails.
 *
 * Exported (rather than a bare unused alias) so no lint rule has to decide
 * whether an unreferenced type is dead code. It is not part of the package's
 * public API — this module is not re-exported from `src/index.ts`.
 *
 * @internal
 */
export type CanvasElementEntryInvariants = [
	// `license` is REQUIRED: an entry without an SPDX id must not compile.
	Assert<
		Omit<CanvasElementEntry, "license"> extends CanvasElementEntry
			? false
			: true
	>,
	// `recolor` is REQUIRED: `cp3-005`'s "never silently half-recolour" rule is
	// unenforceable if an entry may decline to answer.
	Assert<
		Omit<CanvasElementEntry, "recolor"> extends CanvasElementEntry
			? false
			: true
	>,
	// `defaultSize` is REQUIRED: `cp3-003`/`cp3-004` read it before building.
	Assert<
		Omit<CanvasElementEntry, "defaultSize"> extends CanvasElementEntry
			? false
			: true
	>,
	// The deliverable's literal signature: `build(): CanvasNode`. Both halves —
	// callable with no argument, and assignable to `CanvasNode`.
	Assert<CanvasElementEntry["build"] extends () => CanvasNode ? true : false>,
	// THE KEY DECISION, asserted rather than asserted-in-prose. Every kind that
	// needs document-level state a node factory cannot write is unbuildable:
	// `svg`/`image`/`video`/`audio` need `ir.assets` (dangling-asset-reference),
	// `component-instance` needs `ir.components`, `ai-placeholder` needs a live
	// job. `text`/`rich-text` need a font, which is P2's surface, not P3's.
	Assert<"svg" extends CanvasElementNodeKind ? false : true>,
	Assert<"image" extends CanvasElementNodeKind ? false : true>,
	Assert<"video" extends CanvasElementNodeKind ? false : true>,
	Assert<"audio" extends CanvasElementNodeKind ? false : true>,
	Assert<"component-instance" extends CanvasElementNodeKind ? false : true>,
	Assert<"ai-placeholder" extends CanvasElementNodeKind ? false : true>,
	Assert<"text" extends CanvasElementNodeKind ? false : true>,
	Assert<"rich-text" extends CanvasElementNodeKind ? false : true>,
	// ...and every buildable kind really is a `CanvasNode`, so the narrowing can
	// never drift into naming a kind core does not have. `satisfies` above
	// catches an EXTRA member of the runtime lists; these catch a MISSING one.
	Assert<CanvasElementNode extends CanvasNode ? true : false>,
	Assert<
		CanvasElementNodeKind extends (typeof CANVAS_ELEMENT_NODE_KINDS)[number]
			? true
			: false
	>,
	Assert<
		CanvasElementCategory extends (typeof CANVAS_ELEMENT_CATEGORIES)[number]
			? true
			: false
	>,
];
