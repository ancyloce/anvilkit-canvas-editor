import type { BrandTokenRef, CanvasGradientFill } from "@anvilkit/canvas-core";
import { describe, expect, it } from "vitest";
import type { BrandKit } from "../brand-kit.js";
import {
	resolveBrandToken,
	resolveFillForDisplay,
	resolveFontFamilyForDisplay,
} from "../resolve-brand-token.js";

function colorToken(id: string): BrandTokenRef {
	return { type: "brand-token", tokenType: "color", id };
}

function fontToken(id: string): BrandTokenRef {
	return { type: "brand-token", tokenType: "font", id };
}

const kit: BrandKit = {
	colors: [
		{ id: "brand.primary", name: "Primary", value: "#2563eb" },
		// No explicit id — must resolve via a slug of `name`.
		{ name: "Warm Accent!", value: "#f59e0b" },
	],
	fonts: ["Inter", "IBM Plex Mono"],
};

describe("resolveBrandToken", () => {
	it("resolves a color token by its explicit id", () => {
		expect(resolveBrandToken(colorToken("brand.primary"), kit)).toBe("#2563eb");
	});

	it("resolves a color token by a slug of the color's name when no id is set", () => {
		expect(resolveBrandToken(colorToken("warm-accent"), kit)).toBe("#f59e0b");
	});

	it("returns undefined for a color id with no match", () => {
		expect(
			resolveBrandToken(colorToken("does-not-exist"), kit),
		).toBeUndefined();
	});

	it("resolves a font token by a slug of the font-family string", () => {
		expect(resolveBrandToken(fontToken("ibm-plex-mono"), kit)).toBe(
			"IBM Plex Mono",
		);
	});

	it("returns undefined for a font id with no match", () => {
		expect(resolveBrandToken(fontToken("nope"), kit)).toBeUndefined();
	});

	it.each([
		"spacing",
		"asset",
		"logo",
	] as const)("returns undefined for tokenType %s (no BrandKit shape yet)", (tokenType) => {
		expect(
			resolveBrandToken({ type: "brand-token", tokenType, id: "x" }, kit),
		).toBeUndefined();
	});

	it("never throws for an empty brand kit", () => {
		const empty: BrandKit = { colors: [], fonts: [] };
		expect(() => resolveBrandToken(colorToken("x"), empty)).not.toThrow();
		expect(resolveBrandToken(colorToken("x"), empty)).toBeUndefined();
	});
});

describe("resolveFillForDisplay", () => {
	it("passes an absent fill through unchanged", () => {
		expect(resolveFillForDisplay(undefined, kit)).toEqual({
			value: undefined,
			unresolved: false,
		});
	});

	it("passes a plain color string through unchanged", () => {
		expect(resolveFillForDisplay("#000000", kit)).toEqual({
			value: "#000000",
			unresolved: false,
		});
	});

	it("passes a gradient through unchanged (never mistaken for a token)", () => {
		const gradient: CanvasGradientFill = {
			kind: "linear",
			stops: [
				{ offset: 0, color: "#000" },
				{ offset: 1, color: "#fff" },
			],
			from: { x: 0, y: 0 },
			to: { x: 1, y: 1 },
		};
		expect(resolveFillForDisplay(gradient, kit)).toEqual({
			value: gradient,
			unresolved: false,
		});
	});

	it("resolves a color token to its value", () => {
		expect(resolveFillForDisplay(colorToken("brand.primary"), kit)).toEqual({
			value: "#2563eb",
			unresolved: false,
		});
	});

	it("degrades an unresolved token to undefined with unresolved: true", () => {
		expect(resolveFillForDisplay(colorToken("nope"), kit)).toEqual({
			value: undefined,
			unresolved: true,
		});
	});
});

describe("resolveFontFamilyForDisplay", () => {
	it("passes a plain string through unchanged", () => {
		expect(resolveFontFamilyForDisplay("Georgia", kit)).toEqual({
			value: "Georgia",
			unresolved: false,
		});
	});

	it("resolves a font token to its family string", () => {
		expect(resolveFontFamilyForDisplay(fontToken("inter"), kit)).toEqual({
			value: "Inter",
			unresolved: false,
		});
	});

	it("degrades an unresolved token to undefined with unresolved: true", () => {
		expect(resolveFontFamilyForDisplay(fontToken("nope"), kit)).toEqual({
			value: undefined,
			unresolved: true,
		});
	});
});
