import type {
	BrandTokenRef,
	CanvasNode,
	CanvasPage,
} from "@anvilkit/canvas-core";
import {
	createGroup,
	createPage,
	createRect,
	createRichText,
	createText,
	DEFAULT_RICH_TEXT_STYLE,
} from "@anvilkit/canvas-core";
import { describe, expect, it } from "vitest";
import { DEFAULT_FONT_CATALOG } from "../default-font-catalog.js";
import {
	buildCatalogFontManifest,
	catalogFontFaceDef,
	collectPaintedFontFamilies,
	deriveSvgFontManifest,
} from "../export-font-manifest.js";
import type { CanvasFontCatalogEntry } from "../font-catalog.js";
import { createFontCatalog, mergeCatalogs } from "../font-catalog.js";

/**
 * cp2-006 — the catalog → `@font-face` manifest mapping, as a pure unit.
 *
 * The whole-exporter coverage (real SVG bytes, host precedence, byte-identity)
 * lives in `header/__tests__/export-font-manifest.test.ts`; this file pins the
 * three things that decide what that exporter can possibly emit: which
 * families a page paints, which catalog records can become an `@font-face`,
 * and which are skipped.
 */

const BOUNDS = { x: 0, y: 0, width: 100, height: 20 };

function page(children: CanvasNode[], id = "p1"): CanvasPage {
	return createPage({
		id,
		root: createGroup({
			id: "root",
			bounds: { width: 100, height: 100 },
			children,
		}),
	});
}

/** A host family that CAN be embedded: one variable woff2 file. */
const POPPINS: CanvasFontCatalogEntry = {
	family: "Poppins",
	category: "sans",
	weights: [{ min: 100, max: 900 }],
	license: "OFL-1.1",
	source: {
		kind: "files",
		files: [
			{
				url: "https://cdn.example.com/poppins-var.woff2",
				format: "woff2",
				weight: { min: 100, max: 900 },
			},
		],
	},
};

/** A host family described by a stylesheet only — the default catalog's shape. */
const CSS_ONLY: CanvasFontCatalogEntry = {
	family: "Stylesheet Only",
	category: "serif",
	weights: [400],
	license: "OFL-1.1",
	source: { kind: "css", css: "https://cdn.example.com/family.css" },
};

const hostCatalog = createFontCatalog([POPPINS, CSS_ONLY], { origin: "host" });

describe("collectPaintedFontFamilies", () => {
	it("collects a text node's family", () => {
		const families = collectPaintedFontFamilies(
			page([
				createText({
					id: "t1",
					bounds: BOUNDS,
					text: "hi",
					fontFamily: "Poppins",
				}),
			]),
		);
		expect([...families]).toEqual(["Poppins"]);
	});

	it("collects nothing from a document that paints no text", () => {
		const families = collectPaintedFontFamilies(
			page([createRect({ id: "r1", bounds: BOUNDS })]),
		);
		expect(families.size).toBe(0);
	});

	it("recurses into containers", () => {
		const nested = createGroup({
			id: "g1",
			bounds: { width: 50, height: 50 },
			children: [
				createText({
					id: "t1",
					bounds: BOUNDS,
					text: "hi",
					fontFamily: "Deep Family",
				}),
			],
		});
		expect([...collectPaintedFontFamilies(page([nested]))]).toEqual([
			"Deep Family",
		]);
	});

	it("skips an invisible node, mirroring the serializer's skipInvisible default", () => {
		const hidden = {
			...createText({
				id: "t1",
				bounds: BOUNDS,
				text: "hi",
				fontFamily: "Poppins",
			}),
			visible: false,
		};
		expect(collectPaintedFontFamilies(page([hidden])).size).toBe(0);
	});

	it("adds the rich-text defaults family plus every span override", () => {
		const rich = createRichText({
			id: "rt1",
			bounds: BOUNDS,
			paragraphs: [
				{ spans: [{ text: "a" }, { text: "b", fontFamily: "Span Family" }] },
				{ spans: [{ text: "c", fontFamily: "Other Family" }] },
			],
		});
		expect([...collectPaintedFontFamilies(page([rich]))].sort()).toEqual(
			[
				DEFAULT_RICH_TEXT_STYLE.fontFamily,
				"Other Family",
				"Span Family",
			].sort(),
		);
	});

	it("contributes nothing for a rich-text node with no paragraphs", () => {
		const empty = {
			...createRichText({ id: "rt1", bounds: BOUNDS }),
			paragraphs: [],
		};
		expect(collectPaintedFontFamilies(page([empty])).size).toBe(0);
	});

	it("resolves a BrandTokenRef font through the supplied resolver", () => {
		const ref: BrandTokenRef = { id: "brand-heading", tokenType: "font" };
		const families = collectPaintedFontFamilies(
			page([
				createText({ id: "t1", bounds: BOUNDS, text: "hi", fontFamily: ref }),
			]),
			{
				resolveBrandToken: (token) =>
					token.id === "brand-heading" ? "Poppins" : undefined,
			},
		);
		expect([...families]).toEqual(["Poppins"]);
	});

	it("drops an unresolved brand token rather than inventing a family", () => {
		const ref: BrandTokenRef = { id: "missing", tokenType: "font" };
		expect(
			collectPaintedFontFamilies(
				page([
					createText({ id: "t1", bounds: BOUNDS, text: "hi", fontFamily: ref }),
				]),
				{ resolveBrandToken: () => undefined },
			).size,
		).toBe(0);
	});

	it("ignores a resolver that answers with a gradient rather than a family", () => {
		const ref: BrandTokenRef = { id: "grad", tokenType: "font" };
		expect(
			collectPaintedFontFamilies(
				page([
					createText({ id: "t1", bounds: BOUNDS, text: "hi", fontFamily: ref }),
				]),
				{
					resolveBrandToken: () => ({
						kind: "linear" as const,
						stops: [
							{ offset: 0, color: "#000" },
							{ offset: 1, color: "#fff" },
						],
						angle: 0,
					}),
				},
			).size,
		).toBe(0);
	});
});

describe("catalogFontFaceDef", () => {
	it("maps a files-bearing record onto every SvgFontFaceDef field", () => {
		const record = hostCatalog.get("Poppins");
		expect(record).toBeDefined();
		expect(record && catalogFontFaceDef(record, "Poppins")).toEqual({
			family: "Poppins",
			src: 'url("https://cdn.example.com/poppins-var.woff2") format("woff2")',
			weight: "100 900",
			style: "normal",
		});
	});

	it("keys the rule on the CALLER's spelling, because core's manifest Map is case-sensitive", () => {
		const record = hostCatalog.get("poppins");
		expect(record?.family).toBe("Poppins");
		expect(record && catalogFontFaceDef(record, "poppins")?.family).toBe(
			"poppins",
		);
	});

	it("returns undefined for a stylesheet-only record — there is no usable src", () => {
		const record = hostCatalog.get("Stylesheet Only");
		expect(record).toBeDefined();
		expect(
			record && catalogFontFaceDef(record, "Stylesheet Only"),
		).toBeUndefined();
	});

	it("prefers a variable file so one rule covers every weight in use", () => {
		const catalog = createFontCatalog([
			{
				...POPPINS,
				source: {
					kind: "files",
					files: [
						{
							url: "https://cdn.example.com/p-400.woff2",
							format: "woff2",
							weight: 400,
						},
						{
							url: "https://cdn.example.com/p-var.woff2",
							format: "woff2",
							weight: { min: 200, max: 800 },
						},
					],
				},
			},
		]);
		const record = catalog.get("Poppins");
		expect(record && catalogFontFaceDef(record, "Poppins")).toMatchObject({
			src: 'url("https://cdn.example.com/p-var.woff2") format("woff2")',
			weight: "200 800",
		});
	});

	it("prefers regular 400 among static weights", () => {
		const catalog = createFontCatalog([
			{
				...POPPINS,
				source: {
					kind: "files",
					files: [
						{ url: "https://cdn.example.com/p-700.woff2", weight: 700 },
						{ url: "https://cdn.example.com/p-400.woff2", weight: 400 },
					],
				},
			},
		]);
		const record = catalog.get("Poppins");
		expect(record && catalogFontFaceDef(record, "Poppins")).toMatchObject({
			src: 'url("https://cdn.example.com/p-400.woff2")',
			weight: "400",
		});
	});

	it("prefers an upright face over an italic one", () => {
		const catalog = createFontCatalog([
			{
				...POPPINS,
				source: {
					kind: "files",
					files: [
						{
							url: "https://cdn.example.com/p-italic.woff2",
							weight: 400,
							style: "italic",
						},
						{ url: "https://cdn.example.com/p-upright.woff2", weight: 400 },
					],
				},
			},
		]);
		const record = catalog.get("Poppins");
		expect(record && catalogFontFaceDef(record, "Poppins")).toMatchObject({
			src: 'url("https://cdn.example.com/p-upright.woff2")',
			style: "normal",
		});
	});

	it("still embeds an italic-only family rather than emitting nothing", () => {
		const catalog = createFontCatalog([
			{
				...POPPINS,
				source: {
					kind: "files",
					files: [
						{
							url: "https://cdn.example.com/p-italic.woff2",
							weight: 400,
							style: "italic",
						},
					],
				},
			},
		]);
		const record = catalog.get("Poppins");
		expect(record && catalogFontFaceDef(record, "Poppins")).toMatchObject({
			style: "italic",
		});
	});

	it("skips a file whose url is empty or whitespace — never an unresolvable src", () => {
		const catalog = createFontCatalog([
			{
				...POPPINS,
				source: { kind: "files", files: [{ url: "   ", weight: 400 }] },
			},
		]);
		const record = catalog.get("Poppins");
		expect(record && catalogFontFaceDef(record, "Poppins")).toBeUndefined();
	});

	it("falls back to a later file when the first has no url", () => {
		const catalog = createFontCatalog([
			{
				...POPPINS,
				source: {
					kind: "files",
					files: [
						{ url: "", weight: 400 },
						{ url: "https://cdn.example.com/p-700.woff2", weight: 700 },
					],
				},
			},
		]);
		const record = catalog.get("Poppins");
		expect(record && catalogFontFaceDef(record, "Poppins")).toMatchObject({
			src: 'url("https://cdn.example.com/p-700.woff2")',
			weight: "700",
		});
	});

	it("reads `files` off a css-source entry that also carries them", () => {
		const catalog = createFontCatalog([
			{
				...CSS_ONLY,
				source: {
					kind: "css",
					css: "https://cdn.example.com/family.css",
					files: [
						{
							url: "https://cdn.example.com/family.woff2",
							format: "woff2",
							weight: 400,
						},
					],
				},
			},
		]);
		const record = catalog.get("Stylesheet Only");
		expect(
			record && catalogFontFaceDef(record, "Stylesheet Only"),
		).toMatchObject({
			src: 'url("https://cdn.example.com/family.woff2") format("woff2")',
		});
	});
});

describe("buildCatalogFontManifest — the catalog ∩ painted intersection", () => {
	it("emits nothing for a catalog family the document does not paint", () => {
		expect(
			buildCatalogFontManifest(hostCatalog, ["Some Other Family"]),
		).toEqual([]);
	});

	it("emits ONLY the painted family, never the whole catalog", () => {
		const manifest = buildCatalogFontManifest(hostCatalog, ["Poppins"]);
		expect(manifest).toHaveLength(1);
		expect(manifest[0]?.family).toBe("Poppins");
	});

	it("emits nothing at all for an empty painted set", () => {
		expect(buildCatalogFontManifest(hostCatalog, [])).toEqual([]);
	});

	it("emits one def per family even if a family is offered twice", () => {
		expect(
			buildCatalogFontManifest(hostCatalog, ["Poppins", "Poppins"]),
		).toHaveLength(1);
	});

	it("skips a painted family the catalog does not describe", () => {
		expect(
			buildCatalogFontManifest(hostCatalog, ["Poppins", "Helvetica"]),
		).toHaveLength(1);
	});

	it("skips a painted family the catalog describes with no embeddable file", () => {
		expect(buildCatalogFontManifest(hostCatalog, ["Stylesheet Only"])).toEqual(
			[],
		);
	});
});

describe("deriveSvgFontManifest — page in, manifest out", () => {
	it("maps a painted catalog family end to end", () => {
		const manifest = deriveSvgFontManifest(
			page([
				createText({
					id: "t1",
					bounds: BOUNDS,
					text: "hi",
					fontFamily: "Poppins",
				}),
				createText({
					id: "t2",
					bounds: BOUNDS,
					text: "hi",
					fontFamily: "Stylesheet Only",
				}),
				createRect({ id: "r1", bounds: BOUNDS }),
			]),
			hostCatalog,
		);
		expect(manifest).toEqual([
			{
				family: "Poppins",
				src: 'url("https://cdn.example.com/poppins-var.woff2") format("woff2")',
				weight: "100 900",
				style: "normal",
			},
		]);
	});

	it("emits nothing for an EMBEDDABLE catalog family the page never paints", () => {
		// The intersection carries this one on its own: both families could
		// become a rule, and only the painted one may. Widen the derivation to
		// the whole catalog and this is the assertion that goes red.
		const catalog = createFontCatalog([
			POPPINS,
			{
				...POPPINS,
				family: "Never Painted",
				source: {
					kind: "files",
					files: [{ url: "https://cdn.example.com/never.woff2", weight: 400 }],
				},
			},
		]);
		const manifest = deriveSvgFontManifest(
			page([
				createText({
					id: "t1",
					bounds: BOUNDS,
					text: "hi",
					fontFamily: "Poppins",
				}),
			]),
			catalog,
		);
		expect(manifest.map((def) => def.family)).toEqual(["Poppins"]);
	});

	it("matches a document that spells the family in another case", () => {
		const manifest = deriveSvgFontManifest(
			page([
				createText({
					id: "t1",
					bounds: BOUNDS,
					text: "hi",
					fontFamily: "  poppins ",
				}),
			]),
			hostCatalog,
		);
		// Keyed on the document's spelling — core looks the def up with that key.
		expect(manifest[0]?.family).toBe("  poppins ");
		expect(manifest[0]?.src).toContain("poppins-var.woff2");
	});

	it("uses a brand-tier entry over the host's for the same family", () => {
		const brand = createFontCatalog(
			[
				{
					...POPPINS,
					license: "LicenseRef-corp",
					source: {
						kind: "files",
						files: [
							{
								url: "https://cdn.corp.example/poppins-licensed.woff2",
								weight: 400,
							},
						],
					},
				},
			],
			{ origin: "brand" },
		);
		const manifest = deriveSvgFontManifest(
			page([
				createText({
					id: "t1",
					bounds: BOUNDS,
					text: "hi",
					fontFamily: "Poppins",
				}),
			]),
			mergeCatalogs(hostCatalog, brand),
		);
		expect(manifest[0]?.src).toBe(
			'url("https://cdn.corp.example/poppins-licensed.woff2")',
		);
	});
});

describe("the default catalog embeds nothing, by design (cp2-002)", () => {
	it("produces an EMPTY manifest for a document painting default families", () => {
		const manifest = deriveSvgFontManifest(
			page([
				createText({
					id: "t1",
					bounds: BOUNDS,
					text: "hi",
					fontFamily: "Inter",
				}),
				createText({
					id: "t2",
					bounds: BOUNDS,
					text: "hi",
					fontFamily: "Lora",
				}),
				createText({
					id: "t3",
					bounds: BOUNDS,
					text: "hi",
					fontFamily: "JetBrains Mono",
				}),
			]),
			DEFAULT_FONT_CATALOG,
		);
		expect(manifest).toEqual([]);
	});

	it("is the catalog's shape, not a lookup failure — every family IS in the catalog", () => {
		for (const family of ["Inter", "Lora", "JetBrains Mono"]) {
			const record = DEFAULT_FONT_CATALOG.get(family);
			expect(record, family).toBeDefined();
			expect(record?.source.files, family).toBeUndefined();
		}
	});

	it("a host entry carrying files IS embedded even when merged over the defaults", () => {
		const manifest = deriveSvgFontManifest(
			page([
				createText({
					id: "t1",
					bounds: BOUNDS,
					text: "hi",
					fontFamily: "Inter",
				}),
				createText({
					id: "t2",
					bounds: BOUNDS,
					text: "hi",
					fontFamily: "Poppins",
				}),
			]),
			mergeCatalogs(DEFAULT_FONT_CATALOG, hostCatalog),
		);
		expect(manifest.map((def) => def.family)).toEqual(["Poppins"]);
	});
});
