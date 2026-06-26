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
} from "../use-brand-kit.js";

afterEach(cleanup);

interface Captured {
	kit: BrandKit;
	colors: readonly BrandColor[];
	fonts: readonly string[];
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
