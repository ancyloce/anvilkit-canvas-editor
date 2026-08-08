import type { SvgFontFaceDef } from "@anvilkit/canvas-core";
import { describe, expect, it } from "vitest";
import {
	DEFAULT_FONT_CATALOG,
	DEFAULT_FONT_CATALOG_ENTRIES,
	OPEN_FONT_LICENSES,
} from "../default-font-catalog.js";
import {
	CANVAS_FONT_CATEGORIES,
	type CanvasFontCategory,
	type CanvasFontFile,
	createFontCatalog,
	fontFaceSrc,
	fontFamilyKey,
	fontWeightCss,
	mergeCatalogs,
} from "../font-catalog.js";

const entries = DEFAULT_FONT_CATALOG_ENTRIES;

function countByCategory(): Record<CanvasFontCategory, number> {
	const counts = Object.fromEntries(
		CANVAS_FONT_CATEGORIES.map((category) => [category, 0]),
	) as Record<CanvasFontCategory, number>;
	for (const entry of entries) counts[entry.category] += 1;
	return counts;
}

/**
 * THE LICENCE GATE. `cp2-001` deliberately left `license` an open `string` so a
 * host can record a real `LicenseRef-…`, and recorded that "the *default*
 * catalog is restricted to open licences and `cp2-002` enforces that set by
 * test". This describe block is that enforcement. It runs over the shipped
 * entry list, not over a fixture, because a fixture would pass while the real
 * catalog carried a proprietary face.
 */
describe("default catalog licensing", () => {
	it("carries only OFL-1.1, Apache-2.0 or CC0-1.0 — no entry may ship any other licence", () => {
		const allowed = new Set<string>(OPEN_FONT_LICENSES);
		const offenders = entries
			.filter((entry) => !allowed.has(entry.license))
			.map((entry) => `${entry.family} (${entry.license})`);

		expect(offenders).toEqual([]);
	});

	it("records a licence and a provenance URL on every single entry", () => {
		for (const entry of entries) {
			expect(entry.license, entry.family).toBeTruthy();
			expect(entry.upstreamUrl, entry.family).toMatch(
				/^https:\/\/fonts\.google\.com\/specimen\/[A-Za-z0-9+]+$/,
			);
		}
	});

	it("pins the two licences actually in use, so a bulk edit cannot relabel a family", () => {
		// Transcribed from each family's directory in the `google/fonts`
		// repository, where the top-level directory IS the licence: every family
		// here resolves under `ofl/` except Roboto Slab, which resolves under
		// `apache/` (and has no `ofl/robotoslab/OFL.txt`).
		expect(DEFAULT_FONT_CATALOG.get("Roboto Slab")?.license).toBe("Apache-2.0");
		expect(DEFAULT_FONT_CATALOG.get("Inter")?.license).toBe("OFL-1.1");

		const apacheFamilies = entries
			.filter((entry) => entry.license === "Apache-2.0")
			.map((entry) => entry.family);
		expect(apacheFamilies).toEqual(["Roboto Slab"]);
	});

	it("ships no Ubuntu-licensed family — UFL-1.0 is not in the allowed set", () => {
		expect(OPEN_FONT_LICENSES).not.toContain("UFL-1.0");
		expect(DEFAULT_FONT_CATALOG.get("Ubuntu")).toBeUndefined();
		expect(DEFAULT_FONT_CATALOG.get("Ubuntu Mono")).toBeUndefined();
	});
});

describe("default catalog shape", () => {
	it("stamps every entry `default` — the lowest tier, so host and brand override it", () => {
		expect(DEFAULT_FONT_CATALOG.entries).toHaveLength(entries.length);
		for (const record of DEFAULT_FONT_CATALOG.entries) {
			expect(record.origin, record.family).toBe("default");
		}
	});

	it("holds no duplicate family, by the catalog's own case-insensitive identity", () => {
		const keys = entries.map((entry) => fontFamilyKey(entry.family));

		expect(new Set(keys).size).toBe(keys.length);
		// A duplicate would silently vanish rather than fail: `createFontCatalog`
		// resolves duplicates to the last entry, so the catalog would simply be
		// shorter than the list it was built from.
		expect(DEFAULT_FONT_CATALOG.entries).toHaveLength(entries.length);
	});

	it("names every family in a form the picker can show and CSS can match", () => {
		for (const entry of entries) {
			expect(entry.family, entry.family).toBe(entry.family.trim());
			expect(entry.family.length, entry.family).toBeGreaterThan(0);
			expect(fontFamilyKey(entry.family), entry.family).not.toContain('"');
		}
	});
});

describe("category coverage", () => {
	it("meets the `cp2-002` target of ~30 families across all six categories", () => {
		expect(entries.length).toBeGreaterThanOrEqual(30);
		expect(Object.keys(countByCategory()).sort()).toEqual(
			[...CANVAS_FONT_CATEGORIES].sort(),
		);
	});

	it("gives every category a usable choice, not a token single entry", () => {
		// A picker with 30 sans families and one serif is not a 30-family catalog
		// in any way a user experiences, so the floor is per-category.
		for (const [category, count] of Object.entries(countByCategory())) {
			expect(count, category).toBeGreaterThanOrEqual(4);
		}
	});

	it("locks the authored family count, which the module's size measurement cites", () => {
		// Not redundant with the `>= 30` floor above: the module doc records a
		// measured +1,714 B gzipped entry-chunk cost for exactly these 37 entries,
		// and every one of them carries a licence claim verified against upstream.
		// Changing the list must be a deliberate act that re-reads that note and
		// re-does that diligence, not a drive-by append that silently invalidates
		// both.
		expect(entries).toHaveLength(37);
		expect(countByCategory()).toEqual({
			sans: 9,
			serif: 7,
			slab: 5,
			mono: 6,
			display: 5,
			handwriting: 5,
		});
	});

	it("covers CJK for real, and says so in the entry rather than in prose", () => {
		const subsetsOf = (family: string) =>
			DEFAULT_FONT_CATALOG.get(family)?.subsets ?? [];

		expect(subsetsOf("Noto Sans JP")).toContain("japanese");
		expect(subsetsOf("Noto Serif JP")).toContain("japanese");
		expect(subsetsOf("Noto Sans SC")).toContain("chinese-simplified");
		expect(subsetsOf("Noto Sans KR")).toContain("korean");
		// Both a sans and a serif CJK cut, so a CJK document is not forced into
		// one voice.
		expect(DEFAULT_FONT_CATALOG.get("Noto Sans JP")?.category).toBe("sans");
		expect(DEFAULT_FONT_CATALOG.get("Noto Serif JP")?.category).toBe("serif");
	});

	it("promises no script coverage it has not recorded", () => {
		for (const entry of entries) {
			expect(entry.subsets.length, entry.family).toBeGreaterThan(0);
			// Latin is the floor for every family here; anything else is declared.
			expect(entry.subsets, entry.family).toContain("latin");
			expect(new Set(entry.subsets).size, entry.family).toBe(
				entry.subsets.length,
			);
			// Google's synthetic `menu` subset is a specimen artefact, not script
			// coverage, and must never reach a consumer reading `subsets`.
			expect(entry.subsets, entry.family).not.toContain("menu");
		}
	});
});

describe("weights", () => {
	it("declares at least one weight per family, static or variable", () => {
		for (const entry of entries) {
			expect(entry.weights.length, entry.family).toBeGreaterThan(0);
		}
	});

	it("produces a valid CSS `font-weight` for every declared weight", () => {
		for (const entry of entries) {
			for (const weight of entry.weights) {
				// `400` or `100 900` — the two forms `SvgFontFaceDef.weight` accepts.
				expect(fontWeightCss(weight), entry.family).toMatch(
					/^[1-9]\d{2}( [1-9]\d{2})?$/,
				);
				if (typeof weight === "number") {
					expect(weight, entry.family).toBeGreaterThanOrEqual(100);
					expect(weight, entry.family).toBeLessThanOrEqual(1000);
				} else {
					expect(weight.min, entry.family).toBeLessThan(weight.max);
				}
			}
		}
	});

	it("records a variable family as one axis rather than as enumerated cuts", () => {
		expect(DEFAULT_FONT_CATALOG.get("Inter")?.weights).toEqual([
			{ min: 100, max: 900 },
		]);
		// …and a static family as its real discrete cuts.
		expect(DEFAULT_FONT_CATALOG.get("Space Mono")?.weights).toEqual([400, 700]);
		expect(DEFAULT_FONT_CATALOG.get("Anton")?.weights).toEqual([400]);
	});
});

describe("metadata-only sources", () => {
	it("ships a CSS URL and NO font bytes — the whole point of the default tier", () => {
		for (const entry of entries) {
			expect(entry.source.kind, entry.family).toBe("css");
			// `cp2-002`'s deliverable: no font bytes in the eager bundle. An entry
			// that grew a `files` array would be embedding binaries in a package
			// with a 400 KB budget.
			expect(entry.source.files, entry.family).toBeUndefined();
		}
	});

	it("points every family at an https Google Fonts CSS2 stylesheet naming it", () => {
		for (const entry of entries) {
			const css = entry.source.kind === "css" ? entry.source.css : "";
			const url = new URL(css);

			expect(url.protocol, entry.family).toBe("https:");
			expect(url.host, entry.family).toBe("fonts.googleapis.com");
			expect(url.pathname, entry.family).toBe("/css2");
			expect(url.searchParams.get("display"), entry.family).toBe("swap");
			// `family=Inter:ital,wght@…` — the spec must actually name this family.
			expect(url.searchParams.get("family")?.split(":")[0], entry.family).toBe(
				entry.family,
			);
		}
	});

	it("asks for exactly the weights it advertises", () => {
		const specOf = (family: string) => {
			const record = DEFAULT_FONT_CATALOG.get(family);
			const css = record?.source.kind === "css" ? record.source.css : "";
			return new URL(css).searchParams.get("family") ?? "";
		};

		// Variable: one range, requested as a CSS2 axis range.
		expect(specOf("Inter")).toBe("Inter:ital,wght@0,100..900;1,100..900");
		// Static, no italic cut: the discrete list only.
		expect(specOf("Kalam")).toBe("Kalam:wght@300;400;700");
		// Variable, no italic cut: no `ital` tuple at all.
		expect(specOf("Noto Sans JP")).toBe("Noto Sans JP:wght@100..900");
	});
});

/**
 * `cp2-001`'s acceptance criterion was that the contract "expresses everything
 * `cp2-006` needs to build an `SvgFontFaceDef` without a second lookup". It
 * asserted that at the type level; this asserts it against the real entries.
 */
describe("cp2-006 handoff over the real catalog", () => {
	it("resolves a document's family to a record with one case-insensitive get", () => {
		// A document spells the family however its author typed it; core's manifest
		// Map is case-SENSITIVE, so the def keeps the document's spelling while the
		// lookup does not care. See the mapping note in `../font-catalog.ts`.
		expect(DEFAULT_FONT_CATALOG.get("inter")?.family).toBe("Inter");
		expect(DEFAULT_FONT_CATALOG.get("  IBM PLEX MONO ")?.family).toBe(
			"IBM Plex Mono",
		);
	});

	it("skips every default family at export, because none carries embeddable bytes", () => {
		// The honest consequence of a metadata-only catalog, asserted rather than
		// left to be discovered: `cp2-006` reads `source.files ?? []`, finds
		// nothing, and lets core's existing FONT_NOT_IN_MANIFEST warning stand.
		const embeddable = entries.filter(
			(entry) => (entry.source.files ?? []).length > 0,
		);

		expect(embeddable).toEqual([]);
	});

	it("builds a complete `SvgFontFaceDef` the moment a host supplies files", () => {
		// The mapping itself, exercised against a real catalog record: only
		// `source.files` is supplied, everything else comes off the shipped entry.
		const record = DEFAULT_FONT_CATALOG.get("inter");
		expect(record).toBeDefined();
		if (!record) return;

		const file: CanvasFontFile = {
			url: "/fonts/inter-var.woff2",
			format: "woff2",
			weight: record.weights[0] ?? 400,
			style: "normal",
		};
		const def: SvgFontFaceDef = {
			family: "inter",
			src: fontFaceSrc(file),
			weight: fontWeightCss(file.weight),
			style: file.style ?? "normal",
		};

		expect(def).toEqual({
			family: "inter",
			src: 'url("/fonts/inter-var.woff2") format("woff2")',
			weight: "100 900",
			style: "normal",
		});
	});
});

describe("merging the default catalog", () => {
	const hostInter = createFontCatalog(
		[
			{
				family: "inter",
				category: "sans",
				weights: [400],
				source: {
					kind: "files",
					files: [{ url: "/fonts/inter.woff2", weight: 400 }],
				},
				license: "LicenseRef-Acme-Foundry-EULA",
			},
		],
		{ origin: "host" },
	);

	it("lets a host replace a default family outright, licence and all", () => {
		const merged = mergeCatalogs(DEFAULT_FONT_CATALOG, hostInter);
		const winner = merged.get("Inter");

		expect(winner?.origin).toBe("host");
		expect(winner?.license).toBe("LicenseRef-Acme-Foundry-EULA");
		expect(winner?.source.kind).toBe("files");
		// Whole-entry replacement: the host entry declares no `subsets`, and must
		// NOT inherit the default's — nor, far more importantly, its OFL licence.
		expect(winner?.subsets).toBeUndefined();
		expect(merged.entries).toHaveLength(entries.length);
	});

	it("keeps the default catalog's precedence regardless of argument order", () => {
		const forwards = mergeCatalogs(DEFAULT_FONT_CATALOG, hostInter);
		const backwards = mergeCatalogs(hostInter, DEFAULT_FONT_CATALOG);

		expect(backwards.get("Inter")?.origin).toBe("host");
		expect(backwards.get("Inter")?.license).toBe(
			forwards.get("Inter")?.license,
		);
		// Every family the host did not name still comes from the default tier.
		expect(backwards.get("Lora")?.origin).toBe("default");
	});

	it("sorts host entries ahead of the whole default tier", () => {
		const merged = mergeCatalogs(DEFAULT_FONT_CATALOG, hostInter);

		expect(merged.entries[0]?.origin).toBe("host");
		expect(
			merged.entries.slice(1).every((record) => record.origin === "default"),
		).toBe(true);
	});

	it("survives an absent host prop with no filtering at the call site", () => {
		const merged = mergeCatalogs(DEFAULT_FONT_CATALOG, undefined);

		expect(merged.entries).toHaveLength(entries.length);
		expect(merged.get("Inter")?.origin).toBe("default");
	});
});
