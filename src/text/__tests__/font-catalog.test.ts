import type { SvgFontFaceDef } from "@anvilkit/canvas-core";
import { describe, expect, it } from "vitest";
import {
	CANVAS_FONT_CATEGORIES,
	type CanvasFontCatalogEntry,
	createFontCatalog,
	fontFaceSrc,
	fontFamilyKey,
	fontWeightCss,
	mergeCatalogs,
} from "../font-catalog.js";

function entry(
	family: string,
	overrides: Partial<CanvasFontCatalogEntry> = {},
): CanvasFontCatalogEntry {
	return {
		family,
		category: "sans",
		weights: [400],
		source: { kind: "css", css: `https://fonts.example/${family}.css` },
		license: "OFL-1.1",
		...overrides,
	};
}

describe("fontFamilyKey", () => {
	it("is case-insensitive and trimmed, matching core's brand-token comparison", () => {
		expect(fontFamilyKey("  Inter ")).toBe("inter");
		expect(fontFamilyKey("INTER")).toBe(fontFamilyKey("inter"));
	});
});

describe("createFontCatalog", () => {
	it("stamps the `host` tier by default", () => {
		const catalog = createFontCatalog([entry("Inter")]);

		expect(catalog.entries).toHaveLength(1);
		expect(catalog.entries[0]?.origin).toBe("host");
	});

	it("stamps the requested tier on every entry", () => {
		const catalog = createFontCatalog([entry("Inter"), entry("Lora")], {
			origin: "default",
		});

		expect(catalog.entries.map((e) => e.origin)).toEqual([
			"default",
			"default",
		]);
	});

	it("looks a family up case-insensitively without scanning", () => {
		const catalog = createFontCatalog([entry("Noto Sans JP")]);

		expect(catalog.get("noto sans jp")?.family).toBe("Noto Sans JP");
		expect(catalog.get("  NOTO SANS JP  ")?.family).toBe("Noto Sans JP");
		expect(catalog.get("Missing Family")).toBeUndefined();
	});

	it("preserves weights and subsets verbatim, including a variable axis", () => {
		const catalog = createFontCatalog([
			entry("Inter", {
				weights: [{ min: 100, max: 900 }],
				subsets: ["latin", "latin-ext", "cyrillic"],
				italic: true,
			}),
		]);

		const stored = catalog.get("Inter");
		expect(stored?.weights).toEqual([{ min: 100, max: 900 }]);
		expect(stored?.subsets).toEqual(["latin", "latin-ext", "cyrillic"]);
		expect(stored?.italic).toBe(true);
	});

	it("resolves a duplicate family inside one call to the last entry", () => {
		const catalog = createFontCatalog([
			entry("Inter", { license: "OFL-1.1" }),
			entry("Inter", { license: "Apache-2.0" }),
		]);

		expect(catalog.entries).toHaveLength(1);
		expect(catalog.get("Inter")?.license).toBe("Apache-2.0");
	});
});

describe("mergeCatalogs precedence", () => {
	const defaults = createFontCatalog(
		[entry("Inter", { license: "OFL-1.1", subsets: ["latin"] })],
		{ origin: "default" },
	);
	const host = createFontCatalog(
		[entry("Inter", { license: "Apache-2.0", subsets: ["latin", "greek"] })],
		{ origin: "host" },
	);
	const brand = createFontCatalog(
		[
			entry("Inter", {
				license: "LicenseRef-Acme-Foundry-EULA",
				source: {
					kind: "files",
					files: [{ url: "/fonts/acme-inter.woff2", weight: 400 }],
				},
			}),
		],
		{ origin: "brand" },
	);

	it("resolves a duplicate family to the highest-precedence entry (brand > host > default)", () => {
		const merged = mergeCatalogs(defaults, host, brand);

		expect(merged.entries).toHaveLength(1);
		expect(merged.get("Inter")?.origin).toBe("brand");
		expect(merged.get("Inter")?.license).toBe("LicenseRef-Acme-Foundry-EULA");
	});

	it("ignores argument order — precedence rides on the entry, not the call site", () => {
		const forwards = mergeCatalogs(defaults, host, brand);
		const backwards = mergeCatalogs(brand, host, defaults);
		const shuffled = mergeCatalogs(host, defaults, brand);

		for (const merged of [forwards, backwards, shuffled]) {
			expect(merged.get("Inter")?.origin).toBe("brand");
			expect(merged.get("Inter")?.license).toBe("LicenseRef-Acme-Foundry-EULA");
		}
	});

	it("host beats default when no brand entry exists", () => {
		const merged = mergeCatalogs(host, defaults);

		expect(merged.get("Inter")?.origin).toBe("host");
		expect(merged.get("Inter")?.license).toBe("Apache-2.0");
	});

	it("replaces the WHOLE entry rather than merging fields — a winner never inherits a loser's licence or source", () => {
		const merged = mergeCatalogs(defaults, host, brand);
		const winner = merged.get("Inter");

		// The brand entry declares no `subsets`; if merge were field-level it
		// would silently inherit the default's `["latin"]` and, far worse, a
		// licence nobody asserted for those bytes.
		expect(winner?.subsets).toBeUndefined();
		expect(winner?.source).toEqual({
			kind: "files",
			files: [{ url: "/fonts/acme-inter.woff2", weight: 400 }],
		});
		expect(winner?.license).not.toBe("OFL-1.1");
	});

	it("stays associative — a merged catalog keeps every entry's own tier", () => {
		const nested = mergeCatalogs(mergeCatalogs(defaults, brand), host);
		const flat = mergeCatalogs(defaults, host, brand);

		expect(nested.get("Inter")?.origin).toBe(flat.get("Inter")?.origin);
		expect(nested.get("Inter")?.license).toBe(flat.get("Inter")?.license);
	});

	it("orders entries by descending precedence so the picker can pin brand first", () => {
		const merged = mergeCatalogs(
			createFontCatalog([entry("Lora")], { origin: "default" }),
			createFontCatalog([entry("Roboto Mono")], { origin: "host" }),
			createFontCatalog([entry("Acme Grotesk")], { origin: "brand" }),
		);

		expect(merged.entries.map((e) => e.family)).toEqual([
			"Acme Grotesk",
			"Roboto Mono",
			"Lora",
		]);
	});

	it("breaks an equal-tier tie with the last catalog", () => {
		const first = createFontCatalog([entry("Inter", { license: "OFL-1.1" })]);
		const second = createFontCatalog([
			entry("Inter", { license: "Apache-2.0" }),
		]);

		expect(mergeCatalogs(first, second).get("Inter")?.license).toBe(
			"Apache-2.0",
		);
		expect(mergeCatalogs(second, first).get("Inter")?.license).toBe("OFL-1.1");
	});

	it("skips `undefined` inputs so an optional host prop needs no filtering", () => {
		const merged = mergeCatalogs(defaults, undefined);

		expect(merged.entries).toHaveLength(1);
		expect(merged.get("Inter")?.origin).toBe("default");
	});

	it("keeps non-duplicate families from every tier", () => {
		const merged = mergeCatalogs(
			createFontCatalog([entry("Inter"), entry("Lora")], {
				origin: "default",
			}),
			createFontCatalog([entry("Space Mono")], { origin: "host" }),
		);

		expect(merged.entries.map((e) => e.family).sort()).toEqual([
			"Inter",
			"Lora",
			"Space Mono",
		]);
	});
});

describe("CSS value helpers", () => {
	it("formats a static weight and a variable axis", () => {
		expect(fontWeightCss(400)).toBe("400");
		expect(fontWeightCss({ min: 100, max: 900 })).toBe("100 900");
	});

	it("emits a `format()` hint only when the file declares one", () => {
		expect(
			fontFaceSrc({ url: "/f/inter.woff2", format: "woff2", weight: 400 }),
		).toBe('url("/f/inter.woff2") format("woff2")');
		expect(fontFaceSrc({ url: "/f/inter.ttf", weight: 400 })).toBe(
			'url("/f/inter.ttf")',
		);
	});

	it("escapes quotes and backslashes so a URL cannot break out of `url()`", () => {
		expect(fontFaceSrc({ url: '/f/a").evil("', weight: 400 })).toBe(
			'url("/f/a\\").evil(\\"")',
		);
		expect(fontFaceSrc({ url: "/f/a\\b.woff2", weight: 400 })).toBe(
			'url("/f/a\\\\b.woff2")',
		);
	});
});

describe("cp2-006 handoff: catalog entry → SvgFontFaceDef", () => {
	it("builds a complete manifest def from one record, with no second lookup", () => {
		const catalog = createFontCatalog(
			[
				entry("Inter", {
					weights: [{ min: 100, max: 900 }],
					source: {
						kind: "css",
						css: "https://fonts.example/inter.css",
						files: [
							{
								url: "https://fonts.example/inter-var.woff2",
								format: "woff2",
								weight: { min: 100, max: 900 },
								style: "normal",
							},
						],
					},
				}),
			],
			{ origin: "default" },
		);

		// Exactly what `cp2-006` will do: the family string as the DOCUMENT
		// spells it (core's manifest Map is case-sensitive), everything else off
		// the record it already has.
		const usedFamily = "inter";
		const record = catalog.get(usedFamily);
		const file = record?.source.files?.[0];
		expect(record).toBeDefined();
		expect(file).toBeDefined();
		if (!record || !file) return;

		const def: SvgFontFaceDef = {
			family: usedFamily,
			src: fontFaceSrc(file),
			weight: fontWeightCss(file.weight),
			style: file.style ?? "normal",
		};

		expect(def).toEqual({
			family: "inter",
			src: 'url("https://fonts.example/inter-var.woff2") format("woff2")',
			weight: "100 900",
			style: "normal",
		});
	});

	it("reads `files` off either source variant without narrowing", () => {
		const cssOnly = entry("Metadata Only");
		const withFiles = entry("Bundled", {
			source: {
				kind: "files",
				files: [{ url: "/f/bundled.woff2", weight: 700, style: "italic" }],
			},
		});

		// A metadata-only entry has nothing to embed — `cp2-006` skips it and
		// lets core's existing FONT_NOT_IN_MANIFEST warning stand.
		expect(cssOnly.source.files ?? []).toEqual([]);
		expect(withFiles.source.files ?? []).toHaveLength(1);
	});
});

describe("licence requirement", () => {
	it("keeps the SPDX id it was given, including a private LicenseRef", () => {
		const catalog = createFontCatalog([
			entry("Acme Grotesk", { license: "LicenseRef-Acme-Foundry-EULA" }),
		]);

		expect(catalog.get("Acme Grotesk")?.license).toBe(
			"LicenseRef-Acme-Foundry-EULA",
		);
	});

	it("does not accept an entry without a licence", () => {
		// DOCUMENTATION, NOT ENFORCEMENT: this package's tsconfig.json excludes
		// `src/**/__tests__/**`, so `pnpm typecheck` never reads this directive.
		// The enforced version is `CanvasFontCatalogInvariants` in
		// `../font-catalog.ts`, which `tsc --noEmit` does read — flipping
		// `license` to optional fails typecheck there.
		// @ts-expect-error `license` is required at the type level.
		const missingLicence: CanvasFontCatalogEntry = {
			family: "Unlicensed",
			category: "display",
			weights: [400],
			source: { kind: "css", css: "https://fonts.example/unlicensed.css" },
		};

		expect(createFontCatalog([missingLicence]).entries).toHaveLength(1);
	});
});

describe("CANVAS_FONT_CATEGORIES", () => {
	it("lists all six categories exactly once", () => {
		expect(CANVAS_FONT_CATEGORIES).toEqual([
			"sans",
			"serif",
			"slab",
			"mono",
			"display",
			"handwriting",
		]);
		expect(new Set(CANVAS_FONT_CATEGORIES).size).toBe(
			CANVAS_FONT_CATEGORIES.length,
		);
	});
});
