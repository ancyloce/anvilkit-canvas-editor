// @vitest-environment node
// Pure logic test — the blur maths and the cache-invalidation key.
import type { CanvasEffect } from "@anvilkit/canvas-core";
import { describe, expect, it } from "vitest";
import {
	blurCachePadding,
	localRenderingKey,
	nodeBlurRadius,
} from "../node-blur.js";

const SHADOW = {
	type: "drop-shadow",
	color: "#000000",
	blur: 6,
	offsetX: 4,
	offsetY: 8,
} satisfies CanvasEffect;

describe("nodeBlurRadius", () => {
	it("is zero when the node carries no blur", () => {
		expect(nodeBlurRadius([])).toBe(0);
		expect(nodeBlurRadius([SHADOW])).toBe(0);
	});

	it("passes a single blur through unchanged", () => {
		expect(nodeBlurRadius([{ type: "blur", radius: 8 }])).toBe(8);
	});

	it("combines multiple blurs in QUADRATURE, as the serializer does", () => {
		// Two 5s are ~7.07, not 10 — convolving Gaussians adds variances (C-18).
		// Summing radii here would over-blur the canvas relative to the export.
		expect(
			nodeBlurRadius([
				{ type: "blur", radius: 5 },
				{ type: "blur", radius: 5 },
			]),
		).toBeCloseTo(Math.SQRT2 * 5, 10);
		expect(
			nodeBlurRadius([
				{ type: "blur", radius: 3 },
				{ type: "blur", radius: 4 },
			]),
		).toBeCloseTo(5, 10);
	});

	it("ignores non-positive and non-finite radii rather than poisoning the sum", () => {
		expect(
			nodeBlurRadius([
				{ type: "blur", radius: 0 },
				{ type: "blur", radius: -4 },
				{ type: "blur", radius: Number.NaN },
			]),
		).toBe(0);
	});
});

describe("blurCachePadding", () => {
	it("reserves bleed room for the blur kernel itself", () => {
		// Without this the kernel samples transparent pixels past the bitmap edge
		// and the blur is cut off square instead of fading (the K-7 item 3 trap).
		expect(blurCachePadding(8, [])).toBe(8);
	});

	it("also reserves room for ghost shadows, which getClientRect cannot see", () => {
		// offset 8 (the larger axis) + blur 6 + spread 3 = 17, plus the blur's 4.
		expect(blurCachePadding(4, [{ ...SHADOW, spread: 3 }])).toBe(21);
	});

	it("takes the FURTHEST-reaching shadow of a stack", () => {
		const near = { ...SHADOW, offsetX: 1, offsetY: 1, blur: 1 };
		const far = { ...SHADOW, offsetX: 20, offsetY: 0, blur: 10 };
		expect(blurCachePadding(2, [near, far])).toBe(32);
	});

	it("rounds up, because a cache offset is whole pixels", () => {
		expect(blurCachePadding(4.2, [])).toBe(5);
	});
});

describe("localRenderingKey", () => {
	it("ignores transform — a move cannot invalidate a locally-rasterised bitmap", () => {
		const base = { id: "n1", fill: "#fff", transform: { x: 0, y: 0 } };
		const moved = { id: "n1", fill: "#fff", transform: { x: 500, y: 120 } };
		expect(localRenderingKey(moved)).toBe(localRenderingKey(base));
	});

	it("changes when something that IS rasterised changes", () => {
		const base = { id: "n1", fill: "#fff", transform: { x: 0, y: 0 } };
		const recoloured = { id: "n1", fill: "#f00", transform: { x: 0, y: 0 } };
		expect(localRenderingKey(recoloured)).not.toBe(localRenderingKey(base));
	});

	it("changes when external paint state changes without an IR edit", () => {
		const node = { id: "n1", fill: "#fff", transform: { x: 0, y: 0 } };
		expect(localRenderingKey(node, "brand:#f00")).not.toBe(
			localRenderingKey(node, "brand:#00f"),
		);
		expect(localRenderingKey(node, "font-manifest:1")).not.toBe(
			localRenderingKey(node, "font-manifest:2"),
		);
	});
});
