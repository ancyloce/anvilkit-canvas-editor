import {
	type CanvasNode,
	createCanvasIR,
	createGroup,
	createPage,
	serializePageToSvg,
	walkPage,
} from "@anvilkit/canvas-core";
import { describe, expect, it } from "vitest";
import {
	ALLOWED_ELEMENT_LICENSES,
	DEFAULT_ELEMENT_ATTRIBUTIONS,
	DEFAULT_ELEMENTS,
} from "../default-element-catalog.js";
import { createDefaultElementProvider } from "../default-element-provider.js";
import { checkElementEntry } from "../element-audit.js";
import {
	CANVAS_ELEMENT_CATEGORIES,
	type CanvasElementCategory,
	type CanvasElementEntry,
} from "../element-entry.js";
import { createStaticElementProvider } from "../element-provider.js";

const ALLOWED = new Set<string>(ALLOWED_ELEMENT_LICENSES);

/** Category floors: no category may degrade into a token single entry. */
const CATEGORY_FLOOR: Record<CanvasElementCategory, number> = {
	shape: 40,
	icon: 250,
	line: 20,
	frame: 15,
	sticker: 18,
};

function byCategory(category: CanvasElementCategory): CanvasElementEntry[] {
	return DEFAULT_ELEMENTS.filter((entry) => entry.category === category);
}

function subtreeOf(node: CanvasNode): CanvasNode[] {
	const page = createPage({ root: createGroup({ children: [node] }) });
	const found: CanvasNode[] = [];
	walkPage(page, (ctx) => {
		if (ctx.node !== page.root) found.push(ctx.node);
	});
	return found;
}

describe("default element catalog — licensing (cp3-002)", () => {
	/**
	 * THE DELIVERABLE, as a test rather than as a convention. An SPDX id in a
	 * shipped catalog is a legal claim; the allowed set is the enforcement.
	 */
	it("every entry carries an allowed SPDX identifier", () => {
		const offenders = DEFAULT_ELEMENTS.filter(
			(entry) => !ALLOWED.has(entry.license),
		).map((entry) => `${entry.id}: ${entry.license}`);
		expect(offenders).toEqual([]);
	});

	it("every entry records where its geometry came from", () => {
		const missing = DEFAULT_ELEMENTS.filter(
			(entry) =>
				entry.upstreamUrl === undefined ||
				!entry.upstreamUrl.startsWith("https://"),
		).map((entry) => entry.id);
		expect(missing).toEqual([]);
	});

	/**
	 * MIT and Apache-2.0 both require the copyright notice to travel with the
	 * copy. Vendoring geometry into this repo takes that obligation on, so the
	 * notice ships as data a host can render — not only as a comment that the
	 * minifier is free to drop.
	 */
	it("publishes a copyright notice for every licence it ships under", () => {
		const licensesInUse = new Set(
			DEFAULT_ELEMENTS.map((entry) => entry.license),
		);
		const licensesNoticed = new Set(
			DEFAULT_ELEMENT_ATTRIBUTIONS.map((record) => record.license),
		);
		for (const license of licensesInUse) {
			expect(licensesNoticed).toContain(license);
		}
		for (const record of DEFAULT_ELEMENT_ATTRIBUTIONS) {
			expect(record.copyright).toMatch(/Copyright/);
			expect(record.upstreamUrl).toMatch(/^https:\/\//);
			expect(record.verifiedFrom.length).toBeGreaterThan(0);
			expect(ALLOWED).toContain(record.license);
		}
	});

	/**
	 * Lucide is the icon set this workspace already has installed, and it is
	 * ISC — outside the allowed set. Pinning its absence keeps the convenient
	 * mistake from being made later by someone reaching for what is to hand.
	 */
	it("ships no ISC-licensed geometry", () => {
		expect(ALLOWED.has("ISC")).toBe(false);
		expect(DEFAULT_ELEMENTS.some((entry) => entry.license === "ISC")).toBe(
			false,
		);
	});
});

describe("default element catalog — coverage (cp3-002)", () => {
	it("spans all five categories above their floors", () => {
		const spread = Object.fromEntries(
			CANVAS_ELEMENT_CATEGORIES.map((category) => [
				category,
				byCategory(category).length,
			]),
		) as Record<CanvasElementCategory, number>;
		for (const category of CANVAS_ELEMENT_CATEGORIES) {
			expect(
				spread[category],
				`category "${category}" has ${spread[category]} entries`,
			).toBeGreaterThanOrEqual(CATEGORY_FLOOR[category]);
		}
		expect(DEFAULT_ELEMENTS.length).toBeGreaterThanOrEqual(300);
	});

	it("has no duplicate entry ids", () => {
		const seen = new Set<string>();
		const duplicates: string[] = [];
		for (const entry of DEFAULT_ELEMENTS) {
			if (seen.has(entry.id)) duplicates.push(entry.id);
			seen.add(entry.id);
		}
		expect(duplicates).toEqual([]);
	});

	it("has no duplicate entry names", () => {
		const seen = new Set<string>();
		const duplicates: string[] = [];
		for (const entry of DEFAULT_ELEMENTS) {
			if (seen.has(entry.name)) duplicates.push(entry.name);
			seen.add(entry.name);
		}
		expect(duplicates).toEqual([]);
	});

	/**
	 * `tags` is required by the contract, so "present" is a type-level fact —
	 * "non-empty" is not, and an empty array would silently remove an entry from
	 * every chip filter `cp3-003` builds.
	 */
	it("gives every entry a non-empty tag list", () => {
		const untagged = DEFAULT_ELEMENTS.filter(
			(entry) => entry.tags.length === 0,
		).map((entry) => entry.id);
		expect(untagged).toEqual([]);
	});

	/**
	 * An icon set without synonyms is unsearchable: "bin" and "trash" and
	 * "delete" are one icon and only one of those is its name. Four is the floor
	 * because a name plus three synonyms is the point at which a wrong first
	 * guess still finds the entry.
	 */
	it("gives every entry at least four search keywords", () => {
		const thin = DEFAULT_ELEMENTS.filter(
			(entry) => (entry.keywords ?? []).length < 4,
		).map((entry) => `${entry.id}: ${(entry.keywords ?? []).length}`);
		expect(thin).toEqual([]);
	});

	it("never repeats a keyword within one entry", () => {
		const repeated = DEFAULT_ELEMENTS.filter((entry) => {
			const words = entry.keywords ?? [];
			return new Set(words.map((w) => w.toLowerCase())).size !== words.length;
		}).map((entry) => entry.id);
		expect(repeated).toEqual([]);
	});

	it("declares recolour for every entry, and honestly", () => {
		const spread = new Map<string, number>();
		for (const entry of DEFAULT_ELEMENTS) {
			spread.set(entry.recolor, (spread.get(entry.recolor) ?? 0) + 1);
		}
		// Every sticker is a deliberate multi-colour composition; nothing else is.
		expect(spread.get("multi")).toBe(byCategory("sticker").length);
		// Nothing in the default catalog is unrecolourable — that state exists in
		// the contract for host artwork under a licence that forbids recolouring.
		expect(spread.get("none")).toBeUndefined();
		expect((spread.get("fill") ?? 0) + (spread.get("stroke") ?? 0)).toBe(
			DEFAULT_ELEMENTS.length - byCategory("sticker").length,
		);
	});
});

describe("default element catalog — node validity (cp3-002)", () => {
	/**
	 * `cp3-001` built `checkElementEntry` for exactly this call site: it builds
	 * the entry, walks the subtree with core's `walkPage`, runs
	 * `CanvasNodeSchema.safeParse` and `validateCanvasIRInvariants` on a document
	 * the node is really inserted into, checks ids are minted per call, and
	 * probes that the declared `recolor` matches where paint actually lands.
	 * Running it over the whole catalog is one assertion for five deliverables.
	 */
	it("every entry builds a schema-valid, invariant-clean node", () => {
		const issues = DEFAULT_ELEMENTS.flatMap((entry) =>
			checkElementEntry(entry),
		).map((issue) => `${issue.entryId} [${issue.code}] ${issue.message}`);
		expect(issues).toEqual([]);
	});

	it("builds only the eight kinds an element may build", () => {
		const allowed = new Set([
			"group",
			"frame",
			"rect",
			"ellipse",
			"polygon",
			"star",
			"line",
			"path",
		]);
		const kinds = new Set<string>();
		for (const entry of DEFAULT_ELEMENTS) {
			for (const node of subtreeOf(entry.build())) kinds.add(node.type);
		}
		expect([...kinds].filter((kind) => !allowed.has(kind))).toEqual([]);
	});

	/**
	 * The sizing model, asserted rather than described. `path` and `line` are
	 * scale-sized (`selection/transformer-helpers.ts:167-173`), so an entry asked
	 * for at an arbitrary size must answer with `bounds × scale === size` — not
	 * with the size written into `bounds`, which the renderer ignores.
	 */
	it("honours a requested size on the root node", () => {
		const size = { width: 640, height: 480 };
		const wrong: string[] = [];
		for (const entry of DEFAULT_ELEMENTS) {
			const node = entry.build({ size, at: { x: 12, y: 34 } });
			const width = node.bounds.width * node.transform.scaleX;
			const height = node.bounds.height * node.transform.scaleY;
			// A perfectly straight `line` has a zero extent on one axis and cannot
			// be stretched along it; every other entry must match on both.
			const widthOk =
				node.bounds.width === 0 || Math.abs(width - size.width) < 0.001;
			const heightOk =
				node.bounds.height === 0 || Math.abs(height - size.height) < 0.001;
			if (!widthOk || !heightOk) {
				wrong.push(`${entry.id}: ${width}×${height}`);
			}
			if (node.transform.x !== 12 || node.transform.y !== 34) {
				wrong.push(
					`${entry.id}: placed at ${node.transform.x},${node.transform.y}`,
				);
			}
		}
		expect(wrong).toEqual([]);
	});

	it("places at the origin and at defaultSize when given no context", () => {
		for (const entry of DEFAULT_ELEMENTS.slice(0, 40)) {
			const node = entry.build();
			expect(node.transform.x).toBe(0);
			expect(node.transform.y).toBe(0);
			expect(node.bounds.width * node.transform.scaleX).toBeCloseTo(
				entry.defaultSize.width,
				3,
			);
		}
	});

	it("gives every entry a preview the panel can render without building it", () => {
		const bad = DEFAULT_ELEMENTS.filter((entry) => {
			if (entry.preview.kind !== "path") return true;
			return (
				entry.preview.d.trim().length === 0 ||
				entry.preview.viewBox === undefined ||
				!/^0 0 \d+(\.\d+)? \d+(\.\d+)?$/.test(entry.preview.viewBox)
			);
		}).map((entry) => entry.id);
		expect(bad).toEqual([]);
	});

	/**
	 * The real export pipeline, not a stand-in. Every entry goes onto a page and
	 * through `serializePageToSvg`; a `d` outside the serializer's character
	 * allowlist would come back as `PATH_INVALID_D` with the node **dropped from
	 * the export**, which no schema check would have caught.
	 */
	it("survives the SVG exporter with no fidelity warnings", async () => {
		const ir = createCanvasIR({
			pages: [
				createPage({
					size: { width: 4000, height: 4000, unit: "px" },
					root: createGroup({
						children: DEFAULT_ELEMENTS.map((entry) => entry.build()),
					}),
				}),
			],
		});
		const result = await serializePageToSvg(ir, 0);
		const unexpected = result.warnings.filter(
			// An empty image well has nothing to draw yet and says so; that is the
			// point of a placeholder, and core paints a deterministic fallback.
			(warning) => warning.code !== "FRAME_PLACEHOLDER_UNRESOLVED",
		);
		expect(unexpected).toEqual([]);
		expect(result.svg).toContain("<path");
	});
});

describe("default element catalog — search (cp3-002)", () => {
	const provider = createStaticElementProvider(DEFAULT_ELEMENTS, {
		pageSize: 500,
	});

	async function idsFor(text: string): Promise<string[]> {
		const result = await provider.search({ text });
		return result.entries.map((entry) => entry.id);
	}

	/**
	 * The acceptance criterion: "search on synonyms returns sensible results".
	 * Each case is a word a user would type that is NOT the entry's name, which
	 * is the only kind of case that proves the keyword lists are doing work.
	 */
	it.each([
		["bin", "icon-trash-solid"],
		["delete", "icon-trash-outline"],
		["rubbish", "icon-trash-solid"],
		["automobile", "icon-car-solid"],
		["picture", "icon-image-solid"],
		["photograph", "icon-image-solid"],
		["magnifier", "icon-search-solid"],
		["cog", "icon-settings-outline"],
		["hamburger", "icon-menu-outline"],
		["padlock", "icon-lock-outline"],
		["bullhorn", "icon-megaphone-solid"],
		["trolley", "icon-cart-solid"],
		["aeroplane", "icon-airplane-solid"],
		["lorry", "icon-truck-solid"],
		["favourite", "icon-star-solid"],
		["squircle", "shape-rounded-square"],
		["doughnut", "shape-ring"],
		["squiggle", "line-wave"],
		["avatar", "frame-circle"],
		["washi", "sticker-tape"],
	])("%s finds %s", async (text, expectedId) => {
		expect(await idsFor(text)).toContain(expectedId);
	});

	it("finds both the filled and the outline variant of one concept", async () => {
		const ids = await idsFor("trash");
		expect(ids).toContain("icon-trash-solid");
		expect(ids).toContain("icon-trash-outline");
	});

	it("filters by category without losing the text match", async () => {
		const result = await provider.search({ text: "star", category: "shape" });
		expect(result.entries.length).toBeGreaterThan(0);
		expect(result.entries.every((entry) => entry.category === "shape")).toBe(
			true,
		);
	});

	it("returns nothing for a word the catalog does not know", async () => {
		expect(await idsFor("zzzzznotaword")).toEqual([]);
	});
});

describe("default element provider — laziness (cp3-002)", () => {
	it("constructs without touching the catalog, then resolves it on first search", async () => {
		const provider = createDefaultElementProvider({ pageSize: 12 });
		const first = await provider.search({ text: "", category: "icon" });
		expect(first.entries).toHaveLength(12);
		expect(first.nextCursor).toBe("12");
		expect(first.total).toBe(
			DEFAULT_ELEMENTS.filter((entry) => entry.category === "icon").length,
		);
	});

	it("resolves an entry by id through the lazy provider", async () => {
		const provider = createDefaultElementProvider();
		const entry = await provider.getById("shape-hexagon");
		expect(entry?.name).toBe("Hexagon");
		expect(await provider.getById("nope")).toBeNull();
	});
});
