import { describe, expect, it } from "vitest";

import type { FlowChildRect } from "../reorder.js";
import { computeInsertionIndex } from "../reorder.js";

function rect(id: string, min: number, max: number, cross = 0): FlowChildRect {
	return {
		id,
		footprint: { minX: min, minY: cross, maxX: max, maxY: cross + 10 },
	};
}

function vrect(id: string, min: number, max: number, cross = 0): FlowChildRect {
	return {
		id,
		footprint: { minX: cross, minY: min, maxX: cross + 10, maxY: max },
	};
}

describe("computeInsertionIndex", () => {
	// Midpoints: a=10, b=30, c=50.
	const horizontal = [rect("a", 0, 20), rect("b", 20, 40), rect("c", 40, 60)];

	it("inserts before the first child when the pointer precedes every midpoint", () => {
		expect(
			computeInsertionIndex(horizontal, "horizontal", { x: 5, y: 0 }),
		).toBe(0);
	});

	it("counts midpoints strictly before the pointer", () => {
		expect(
			computeInsertionIndex(horizontal, "horizontal", { x: 20, y: 0 }),
		).toBe(1);
		expect(
			computeInsertionIndex(horizontal, "horizontal", { x: 40, y: 0 }),
		).toBe(2);
	});

	it("appends when the pointer passes every midpoint", () => {
		expect(
			computeInsertionIndex(horizontal, "horizontal", { x: 60, y: 0 }),
		).toBe(3);
	});

	it("a pointer exactly on a midpoint inserts before that child", () => {
		expect(
			computeInsertionIndex(horizontal, "horizontal", { x: 30, y: 0 }),
		).toBe(1);
	});

	it("uses the y axis for vertical layouts and ignores x", () => {
		const vertical = [vrect("a", 0, 20), vrect("b", 20, 40)];
		expect(computeInsertionIndex(vertical, "vertical", { x: 999, y: 5 })).toBe(
			0,
		);
		expect(
			computeInsertionIndex(vertical, "vertical", { x: -999, y: 35 }),
		).toBe(2);
	});

	it("excludes dragged children from the slot count", () => {
		// Dragging "b": remaining midpoints are a=10, c=50.
		const exclude = new Set(["b"]);
		expect(
			computeInsertionIndex(horizontal, "horizontal", { x: 25, y: 0 }, exclude),
		).toBe(1);
		expect(
			computeInsertionIndex(horizontal, "horizontal", { x: 55, y: 0 }, exclude),
		).toBe(2);
		expect(
			computeInsertionIndex(horizontal, "horizontal", { x: 5, y: 0 }, exclude),
		).toBe(0);
	});

	it("returns 0 for an empty child list", () => {
		expect(computeInsertionIndex([], "horizontal", { x: 10, y: 10 })).toBe(0);
	});
});
