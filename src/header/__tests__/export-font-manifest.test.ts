import { createHash } from "node:crypto";
import type { CanvasIR, SvgFontFaceDef } from "@anvilkit/canvas-core";
import {
	createCanvasIR,
	createGroup,
	createPage,
	createText,
	resolveCanvasLayout,
	serializePageToSvg,
} from "@anvilkit/canvas-core";
import { describe, expect, it } from "vitest";
import { createCanvasLayoutMeasurementProvider } from "../../text/canvas-text-measurer.js";
import { DEFAULT_FONT_CATALOG } from "../../text/default-font-catalog.js";
import type { CanvasFontCatalogEntry } from "../../text/font-catalog.js";
import { createFontCatalog, mergeCatalogs } from "../../text/font-catalog.js";
import { createSvgExporter } from "../exporters.js";
import type { CanvasExportContext, CanvasExportRequest } from "../types.js";

/**
 * cp2-006 — the derived `@font-face` manifest, through the REAL SVG exporter.
 *
 * Everything here is measured on actual SVG bytes rather than on the manifest
 * object, because the acceptance criteria are about what lands in the file:
 * a rule with a resolvable `src` for a painted catalog family, no rule for
 * anything else, and — the one that protects every existing host — output that
 * is byte-for-byte what the pre-cp2-006 exporter produced.
 */

const REQUEST: CanvasExportRequest = {
	quality: 1,
	resolution: 1,
	stripMetadata: false,
};

const BOUNDS = { x: 0, y: 0, width: 100, height: 20 };

function fixture(families: readonly string[]): CanvasIR {
	const page = createPage({
		id: "p1",
		root: createGroup({
			id: "root",
			bounds: { width: 200, height: 200 },
			children: families.map((family, index) =>
				createText({
					id: `t${index}`,
					bounds: BOUNDS,
					text: "Hello",
					fontFamily: family,
				}),
			),
		}),
	});
	return createCanvasIR({
		id: "doc-1",
		title: "Fonts",
		pages: [page],
		now: () => "2026-01-01T00:00:00.000Z",
	});
}

function ctx(ir: CanvasIR): CanvasExportContext {
	return { ir, activePageId: "p1", stage: null };
}

const sha256 = (value: string): string =>
	createHash("sha256").update(value, "utf8").digest("hex");

/**
 * What a host got from `serializePageToSvg` BEFORE cp2-006: the exporter's own
 * call, reproduced field for field (`exporters.ts`), with the manifest the host
 * would have passed itself. This is the reference for byte-identity — not a
 * snapshot of the new code's output, which would prove nothing.
 */
async function preCp2006Svg(
	ir: CanvasIR,
	fonts?: readonly SvgFontFaceDef[],
): Promise<string> {
	const measurement = createCanvasLayoutMeasurementProvider();
	const resolved = resolveCanvasLayout(ir, { measurement });
	const { svg } = await serializePageToSvg(ir, "p1", {
		resolvedDocument: resolved,
		textMeasurer: measurement.measureText,
		...(fonts ? { fonts: [...fonts] } : {}),
	});
	return svg;
}

const EMBEDDABLE: CanvasFontCatalogEntry = {
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

const UNUSED: CanvasFontCatalogEntry = {
	...EMBEDDABLE,
	family: "Never Painted",
	source: {
		kind: "files",
		files: [
			{
				url: "https://cdn.example.com/never.woff2",
				format: "woff2",
				weight: 400,
			},
		],
	},
};

/** A record whose only face has no URL — the unresolvable-`src` case. */
const NO_URL: CanvasFontCatalogEntry = {
	...EMBEDDABLE,
	family: "Broken",
	source: { kind: "files", files: [{ url: "", weight: 400 }] },
};

const hostCatalog = createFontCatalog([EMBEDDABLE, UNUSED, NO_URL], {
	origin: "host",
});

const POPPINS_RULE =
	'@font-face{font-family:"Poppins";src:url("https://cdn.example.com/poppins-var.woff2") format("woff2");font-weight:100 900;font-style:normal;}';

describe("AC 1 — a files-bearing catalog family exports a resolvable @font-face", () => {
	it("emits the rule, with the real file URL as its src", async () => {
		const artifact = await createSvgExporter({ fontCatalog: hostCatalog })(
			ctx(fixture(["Poppins"])),
			REQUEST,
		);
		const svg = String(artifact.data);
		expect(svg).toContain("<defs><style>");
		expect(svg).toContain(POPPINS_RULE);
		expect(
			(artifact.warnings ?? []).filter(
				(w) => w.code === "FONT_NOT_IN_MANIFEST",
			),
		).toEqual([]);
	});

	it("matches a document that spells the family in another case", async () => {
		const artifact = await createSvgExporter({ fontCatalog: hostCatalog })(
			ctx(fixture(["poppins"])),
			REQUEST,
		);
		const svg = String(artifact.data);
		// Keyed on the document's spelling: core's manifest Map is case-sensitive.
		expect(svg).toContain('@font-face{font-family:"poppins";');
		expect(svg).toContain(
			'src:url("https://cdn.example.com/poppins-var.woff2")',
		);
	});

	it("prefers a brand-tier entry's licensed file for the same family", async () => {
		const brand = createFontCatalog(
			[
				{
					...EMBEDDABLE,
					license: "LicenseRef-corp",
					source: {
						kind: "files",
						files: [
							{ url: "https://cdn.corp.example/poppins.woff2", weight: 400 },
						],
					},
				},
			],
			{ origin: "brand" },
		);
		const artifact = await createSvgExporter({
			fontCatalog: mergeCatalogs(hostCatalog, brand),
		})(ctx(fixture(["Poppins"])), REQUEST);
		expect(String(artifact.data)).toContain(
			'src:url("https://cdn.corp.example/poppins.woff2")',
		);
	});
});

describe("AC 2 — unused catalog families produce no rules", () => {
	it("emits one rule for the painted family and none for the rest of the catalog", async () => {
		const artifact = await createSvgExporter({ fontCatalog: hostCatalog })(
			ctx(fixture(["Poppins"])),
			REQUEST,
		);
		const svg = String(artifact.data);
		expect(svg.match(/@font-face/g)).toHaveLength(1);
		expect(svg).not.toContain("Never Painted");
		expect(svg).not.toContain("never.woff2");
	});

	it("emits no <defs><style> at all for a document that paints no catalog family", async () => {
		const artifact = await createSvgExporter({ fontCatalog: hostCatalog })(
			ctx(fixture(["Helvetica"])),
			REQUEST,
		);
		const svg = String(artifact.data);
		expect(svg).not.toContain("@font-face");
		expect(svg).not.toContain("<defs><style>");
	});
});

describe("AC 3 — a host passing its own manifest sees byte-identical output", () => {
	const hostManifest: readonly SvgFontFaceDef[] = [
		{
			family: "Poppins",
			src: 'url("https://host.example.com/host-poppins.woff2") format("woff2")',
			weight: "400",
			style: "normal",
		},
	];

	it("is byte-for-byte the pre-cp2-006 serializer call", async () => {
		const ir = fixture(["Poppins"]);
		const artifact = await createSvgExporter({ fonts: hostManifest })(
			ctx(ir),
			REQUEST,
		);
		const before = await preCp2006Svg(ir, hostManifest);
		expect(sha256(String(artifact.data))).toBe(sha256(before));
		expect(String(artifact.data)).toBe(before);
	});

	it("wins outright over a catalog that would have mapped the same family", async () => {
		const ir = fixture(["Poppins"]);
		const withCatalog = await createSvgExporter({
			fonts: hostManifest,
			fontCatalog: hostCatalog,
		})(ctx(ir), REQUEST);
		const before = await preCp2006Svg(ir, hostManifest);
		expect(sha256(String(withCatalog.data))).toBe(sha256(before));
		expect(String(withCatalog.data)).toContain("host-poppins.woff2");
		expect(String(withCatalog.data)).not.toContain("poppins-var.woff2");
	});

	it("leaves an export with NO font options byte-identical to before as well", async () => {
		const ir = fixture(["Poppins"]);
		const artifact = await createSvgExporter()(ctx(ir), REQUEST);
		const before = await preCp2006Svg(ir);
		expect(sha256(String(artifact.data))).toBe(sha256(before));
	});

	it("keeps the derived path identical to hand-passing the same manifest", async () => {
		const ir = fixture(["Poppins"]);
		const derived = await createSvgExporter({ fontCatalog: hostCatalog })(
			ctx(ir),
			REQUEST,
		);
		const before = await preCp2006Svg(ir, [
			{
				family: "Poppins",
				src: 'url("https://cdn.example.com/poppins-var.woff2") format("woff2")',
				weight: "100 900",
				style: "normal",
			},
		]);
		expect(sha256(String(derived.data))).toBe(sha256(before));
	});
});

describe("AC 4 — never an @font-face with an empty or unresolvable src", () => {
	it("skips a catalog family whose only face has no URL, and lets core warn", async () => {
		const artifact = await createSvgExporter({ fontCatalog: hostCatalog })(
			ctx(fixture(["Broken"])),
			REQUEST,
		);
		const svg = String(artifact.data);
		expect(svg).not.toContain("@font-face");
		expect(svg).not.toContain('url("")');
		expect(
			(artifact.warnings ?? [])
				.filter((w) => w.code === "FONT_NOT_IN_MANIFEST")
				.map((w) => w.message),
		).toEqual([
			'Font family "Broken" is not in the manifest; relying on system fallback.',
		]);
	});

	it("emits the good family and skips the broken one in the same document", async () => {
		const artifact = await createSvgExporter({ fontCatalog: hostCatalog })(
			ctx(fixture(["Poppins", "Broken"])),
			REQUEST,
		);
		const svg = String(artifact.data);
		expect(svg.match(/@font-face/g)).toHaveLength(1);
		expect(svg).toContain(POPPINS_RULE);
	});
});

describe("the default catalog embeds nothing, and says so through the existing warning", () => {
	it("emits no @font-face for a document painting default-catalog families", async () => {
		const artifact = await createSvgExporter({
			fontCatalog: DEFAULT_FONT_CATALOG,
		})(ctx(fixture(["Inter", "Lora"])), REQUEST);
		const svg = String(artifact.data);
		expect(svg).not.toContain("@font-face");
		expect(
			(artifact.warnings ?? [])
				.filter((w) => w.code === "FONT_NOT_IN_MANIFEST")
				.map((w) => w.message)
				.sort(),
		).toEqual([
			'Font family "Inter" is not in the manifest; relying on system fallback.',
			'Font family "Lora" is not in the manifest; relying on system fallback.',
		]);
	});

	it("is byte-identical to exporting with no catalog at all", async () => {
		const ir = fixture(["Inter", "Lora"]);
		const withDefaults = await createSvgExporter({
			fontCatalog: DEFAULT_FONT_CATALOG,
		})(ctx(ir), REQUEST);
		const without = await createSvgExporter()(ctx(ir), REQUEST);
		expect(sha256(String(withDefaults.data))).toBe(
			sha256(String(without.data)),
		);
	});

	it("embeds a host family merged over the defaults, and only that one", async () => {
		const artifact = await createSvgExporter({
			fontCatalog: mergeCatalogs(DEFAULT_FONT_CATALOG, hostCatalog),
		})(ctx(fixture(["Inter", "Poppins"])), REQUEST);
		const svg = String(artifact.data);
		expect(svg.match(/@font-face/g)).toHaveLength(1);
		expect(svg).toContain(POPPINS_RULE);
	});
});
