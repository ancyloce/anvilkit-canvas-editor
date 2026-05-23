import { describe, expect, it } from "vitest";
import {
	movePathControl,
	parsePathD,
	pathControlPoints,
	serializeParsedPath,
} from "../path-edit-geometry.js";

describe("parsePathD", () => {
	it("parses an M/L/Z polygon", () => {
		expect(parsePathD("M 0 0 L 10 0 L 10 10 Z")).toEqual({
			start: { x: 0, y: 0 },
			segs: [
				{ kind: "L", to: { x: 10, y: 0 } },
				{ kind: "L", to: { x: 10, y: 10 } },
			],
			closed: true,
		});
	});

	it("parses a cubic segment", () => {
		expect(parsePathD("M 0 0 C 5 5 5 -5 10 0")).toEqual({
			start: { x: 0, y: 0 },
			segs: [
				{
					kind: "C",
					c1: { x: 5, y: 5 },
					c2: { x: 5, y: -5 },
					to: { x: 10, y: 0 },
				},
			],
			closed: false,
		});
	});

	it("treats repeated coordinate pairs as implicit repeats", () => {
		const p = parsePathD("M 0 0 L 10 0 20 0");
		expect(p?.segs).toHaveLength(2);
		expect(p?.segs[1]).toEqual({ kind: "L", to: { x: 20, y: 0 } });
	});

	it("returns null for unsupported commands or empty input", () => {
		expect(parsePathD("M 0 0 H 10")).toBeNull();
		expect(parsePathD("m 0 0 l 1 1")).toBeNull();
		expect(parsePathD("")).toBeNull();
	});
});

describe("serializeParsedPath round-trips", () => {
	for (const d of [
		"M 0 0 L 10 0 L 10 10 Z",
		"M 0 0 C 5 5 5 -5 10 0",
		"M 2 3 L 4 5 C 6 7 8 9 10 11 Z",
	]) {
		it(`re-emits ${d}`, () => {
			const parsed = parsePathD(d);
			expect(parsed).not.toBeNull();
			if (parsed) expect(serializeParsedPath(parsed)).toBe(d);
		});
	}
});

describe("pathControlPoints", () => {
	it("lists anchors and controls in order with roles", () => {
		const p = parsePathD("M 0 0 C 5 5 5 -5 10 0");
		if (!p) throw new Error("parse failed");
		const pts = pathControlPoints(p);
		expect(pts.map((c) => c.role)).toEqual([
			"anchor",
			"control",
			"control",
			"anchor",
		]);
		expect(pts[0]).toMatchObject({ x: 0, y: 0, ref: { type: "start" } });
		expect(pts[3]).toMatchObject({ x: 10, y: 0, ref: { type: "to", seg: 0 } });
	});
});

describe("movePathControl", () => {
	it("moves the start anchor", () => {
		const p = parsePathD("M 0 0 L 10 0");
		if (!p) throw new Error("parse failed");
		expect(movePathControl(p, { type: "start" }, 3, 4).start).toEqual({
			x: 3,
			y: 4,
		});
	});

	it("moves a segment endpoint", () => {
		const p = parsePathD("M 0 0 L 10 0");
		if (!p) throw new Error("parse failed");
		const moved = movePathControl(p, { type: "to", seg: 0 }, 99, 88);
		expect(moved.segs[0]).toEqual({ kind: "L", to: { x: 99, y: 88 } });
	});

	it("moves a bezier control point", () => {
		const p = parsePathD("M 0 0 C 5 5 5 -5 10 0");
		if (!p) throw new Error("parse failed");
		const moved = movePathControl(p, { type: "c1", seg: 0 }, 1, 2);
		expect(moved.segs[0]).toMatchObject({ c1: { x: 1, y: 2 } });
	});
});
