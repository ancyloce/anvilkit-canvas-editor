import type {
	BrandAsset,
	BrandRule,
	BrandTypographyPreset,
} from "@anvilkit/canvas-core";
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import {
	CanvasStudioContext,
	type CanvasStudioContextValue,
} from "@/context/canvas-studio-context.js";
import { makeHarness } from "@/tools/__tests__/_tool-test-helpers.js";
import {
	type BrandColor,
	type BrandKit,
	EMPTY_BRAND_KIT,
} from "../brand-kit.js";
import {
	useBrandColors,
	useBrandFonts,
	useBrandKit,
	useBrandLogos,
	useBrandRules,
	useBrandTypography,
} from "../use-brand-kit.js";

afterEach(cleanup);

interface Captured {
	kit: BrandKit;
	colors: readonly BrandColor[];
	fonts: readonly string[];
	logos: readonly BrandAsset[];
	typography: readonly BrandTypographyPreset[];
	rules: readonly BrandRule[];
}

function mount(brandKit?: BrandKit): Captured {
	const h = makeHarness();
	const ctx: CanvasStudioContextValue = brandKit
		? { ...h.studioCtx, brandKit }
		: h.studioCtx;
	const captured = {} as Captured;
	function Probe(): null {
		captured.kit = useBrandKit();
		captured.colors = useBrandColors();
		captured.fonts = useBrandFonts();
		captured.logos = useBrandLogos();
		captured.typography = useBrandTypography();
		captured.rules = useBrandRules();
		return null;
	}
	render(
		<CanvasStudioContext.Provider value={ctx}>
			<Probe />
		</CanvasStudioContext.Provider>,
	);
	return captured;
}

describe("useBrandKit", () => {
	it("returns the stable EMPTY_BRAND_KIT when the host configures no kit", () => {
		const out = mount();
		expect(out.kit).toBe(EMPTY_BRAND_KIT);
		expect(out.colors).toEqual([]);
		expect(out.fonts).toEqual([]);
		expect(out.logos).toEqual([]);
		expect(out.typography).toEqual([]);
		expect(out.rules).toEqual([]);
	});

	it("useBrandLogos/Typography/Rules default to empty when a kit omits them", () => {
		const brandKit: BrandKit = { colors: [], fonts: [] };
		const out = mount(brandKit);
		expect(out.logos).toEqual([]);
		expect(out.typography).toEqual([]);
		expect(out.rules).toEqual([]);
	});

	it("useBrandLogos/Typography/Rules project the kit's slices when present", () => {
		const brandKit: BrandKit = {
			colors: [],
			fonts: [],
			logos: [{ id: "logo1", name: "Wordmark", uri: "asset://logo1" }],
			typography: [{ id: "heading", name: "Heading", fontSize: 32 }],
			rules: [{ id: "r1", kind: "forbidden-color", value: "#ff0000" }],
		};
		const out = mount(brandKit);
		expect(out.logos).toEqual(brandKit.logos);
		expect(out.typography).toEqual(brandKit.typography);
		expect(out.rules).toEqual(brandKit.rules);
	});

	it("returns the host-provided brand kit", () => {
		const brandKit: BrandKit = {
			colors: [
				{ name: "Primary", value: "#2563eb" },
				{ name: "Accent", value: "var(--brand)" },
			],
			fonts: ["Inter", "Poppins"],
		};
		const out = mount(brandKit);
		expect(out.kit).toBe(brandKit);
	});

	it("useBrandColors / useBrandFonts project the kit's slices", () => {
		const brandKit: BrandKit = {
			colors: [{ name: "Primary", value: "#2563eb" }],
			fonts: ["Inter", "Poppins"],
		};
		const out = mount(brandKit);
		expect(out.colors).toEqual([{ name: "Primary", value: "#2563eb" }]);
		expect(out.fonts).toEqual(["Inter", "Poppins"]);
		// First font is the brand default.
		expect(out.fonts[0]).toBe("Inter");
	});
});
