import {
	createEllipse,
	createLine,
	createRect,
	createStar,
} from "@anvilkit/canvas-core";
import { describe, expect, it } from "vitest";
import {
	finiteOr,
	hasDrawablePathData,
	isFiniteBox,
	sanitizeBox,
	withFiniteGeometry,
} from "../finite-geometry.js";

/**
 * Guards against the `Konva warning: NaN is a not valid value for "rotation"
 * attribute` class of bug. Konva's numeric validators warn but STORE the bad
 * value, so a single non-finite number reaches `Transformer` — whose own
 * zero-size guards use `Util._inRange` and therefore let every `NaN` through to
 * the singular-matrix path. See `finite-geometry.ts`.
 */

describe("finiteOr", () => {
	it("passes finite values through, including 0 and negatives", () => {
		expect(finiteOr(0, 1)).toBe(0);
		expect(finiteOr(-12.5, 1)).toBe(-12.5);
	});

	it("replaces NaN and both infinities", () => {
		expect(finiteOr(Number.NaN, 7)).toBe(7);
		expect(finiteOr(Number.POSITIVE_INFINITY, 7)).toBe(7);
		expect(finiteOr(Number.NEGATIVE_INFINITY, 7)).toBe(7);
	});
});

describe("isFiniteBox", () => {
	it("accepts a finite box, including a zero-size one", () => {
		expect(isFiniteBox({ x: 0, y: 0, width: 0, height: 0 })).toBe(true);
	});

	it("rejects a box with any non-finite member", () => {
		for (const key of ["x", "y", "width", "height"] as const) {
			const box = { x: 1, y: 2, width: 3, height: 4 };
			box[key] = Number.NaN;
			expect(isFiniteBox(box)).toBe(false);
		}
	});

	/**
	 * Konva types the `boundBoxFunc` box as `IRect & { rotation: number }` and
	 * `Transformer._fitNodesInto` feeds that field straight into
	 * `newTr.rotate(newAttrs.rotation)`. A guard that only checked x/y/w/h let a
	 * `NaN` rotation through untouched — making the whole matrix `NaN` and
	 * producing the exact `NaN is a not valid value for "rotation"` burst this
	 * module exists to stop, THROUGH the guard built to stop it.
	 */
	it("rejects a non-finite rotation on a box that carries one", () => {
		const base = { x: 1, y: 2, width: 3, height: 4 };
		expect(isFiniteBox({ ...base, rotation: 45 })).toBe(true);
		expect(isFiniteBox({ ...base, rotation: Number.NaN })).toBe(false);
		expect(isFiniteBox({ ...base, rotation: Number.POSITIVE_INFINITY })).toBe(
			false,
		);
	});

	it("still accepts a rotation-less rect (getClientRect's shape)", () => {
		expect(isFiniteBox({ x: 1, y: 2, width: 3, height: 4 })).toBe(true);
	});
});

describe("sanitizeBox", () => {
	/**
	 * `boundBoxFunc`'s `oldBox` comes from Konva's own `_getNodeRect()`, so once a
	 * node's rect has gone non-finite BOTH boxes are corrupt and falling back to
	 * `oldBox` propagates the corruption. Collapsing to `minDimension` keeps the
	 * Transformer's matrix invertible.
	 */
	it("replaces every non-finite member, sizing to minDimension", () => {
		expect(
			sanitizeBox(
				{
					x: Number.NaN,
					y: 5,
					width: Number.NaN,
					height: Number.NEGATIVE_INFINITY,
					rotation: Number.NaN,
				},
				1,
			),
		).toEqual({ x: 0, y: 5, width: 1, height: 1, rotation: 0 });
	});

	it("leaves a rotation-less box rotation-less", () => {
		const out = sanitizeBox({ x: 0, y: 0, width: Number.NaN, height: 2 }, 1);
		expect(out).toEqual({ x: 0, y: 0, width: 1, height: 2 });
		expect("rotation" in out).toBe(false);
	});
});

describe("hasDrawablePathData", () => {
	it("accepts data Konva can measure — absolute, relative, shorthand, curves", () => {
		for (const d of [
			"M 0 0",
			"M 0 0 L 10 10",
			"m 5 5 l 10 10",
			"M0,0H10V10Z",
			"M 0 0 C 1 1 2 2 3 3",
			"M 0 0 Q 5 5 10 0",
			"M 10 10 A 5 5 0 0 1 20 20",
		]) {
			expect(hasDrawablePathData(d), d).toBe(true);
		}
	});

	/**
	 * Each of these makes `Konva.Path.getSelfRect()` return an all-`NaN` rect,
	 * which then poisons every ancestor container's client rect. `"Z"` is the
	 * non-obvious one: it parses to a command, just one with no points — so a
	 * "did it parse?" check is not enough, and the IR's `d.length >= 1` rule
	 * admits every string here.
	 */
	it("rejects data that yields no measurable point", () => {
		for (const d of ["", "   ", "Z", "M", "garbage", "NaN"]) {
			expect(hasDrawablePathData(d), JSON.stringify(d)).toBe(false);
		}
	});
});

describe("withFiniteGeometry", () => {
	it("returns the SAME reference when nothing needs correcting", () => {
		const node = createRect({
			id: "r1",
			transform: { x: 5, y: 6 },
			bounds: { width: 10, height: 20 },
		});
		expect(withFiniteGeometry(node)).toBe(node);
	});

	it("replaces a non-finite rotation with 0 and keeps the rest intact", () => {
		const node = createRect({
			id: "r1",
			transform: { x: 5, y: 6, rotation: Number.NaN },
			bounds: { width: 10, height: 20 },
		});
		const safe = withFiniteGeometry(node);
		expect(safe.transform.rotation).toBe(0);
		expect(safe.transform.x).toBe(5);
		expect(safe.transform.y).toBe(6);
		expect(safe.bounds).toEqual({ width: 10, height: 20 });
	});

	it("replaces non-finite scale with 1 and non-finite position/bounds with 0", () => {
		const node = createEllipse({
			id: "e1",
			transform: {
				x: Number.NaN,
				y: Number.POSITIVE_INFINITY,
				scaleX: Number.NaN,
				scaleY: Number.NaN,
			},
			bounds: { width: Number.NaN, height: 20 },
		});
		const safe = withFiniteGeometry(node);
		expect(safe.transform).toMatchObject({ x: 0, y: 0, scaleX: 1, scaleY: 1 });
		expect(safe.bounds).toEqual({ width: 0, height: 20 });
	});

	/**
	 * `Konva.Line.getSelfRect()` seeds min/max from `points[0]`/`points[1]` and
	 * folds the rest through `Math.min`/`Math.max`, so ONE non-finite entry
	 * returns an all-`NaN` self rect that poisons every ancestor container's
	 * client rect — the same failure `d` has, and reachable by the same routes
	 * (SVG import, AI output, templates, collab peers). Sanitising `points` at
	 * any later prop site would be after the measurement that matters.
	 */
	it("collapses non-finite line points to the origin, preserving length", () => {
		const node = createLine({
			id: "l1",
			points: [0, Number.NaN, 10, Number.POSITIVE_INFINITY],
		});
		const safe = withFiniteGeometry(node);
		expect(safe.points).toEqual([0, 0, 10, 0]);
		// Length drives Konva's safe `points.length < 4` branch — dropping entries
		// instead of replacing them would change the shape.
		expect(safe.points).toHaveLength(4);
	});

	it("leaves a finite line reference-identical", () => {
		const node = createLine({ id: "l2", points: [0, 0, 10, 10] });
		expect(withFiniteGeometry(node)).toBe(node);
	});

	/** `getClientRect` folds stroke width into every rect by default. */
	it("replaces a non-finite strokeWidth with 0", () => {
		const node = createLine({
			id: "l3",
			points: [0, 0, 10, 10],
			strokeWidth: Number.NaN,
		});
		expect(withFiniteGeometry(node).strokeWidth).toBe(0);
	});

	/**
	 * `points` is a COUNT on star nodes, not a coordinate list — the guard is
	 * `Array.isArray`-gated so a star's point count is never rewritten to an
	 * array.
	 */
	it("does not touch a star's numeric `points` count", () => {
		const node = createStar({
			id: "s1",
			bounds: { width: 10, height: 10 },
			points: 5,
			transform: { rotation: Number.NaN },
		});
		const safe = withFiniteGeometry(node);
		expect(safe.points).toBe(5);
		expect(safe.transform.rotation).toBe(0);
	});

	it("corrects skew only when the node declares it (C-4 omission stays)", () => {
		const withSkew = withFiniteGeometry({
			...createRect({ id: "r1", bounds: { width: 1, height: 1 } }),
			transform: {
				x: 0,
				y: 0,
				rotation: 0,
				scaleX: 1,
				scaleY: 1,
				skewX: Number.NaN,
			},
		});
		expect(withSkew.transform.skewX).toBe(0);

		const noSkew = withFiniteGeometry({
			...createRect({ id: "r2", bounds: { width: 1, height: 1 } }),
			transform: { x: Number.NaN, y: 0, rotation: 0, scaleX: 1, scaleY: 1 },
		});
		expect("skewX" in noSkew.transform).toBe(false);
		expect("skewY" in noSkew.transform).toBe(false);
	});
});
