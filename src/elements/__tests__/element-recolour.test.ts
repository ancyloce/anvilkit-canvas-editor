import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import {
	type BrandTokenRef,
	type CanvasFill,
	type CanvasNode,
	createCanvasIR,
	createGroup,
	createPage,
	serializePageToSvg,
	walkPage,
} from "@anvilkit/canvas-core";
import { describe, expect, it } from "vitest";
import type { BrandKit } from "../../brand/brand-kit.js";
import { resolveBrandToken } from "../../brand/resolve-brand-token.js";
import { DEFAULT_ELEMENTS } from "../default-element-catalog.js";
import { checkElementEntry } from "../element-audit.js";
import type { CanvasElementEntry } from "../element-entry.js";

/**
 * `cp3-005` — the catalog-wide recolour contract.
 *
 * "An icon you cannot recolour is a sticker." `cp3-001` made that a structural
 * property rather than a hope: `CanvasElementNode` excludes `svg` and `image`
 * precisely because `CanvasSvgNode` holds only an `assetId` and has no `fill`
 * field at all, so an svg-backed icon could never answer the inspector. Every
 * one of the 425 default entries is therefore a real `path`/`group`/primitive
 * with inline geometry, and the question this file answers is the one that
 * remains: does a fill (or stroke) mutation actually reach that geometry, for
 * EVERY entry, and does every entry that cannot be repainted by a single
 * control say so?
 *
 * `checkElementEntry` (`cp3-001`, `elements/element-audit.ts`) already probes
 * each entry and reports `recolor-mismatch`, and
 * `__tests__/default-element-catalog.test.ts` already runs it over the whole
 * catalog. This file extends that pattern rather than forking it: it calls
 * `checkElementEntry` for the audit itself and adds the three things the audit
 * deliberately leaves open, because they are `cp3-005`'s deliverables and not
 * `cp3-001`'s:
 *
 * 1. **Nothing is baked in.** The audit accepts a `"fill"` entry that repaints
 *    every fill site; it does not assert that a `"fill"` entry has NO stroke
 *    sites (or vice versa). An entry that answered the fill control but also
 *    carried an authored stroke would be half-recolourable in the UI while
 *    passing the audit.
 * 2. **`"multi"` is honest, and structurally safe.** The audit accepts `"multi"`
 *    when fill OR stroke reaches at least one node. That is the loose half of
 *    the contract. The strict half is that a `"multi"` entry's ROOT must be a
 *    node kind the IR gives no paint field to — so there is no single control
 *    that COULD half-recolour it.
 * 3. **The whole export path carries the new colour**, via a golden.
 */

/**
 * Probe colours no catalog entry contains by coincidence. Same values and same
 * reasoning as `element-audit.ts:70-71`: a literal, so "did it arrive?" is an
 * equality check on the built node, not an identity check on a reference the
 * entry might have passed through without using.
 */
const FILL_PROBE = "#f0e1d2";
const STROKE_PROBE = "#d2e1f0";

/**
 * Where paint lands, per node kind. Mirrors `element-audit.ts:73-101` — kept
 * local rather than exported from the audit because `cp3-005` is fenced out of
 * `element-audit.ts`, and duplicated deliberately in the ONE place a divergence
 * would be caught: `inspector-recolour` (`panels/__tests__`) pins these same
 * two kind sets against what the real inspector renders, so an accessor that
 * drifted from the product would redden there.
 */
function fillOf(node: CanvasNode): CanvasFill | undefined {
	switch (node.type) {
		case "rect":
		case "ellipse":
		case "polygon":
		case "star":
		case "path":
			return node.fill;
		case "frame":
			return node.background;
		default:
			return undefined;
	}
}

function strokeOf(node: CanvasNode): string | undefined {
	switch (node.type) {
		case "rect":
		case "ellipse":
		case "polygon":
		case "star":
		case "path":
		case "line":
			return node.stroke;
		default:
			return undefined;
	}
}

/** The built subtree, through core's own walker (`element-audit.ts:115-122`). */
function subtreeOf(node: CanvasNode): CanvasNode[] {
	const page = createPage({ root: createGroup({ children: [node] }) });
	const found: CanvasNode[] = [];
	walkPage(page, (ctx) => {
		if (ctx.node !== page.root) found.push(ctx.node);
	});
	return found;
}

interface RecolourReport {
	readonly id: string;
	readonly declared: CanvasElementEntry["recolor"];
	readonly rootKind: CanvasNode["type"];
	/** Nodes in the subtree that carry a fill-shaped field at all. */
	readonly fillSites: number;
	/** …of which took `FILL_PROBE` from `build({ fill })`. */
	readonly fillHits: number;
	readonly strokeSites: number;
	readonly strokeHits: number;
}

function report(entry: CanvasElementEntry): RecolourReport {
	const painted = subtreeOf(entry.build({ fill: FILL_PROBE }));
	const stroked = subtreeOf(entry.build({ stroke: STROKE_PROBE }));
	const fillSites = painted.filter((n) => fillOf(n) !== undefined);
	const strokeSites = stroked.filter((n) => strokeOf(n) !== undefined);
	return {
		id: entry.id,
		declared: entry.recolor,
		rootKind: entry.build().type,
		fillSites: fillSites.length,
		fillHits: fillSites.filter((n) => fillOf(n) === FILL_PROBE).length,
		strokeSites: strokeSites.length,
		strokeHits: strokeSites.filter((n) => strokeOf(n) === STROKE_PROBE).length,
	};
}

const REPORTS = DEFAULT_ELEMENTS.map(report);

function describeReport(r: RecolourReport): string {
	return `${r.id} [${r.declared}, root ${r.rootKind}] fill ${r.fillHits}/${r.fillSites} · stroke ${r.strokeHits}/${r.strokeSites}`;
}

/**
 * Kinds whose paint is reachable from a single field the inspector exposes.
 * `group` is deliberately absent from both: `CanvasGroupNode` is
 * `{ type; children }` (`core/src/ir/types.ts:484-487`) — no `fill`, no
 * `background`, no `stroke`.
 */
const FILL_BEARING_KINDS = new Set([
	"rect",
	"ellipse",
	"polygon",
	"star",
	"path",
	"frame",
]);
const STROKE_BEARING_KINDS = new Set([
	"rect",
	"ellipse",
	"polygon",
	"star",
	"path",
	"line",
]);

describe("element recolouring — catalog-wide (cp3-005)", () => {
	/**
	 * THE deliverable, as one assertion over all 425: every entry is either
	 * FULLY recolourable by the single control its declaration names, or it is
	 * flagged as something else. A partial answer is the failure this exists to
	 * prevent — a user changes the fill, some of the artwork changes, and that
	 * reads as a bug rather than as a design.
	 */
	it("every entry is either fully recolourable or flagged", () => {
		const offenders: string[] = [];
		for (const r of REPORTS) {
			switch (r.declared) {
				case "fill":
					// Every fill site answers, and there is no *other* paint surface
					// (a stroke) that the fill control would leave behind.
					if (r.fillSites === 0 || r.fillHits !== r.fillSites) {
						offenders.push(
							`${describeReport(r)} — fill did not reach all sites`,
						);
					}
					if (r.strokeSites !== 0) {
						offenders.push(
							`${describeReport(r)} — declares "fill" but also carries stroke; the fill control would half-repaint it`,
						);
					}
					break;
				case "stroke":
					if (r.strokeSites === 0 || r.strokeHits !== r.strokeSites) {
						offenders.push(
							`${describeReport(r)} — stroke did not reach all sites`,
						);
					}
					if (r.fillSites !== 0) {
						offenders.push(
							`${describeReport(r)} — declares "stroke" but also carries a fill`,
						);
					}
					break;
				case "multi":
					// The honest declaration is only safe because the root has no paint
					// field of its own — see the dedicated test below.
					if (FILL_BEARING_KINDS.has(r.rootKind)) {
						offenders.push(
							`${describeReport(r)} — declares "multi" but its ROOT takes a fill; one control would half-repaint it`,
						);
					}
					if (r.fillHits === 0 && r.strokeHits === 0) {
						offenders.push(
							`${describeReport(r)} — declares "multi" but nothing follows the build context; declare "none"`,
						);
					}
					break;
				case "none":
					if (r.fillHits > 0 || r.strokeHits > 0) {
						offenders.push(
							`${describeReport(r)} — declares "none" but honours a paint context`,
						);
					}
					break;
			}
		}
		expect(offenders).toEqual([]);
	});

	/**
	 * The audit is the shared gate `cp3-001` built for exactly this criterion;
	 * re-running it here keeps this file a complete statement of the contract
	 * rather than a partial one that has to be read alongside another file.
	 */
	it("passes checkElementEntry with no recolor-mismatch", () => {
		const mismatches = DEFAULT_ELEMENTS.flatMap((entry) =>
			checkElementEntry(entry),
		)
			.filter((issue) => issue.code === "recolor-mismatch")
			.map((issue) => `${issue.entryId}: ${issue.message}`);
		expect(mismatches).toEqual([]);
	});

	/**
	 * DELIVERABLE 3, as catalog-wide proof rather than as an ingest step nothing
	 * needs. "Normalize on ingest **if** any entry bakes in `fill`" — none does:
	 * `cp3-002` authored the geometry itself, every factory writes
	 * `context.fill ?? DEFAULT_INK` on exactly one node
	 * (`catalog-builders.ts:218,356,384,413,451,517`), and the vendored data is
	 * `d` strings with no presentation attributes at all. So the honest outcome
	 * is a proof, not a normalizer.
	 */
	it("no non-multi entry bakes a colour its control cannot reach", () => {
		const baked = REPORTS.filter(
			(r) =>
				r.declared !== "multi" &&
				(r.fillHits !== r.fillSites || r.strokeHits !== r.strokeSites),
		).map(describeReport);
		expect(baked).toEqual([]);
	});

	/**
	 * DELIVERABLE 4. The 22 stickers are the only multi-colour entries, and the
	 * reason they are not a half-recolour hazard is structural, not editorial:
	 * every one builds a `group`, and a group has nowhere to put a colour. There
	 * is no single control to press, so there is no way to press it and see only
	 * part of the artwork change.
	 *
	 * `"none"` was considered and rejected. It would be a lie — 28 of the 70
	 * painted sticker parts follow `context.fill` today, and all 70 are editable
	 * one at a time — and making it TRUE would mean deleting `fill: "inherit"`
	 * from `catalog-builders.ts`'s `buildPart`, removing a working capability to
	 * satisfy a label.
	 */
	it("every multi entry roots in a node kind with no paint field of its own", () => {
		const multi = REPORTS.filter((r) => r.declared === "multi");
		expect(multi.length).toBeGreaterThan(0);
		const offenders = multi
			.filter(
				(r) =>
					r.rootKind !== "group" ||
					FILL_BEARING_KINDS.has(r.rootKind) ||
					STROKE_BEARING_KINDS.has(r.rootKind),
			)
			.map(describeReport);
		expect(offenders).toEqual([]);
		// …and the IR really is what makes that true, not this test's opinion of
		// which kinds paint.
		for (const entry of DEFAULT_ELEMENTS.filter((e) => e.recolor === "multi")) {
			const root = entry.build();
			expect(fillOf(root), entry.id).toBeUndefined();
			expect(strokeOf(root), entry.id).toBeUndefined();
		}
	});

	/**
	 * The other half of the per-part contract: "select a part" is only an answer
	 * if every part IS selectable and paintable through a standard control. A
	 * sticker part of some kind the inspector paints nothing for would leave a
	 * genuinely unrecolourable region inside a "multi" entry.
	 */
	it("every part of every multi entry is individually recolourable", () => {
		const orphans: string[] = [];
		for (const entry of DEFAULT_ELEMENTS.filter((e) => e.recolor === "multi")) {
			for (const part of subtreeOf(entry.build()).slice(1)) {
				const paintable =
					FILL_BEARING_KINDS.has(part.type) ||
					STROKE_BEARING_KINDS.has(part.type);
				if (!paintable) orphans.push(`${entry.id}: ${part.type}`);
			}
		}
		expect(orphans).toEqual([]);
	});

	/**
	 * DELIVERABLE 5. Every stroke-based entry must land on a kind the shared
	 * `StrokeFields` block renders for, and must carry a plain-string stroke —
	 * `stroke` is `string` on every stroke-bearing IR kind, never a `CanvasFill`
	 * (`core/src/ir/types.ts:1158-1159`), which is why the stroke control is the
	 * literal `ColorField` and not the token-aware one.
	 */
	it("every stroke entry builds a stroke-bearing kind with a plain-string stroke", () => {
		const offenders: string[] = [];
		for (const entry of DEFAULT_ELEMENTS.filter(
			(e) => e.recolor === "stroke",
		)) {
			const node = entry.build({ stroke: STROKE_PROBE });
			if (!STROKE_BEARING_KINDS.has(node.type)) {
				offenders.push(`${entry.id}: root ${node.type} has no stroke control`);
			}
			if (typeof strokeOf(node) !== "string") {
				offenders.push(`${entry.id}: stroke is ${typeof strokeOf(node)}`);
			}
			const width = (node as { strokeWidth?: number }).strokeWidth;
			if (typeof width !== "number" || width <= 0) {
				offenders.push(`${entry.id}: strokeWidth ${String(width)}`);
			}
		}
		expect(offenders).toEqual([]);
	});

	/**
	 * Consistency, as the number a user actually sees rather than as the number
	 * in the data. `path` and `line` are SCALE-sized
	 * (`selection/transformer-helpers.ts:167-173`), so the weight on the canvas
	 * is `strokeWidth × scale`, not `strokeWidth`. The 156 outline icons are
	 * uniform by construction — 1.5 in a 24-unit box at a 96-unit default size,
	 * so exactly 6 units every time. The 25 `line` entries deliberately vary
	 * (that IS the difference between `line-thin` and `line-thick`), so they get
	 * a band rather than a constant. What the band rules out is the real failure:
	 * an entry that inserts as an invisible hairline or as a slab.
	 */
	it("renders every stroke entry at a usable weight at its default size", () => {
		const iconWeights = new Set<number>();
		const offenders: string[] = [];
		for (const entry of DEFAULT_ELEMENTS.filter(
			(e) => e.recolor === "stroke",
		)) {
			const node = entry.build();
			const width = (node as { strokeWidth?: number }).strokeWidth ?? 0;
			const scale = Math.max(
				Math.abs(node.transform.scaleX),
				Math.abs(node.transform.scaleY),
			);
			const effective = width * scale;
			if (!(effective >= 2 && effective <= 16)) {
				offenders.push(`${entry.id}: ${effective} units at default size`);
			}
			if (entry.category === "icon")
				iconWeights.add(Number(effective.toFixed(3)));
		}
		expect(offenders).toEqual([]);
		// Every outline icon draws at the same weight — a mixed icon set is the
		// visible inconsistency this deliverable is about.
		expect([...iconWeights]).toEqual([6]);
	});
});

const BRAND_KIT: BrandKit = {
	colors: [{ id: "brand.primary", name: "Primary", value: "#7c3aed" }],
	fonts: [],
};

const RESOLVED_TOKEN: BrandTokenRef = {
	type: "brand-token",
	tokenType: "color",
	id: "brand.primary",
};
const UNRESOLVED_TOKEN: BrandTokenRef = {
	type: "brand-token",
	tokenType: "color",
	id: "brand.missing",
};

function entryById(id: string): CanvasElementEntry {
	const entry = DEFAULT_ELEMENTS.find((e) => e.id === id);
	if (!entry) throw new Error(`no catalog entry "${id}"`);
	return entry;
}

/**
 * The golden lives beside the test in core's own `__snapshots__/*.snap.svg`
 * shape, but it is compared by hand rather than through
 * `toMatchFileSnapshot` — that matcher is **inert in this package**: every
 * snapshot assertion, file or inline, fails with "The snapshot state for … is
 * not found. Did you call 'SnapshotClient.setup()'?". Verified as pre-existing
 * and package-wide, not caused by this file: a throwaway
 * `expect("hello").toMatchInlineSnapshot('"hello"')` fails identically, under
 * both the jsdom and the `node` environment, while the same assertion passes in
 * `@anvilkit/canvas-core` — whose vitest config is the one difference that
 * matters, having no `setupFiles`. No other spec in this package uses
 * snapshots, so nothing had caught it.
 *
 * The hand-rolled comparison is not a downgrade of `cp4-006`'s golden
 * discipline; it is stricter. `toMatchFileSnapshot` rewrites its file on
 * `vitest -u` and creates it silently when absent, so a golden can be
 * regenerated by reflex. This one has no `-u` path at all: it fails on any
 * difference, and rewriting it takes a named environment variable
 * (`UPDATE_ELEMENT_RECOLOUR_GOLDEN=1`) that no gate ever sets.
 */
const GOLDEN_PATH = join(
	__dirname,
	"__snapshots__",
	"element-recolour.snap.svg",
);

describe("element recolouring — SVG export golden (cp3-005)", () => {
	const SIZE = { width: 48, height: 48 };

	/** Deterministic ids: a golden may not move because a uuid did. */
	function build(
		id: string,
		at: { x: number; y: number },
		context: { fill?: CanvasFill; stroke?: string } = {},
	): CanvasNode {
		let n = 0;
		return entryById(id).build({
			at,
			size: SIZE,
			newId: () => `${id}${n++ === 0 ? "" : `-part-${n - 1}`}`,
			...context,
		});
	}

	async function exportGolden() {
		const ir = createCanvasIR({
			id: "recolour-golden",
			title: "Recoloured elements",
			pages: [
				createPage({
					id: "p1",
					size: { width: 240, height: 160, unit: "px" },
					root: createGroup({
						id: "root",
						children: [
							// A stroke-based icon carrying a NEW stroke.
							build(
								"icon-check-outline",
								{ x: 8, y: 8 },
								{
									stroke: "#dc2626",
								},
							),
							// A filled shape carrying a NEW fill.
							build(
								"shape-triangle-right",
								{ x: 72, y: 8 },
								{
									fill: "#2563eb",
								},
							),
							// A brand-token fill that RESOLVES through the same resolver
							// the stage and the inspector use.
							build(
								"shape-square",
								{ x: 136, y: 8 },
								{
									fill: RESOLVED_TOKEN,
								},
							),
							// …and one that does not: core paints nothing and warns,
							// rather than defaulting to black.
							build(
								"shape-hexagon",
								{ x: 8, y: 72 },
								{
									fill: UNRESOLVED_TOKEN,
								},
							),
							// A multi-colour sticker: the parts marked to follow the build
							// context take the new colour, the accents keep their authored
							// ones. Visible in the golden precisely so the per-part contract
							// is evidence rather than prose.
							build(
								"sticker-sale-badge",
								{ x: 72, y: 72 },
								{
									fill: "#16a34a",
								},
							),
						],
					}),
				}),
			],
			now: () => "2026-05-20T00:00:00.000Z",
		});
		return serializePageToSvg(ir, "p1", {
			// Same option core's own goldens use — a golden nobody can read is a
			// golden nobody will classify.
			pretty: true,
			resolveBrandToken: (ref) => resolveBrandToken(ref, BRAND_KIT),
		});
	}

	it("carries the new fill and stroke into the exported SVG", async () => {
		const { svg, warnings } = await exportGolden();

		// AC-1, export half: the colour the user chose is IN the file.
		expect(svg).toContain('fill="#2563eb"');
		expect(svg).toContain('stroke="#dc2626"');
		// AC-2: a brand token resolves through the export path too, so the canvas
		// and the file agree.
		expect(svg).toContain('fill="#7c3aed"');
		// …and an unresolved one paints nothing, with the existing degrade.
		expect(warnings.map((w) => w.code)).toContain("BRAND_TOKEN_UNRESOLVED");
		// The sticker keeps its authored accents beside the seeded part — the
		// per-part contract, as bytes: one star takes the build colour, the
		// disc and the inner star keep `ACCENT_PAPER` and `ACCENT_WARM`
		// (`catalog-primitives.ts:1960-1966`).
		expect(svg).toContain('fill="#16a34a"');
		expect(svg).toContain('fill="#ffffff"');
		expect(svg).toContain('fill="#f97316"');

		expect(svg.startsWith("<svg ")).toBe(true);
		expect(svg.endsWith("</svg>")).toBe(true);

		if (process.env.UPDATE_ELEMENT_RECOLOUR_GOLDEN === "1") {
			mkdirSync(dirname(GOLDEN_PATH), { recursive: true });
			writeFileSync(GOLDEN_PATH, svg, "utf8");
		}
		// CRLF-normalised, not byte-literal: this submodule has no `.gitattributes`
		// of its own and the root's does not cascade into it, so a checkout under
		// `core.autocrlf=true` rewrites the golden's line endings. That is
		// environment rot, and a golden that reports it as a content diff sends the
		// reader hunting for a serializer change that did not happen. The bytes
		// that carry meaning — every attribute and every colour — are compared
		// exactly.
		expect(readFileSync(GOLDEN_PATH, "utf8").replace(/\r\n/g, "\n")).toBe(svg);
	});
});
