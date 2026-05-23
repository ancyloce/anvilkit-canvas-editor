import { describe, expect, it } from "vitest";
import type { PenAnchor } from "../../stores/pen-store.js";
import { buildPathD, penBounds } from "../pen-geometry.js";

const anchor = (x: number, y: number, hx = x, hy = y): PenAnchor => ({
	x,
	y,
	hx,
	hy,
});

describe("buildPathD", () => {
	it("returns empty for no anchors", () => {
		expect(buildPathD([], false)).toBe("");
	});

	it("emits straight L segments when handles sit on their anchors", () => {
		const d = buildPathD([anchor(0, 0), anchor(10, 0)], false);
		expect(d).toBe("M 0 0 L 10 0");
	});

	it("emits a cubic C when the previous anchor has a pulled handle", () => {
		const d = buildPathD([anchor(0, 0, 5, 5), anchor(10, 0)], false);
		expect(d).toBe("M 0 0 C 5 5 10 0 10 0");
	});

	it("mirrors the next anchor's handle for the incoming control point", () => {
		// a1 outgoing handle (15,5) → incoming = mirror about (10,0) = (5,-5).
		const d = buildPathD([anchor(0, 0, 5, 5), anchor(10, 0, 15, 5)], false);
		expect(d).toBe("M 0 0 C 5 5 5 -5 10 0");
	});

	it("closes a straight polygon with just Z (no redundant L)", () => {
		const d = buildPathD([anchor(0, 0), anchor(10, 0), anchor(10, 10)], true);
		expect(d).toBe("M 0 0 L 10 0 L 10 10 Z");
	});

	it("emits a curved closing segment before Z when the last anchor has a handle", () => {
		const d = buildPathD(
			[anchor(0, 0), anchor(10, 0), anchor(10, 10, 12, 12)],
			true,
		);
		// a2's handle curves BOTH adjoining segments (symmetric handle): the
		// a1→a2 incoming = mirror(8,8) and the closing a2→a0 outgoing = (12,12).
		expect(d).toBe("M 0 0 L 10 0 C 10 0 8 8 10 10 C 12 12 0 0 0 0 Z");
	});

	it("translates coordinates by the offset", () => {
		const d = buildPathD([anchor(20, 30), anchor(40, 30)], false, 20, 30);
		expect(d).toBe("M 0 0 L 20 0");
	});
});

describe("penBounds", () => {
	it("returns a zero box for no anchors", () => {
		expect(penBounds([])).toEqual({ minX: 0, minY: 0, width: 0, height: 0 });
	});

	it("spans anchor points", () => {
		expect(penBounds([anchor(10, 20), anchor(40, 60)])).toEqual({
			minX: 10,
			minY: 20,
			width: 30,
			height: 40,
		});
	});

	it("includes outgoing and mirrored incoming handles", () => {
		// anchor at (50,50) with handle (70,50) → mirror (30,50) widens the box.
		expect(penBounds([anchor(50, 50, 70, 50)])).toEqual({
			minX: 30,
			minY: 50,
			width: 40,
			height: 0,
		});
	});
});
