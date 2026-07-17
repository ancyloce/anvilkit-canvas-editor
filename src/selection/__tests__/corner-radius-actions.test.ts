import { createEllipse, createFrame, createRect } from "@anvilkit/canvas-core";
import { describe, expect, it } from "vitest";
import {
	computeCornerRadiusDrag,
	isRoundable,
	maxCornerRadius,
} from "../corner-radius-actions.js";

describe("corner-radius drag geometry (FR-076)", () => {
	it("isRoundable is true for rect/frame, false otherwise", () => {
		expect(isRoundable(createRect({ bounds: { width: 10, height: 10 } }))).toBe(
			true,
		);
		expect(
			isRoundable(createFrame({ bounds: { width: 10, height: 10 } })),
		).toBe(true);
		expect(
			isRoundable(createEllipse({ bounds: { width: 10, height: 10 } })),
		).toBe(false);
	});

	it("maxCornerRadius is half the shorter side", () => {
		expect(maxCornerRadius({ bounds: { width: 200, height: 80 } })).toBe(40);
		expect(maxCornerRadius({ bounds: { width: 0, height: 0 } })).toBe(0);
	});

	it("drag averages the two axes and clamps to [0, max]", () => {
		// +10 / +10 → +10 from start.
		expect(computeCornerRadiusDrag(0, 10, 10, 40)).toBe(10);
		// Clamps at max.
		expect(computeCornerRadiusDrag(35, 20, 20, 40)).toBe(40);
		// Never negative.
		expect(computeCornerRadiusDrag(5, -20, -20, 40)).toBe(0);
		// Rounds.
		expect(computeCornerRadiusDrag(0, 3, 4, 40)).toBe(4);
	});
});
