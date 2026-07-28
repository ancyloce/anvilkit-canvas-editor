import { describe, expect, it } from "vitest";

import { planResize } from "../resize-semantics.js";

const resolved = { width: 100, height: 50 };

describe("planResize", () => {
	it("passes a Fixed/Fixed node through untouched (no layoutItem write)", () => {
		const plan = planResize(undefined, resolved, { width: 120, height: 60 });
		expect(plan).toEqual({
			width: 120,
			height: 60,
			layoutItem: undefined,
			widthConverted: false,
			heightConverted: false,
		});
	});

	it("converts a resized Hug axis to Fixed at the gesture size", () => {
		const plan = planResize({ widthSizing: "hug" }, resolved, {
			width: 140,
			height: 50,
		});
		expect(plan.width).toBe(140);
		expect(plan.widthConverted).toBe(true);
		expect(plan.heightConverted).toBe(false);
		expect(plan.layoutItem).toEqual({ widthSizing: "fixed" });
	});

	it("converts a resized Fill axis to Fixed without touching the other axis mode", () => {
		const plan = planResize(
			{ widthSizing: "hug", heightSizing: "fill" },
			resolved,
			{ width: 100, height: 80 },
		);
		expect(plan.heightConverted).toBe(true);
		expect(plan.widthConverted).toBe(false);
		expect(plan.layoutItem).toEqual({
			widthSizing: "hug",
			heightSizing: "fixed",
		});
		// The untouched Hug axis keeps its resolved size.
		expect(plan.width).toBe(100);
	});

	it("keeps a Hug axis unconverted when its delta is within epsilon", () => {
		const plan = planResize({ widthSizing: "hug" }, resolved, {
			width: 100.4,
			height: 50,
		});
		expect(plan.widthConverted).toBe(false);
		expect(plan.layoutItem).toBeUndefined();
		expect(plan.width).toBe(100);
	});

	it("treats a delta exactly at epsilon as unchanged", () => {
		const plan = planResize(
			{ widthSizing: "fill" },
			resolved,
			{ width: 100.5, height: 50 },
			0.5,
		);
		expect(plan.widthConverted).toBe(false);
		expect(plan.layoutItem).toBeUndefined();
	});

	it("preserves positioning when converting", () => {
		const plan = planResize(
			{ positioning: "flow", widthSizing: "fill", heightSizing: "fill" },
			resolved,
			{ width: 150, height: 90 },
		);
		expect(plan.widthConverted).toBe(true);
		expect(plan.heightConverted).toBe(true);
		expect(plan.layoutItem).toEqual({
			positioning: "flow",
			widthSizing: "fixed",
			heightSizing: "fixed",
		});
	});

	it("a Fixed axis takes sub-epsilon deltas verbatim", () => {
		const plan = planResize(undefined, resolved, {
			width: 100.2,
			height: 50,
		});
		expect(plan.width).toBe(100.2);
		expect(plan.layoutItem).toBeUndefined();
	});
});
