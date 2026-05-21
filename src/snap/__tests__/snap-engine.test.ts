import { describe, expect, it } from "vitest";
import { computeSnap, DEFAULT_SNAP_THRESHOLD } from "../snap-engine.js";
import type { SnapRect } from "../snap-types.js";

describe("computeSnap — grid only", () => {
	it("snaps top-left to nearest grid line", () => {
		const result = computeSnap({
			candidate: { x: 5, y: 11, width: 20, height: 20 },
			others: [],
			gridSize: 8,
		});
		// 5 → 8 (delta +3); 11 → 8 (delta -3).
		expect(result.dx).toBe(3);
		expect(result.dy).toBe(-3);
		expect(result.guides).toEqual([]);
	});

	it("zero delta when already on grid", () => {
		const result = computeSnap({
			candidate: { x: 16, y: 24, width: 10, height: 10 },
			others: [],
			gridSize: 8,
		});
		expect(result.dx).toBe(0);
		expect(result.dy).toBe(0);
	});

	it("no grid snap when gridSize omitted or 0", () => {
		const a = computeSnap({
			candidate: { x: 5, y: 5, width: 1, height: 1 },
			others: [],
		});
		expect(a).toEqual({ dx: 0, dy: 0, guides: [] });
		const b = computeSnap({
			candidate: { x: 5, y: 5, width: 1, height: 1 },
			others: [],
			gridSize: 0,
		});
		expect(b).toEqual({ dx: 0, dy: 0, guides: [] });
	});
});

describe("computeSnap — edge snap to other nodes", () => {
	const big: SnapRect = { x: 100, y: 0, width: 5, height: 200 };

	it("snaps candidate left to other left within threshold", () => {
		const result = computeSnap({
			candidate: { x: 102, y: 50, width: 10, height: 10 },
			others: [big],
		});
		// candidate's left (102) - other's left (100) = 2 → dx = -2
		expect(result.dx).toBe(-2);
		expect(result.guides).toHaveLength(1);
		expect(result.guides[0]).toMatchObject({
			axis: "x",
			position: 100,
		});
	});

	it("no edge snap when distance exceeds threshold", () => {
		const result = computeSnap({
			candidate: { x: 200, y: 50, width: 10, height: 10 },
			others: [big],
			threshold: 5,
		});
		expect(result.dx).toBe(0);
		expect(result.guides).toEqual([]);
	});

	it("snaps both axes independently and emits two guides", () => {
		const result = computeSnap({
			candidate: { x: 51, y: 49, width: 10, height: 10 },
			others: [{ x: 50, y: 50, width: 20, height: 20 }],
		});
		// dx: candidate.left (51) - other.left (50) = 1 → dx -1
		// dy: candidate.top (49) - other.top (50) = -1 → dy +1
		expect(result.dx).toBe(-1);
		expect(result.dy).toBe(1);
		expect(result.guides).toHaveLength(2);
		expect(result.guides.map((g) => g.axis).sort()).toEqual(["x", "y"]);
	});

	it("picks the smallest delta when multiple matches exist", () => {
		const result = computeSnap({
			candidate: { x: 102, y: 50, width: 10, height: 10 },
			others: [
				{ x: 100, y: 0, width: 5, height: 200 }, // candidate.left - 100 = 2
				{ x: 101, y: 0, width: 5, height: 200 }, // candidate.left - 101 = 1
			],
		});
		// Closer one wins: snap to 101 with dx = -1.
		expect(result.dx).toBe(-1);
		expect(result.guides[0]?.position).toBe(101);
	});

	it("edge snap beats grid snap when both available", () => {
		const result = computeSnap({
			candidate: { x: 9, y: 500, width: 10, height: 10 },
			others: [{ x: 8, y: 0, width: 5, height: 5 }],
			gridSize: 8,
		});
		// Edge X: candidate.left (9) - other.left (8) = 1 → dx = -1 (with guide).
		// Y is far apart (no edge match) → grid: 500 / 8 = 62.5, rounds to 63
		// (Math.round 62.5 → 63), snapped 504, delta +4. No guide for grid.
		expect(result.dx).toBe(-1);
		expect(result.dy).toBe(4);
		expect(result.guides).toHaveLength(1);
		expect(result.guides[0]?.axis).toBe("x");
	});

	it("falls back to grid snap when no edge matches on an axis", () => {
		const result = computeSnap({
			candidate: { x: 5, y: 100, width: 10, height: 10 },
			others: [{ x: 200, y: 100, width: 5, height: 5 }],
			gridSize: 8,
			threshold: 4,
		});
		// X: no edge match (200 too far); grid snap 5 → 8, delta +3
		// Y: candidate.top (100) === other.top (100), delta 0
		expect(result.dx).toBe(3);
		expect(result.dy).toBe(0);
		// One guide for the Y match.
		expect(result.guides).toHaveLength(1);
		expect(result.guides[0]?.axis).toBe("y");
	});

	it("guide spans the union of candidate + target on the perpendicular axis", () => {
		const result = computeSnap({
			candidate: { x: 100, y: 50, width: 10, height: 10 },
			others: [{ x: 100, y: 200, width: 10, height: 20 }],
		});
		// Both rects share x=100. dx=0. Guide is vertical at x=100,
		// spanning y from candidate.top (50) to other.bottom (220).
		expect(result.guides).toHaveLength(1);
		const g = result.guides[0]!;
		expect(g.axis).toBe("x");
		expect(g.position).toBe(100);
		expect(g.from.y).toBe(50);
		expect(g.to.y).toBe(220);
	});
});

describe("computeSnap — default threshold", () => {
	it(`DEFAULT_SNAP_THRESHOLD is ${DEFAULT_SNAP_THRESHOLD}`, () => {
		expect(DEFAULT_SNAP_THRESHOLD).toBe(6);
	});
});
