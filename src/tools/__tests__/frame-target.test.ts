import {
	type CanvasNode,
	createFrame,
	createGroup,
	createRect,
} from "@anvilkit/canvas-core";
import { describe, expect, it } from "vitest";
import { findFrameAtPoint } from "../frame-target.js";

const frame = (
	id: string,
	x: number,
	y: number,
	w: number,
	h: number,
	over: Partial<Parameters<typeof createFrame>[0]> = {},
) =>
	createFrame({
		id,
		transform: { x, y },
		bounds: { width: w, height: h },
		...over,
	});

describe("findFrameAtPoint", () => {
	it("returns null when the point misses every frame", () => {
		expect(findFrameAtPoint([frame("f", 0, 0, 50, 50)], { x: 80, y: 80 })).toBe(
			null,
		);
	});

	it("finds a top-level frame containing the point", () => {
		const f = frame("f", 10, 10, 100, 100);
		expect(findFrameAtPoint([f], { x: 50, y: 50 })?.id).toBe("f");
	});

	it("ignores non-container nodes", () => {
		const rect = createRect({ id: "r", bounds: { width: 100, height: 100 } });
		expect(findFrameAtPoint([rect], { x: 10, y: 10 })).toBe(null);
	});

	it("takes the frame painted on top when two overlap", () => {
		const under = frame("under", 0, 0, 100, 100);
		const over = frame("over", 0, 0, 100, 100);
		// Paint order: later sibling wins.
		expect(findFrameAtPoint([under, over], { x: 50, y: 50 })?.id).toBe("over");
	});

	it("prefers a nested frame over its ancestor", () => {
		const inner = frame("inner", 10, 10, 30, 30);
		const outer = frame("outer", 0, 0, 200, 200, { children: [inner] });
		// (20,20) is inside BOTH; the inner well must win.
		expect(findFrameAtPoint([outer], { x: 20, y: 20 })?.id).toBe("inner");
		// (100,100) is only inside the outer.
		expect(findFrameAtPoint([outer], { x: 100, y: 100 })?.id).toBe("outer");
	});

	it("composes ancestor transforms — a nested frame is hit at its WORLD position", () => {
		const inner = frame("inner", 10, 10, 20, 20);
		const outer = frame("outer", 100, 100, 200, 200, { children: [inner] });
		// The inner frame's world box is (110,110)–(130,130).
		expect(findFrameAtPoint([outer], { x: 115, y: 115 })?.id).toBe("inner");
		// Its LOCAL box (10,10)–(30,30) must not be hit in world space.
		expect(findFrameAtPoint([outer], { x: 15, y: 15 })).toBe(null);
	});

	it("recurses through a group without ever targeting it", () => {
		const f = frame("f", 10, 10, 50, 50);
		const group = createGroup({
			id: "g",
			bounds: { width: 200, height: 200 },
			children: [f],
		});
		const found = findFrameAtPoint([group], { x: 20, y: 20 });
		expect(found?.id).toBe("f");
		expect(found?.type).toBe("frame");
	});

	it("applies a group's transform to its frame children", () => {
		const f = frame("f", 0, 0, 50, 50);
		const group = createGroup({
			id: "g",
			transform: { x: 100, y: 0 },
			bounds: { width: 200, height: 200 },
			children: [f],
		});
		expect(findFrameAtPoint([group], { x: 120, y: 20 })?.id).toBe("f");
		expect(findFrameAtPoint([group], { x: 20, y: 20 })).toBe(null);
	});

	it("skips locked and hidden frames", () => {
		const locked: CanvasNode = { ...frame("l", 0, 0, 100, 100), locked: true };
		const hidden: CanvasNode = {
			...frame("h", 0, 0, 100, 100),
			visible: false,
		};
		expect(findFrameAtPoint([locked], { x: 50, y: 50 })).toBe(null);
		expect(findFrameAtPoint([hidden], { x: 50, y: 50 })).toBe(null);
	});

	it("a clipped frame hides its subtree outside its own box", () => {
		// The child sits OUTSIDE the parent's box, so the clip makes it invisible.
		const escapee = frame("escapee", 300, 300, 50, 50);
		const clipped = frame("clipped", 0, 0, 100, 100, {
			clip: true,
			children: [escapee],
		});
		expect(findFrameAtPoint([clipped], { x: 320, y: 320 })).toBe(null);
	});

	it("an UNclipped frame still exposes a child that overflows its box", () => {
		const escapee = frame("escapee", 300, 300, 50, 50);
		const open = frame("open", 0, 0, 100, 100, {
			clip: false,
			children: [escapee],
		});
		expect(findFrameAtPoint([open], { x: 320, y: 320 })?.id).toBe("escapee");
	});

	it("respects rotation — a rotated frame is hit only where it actually is", () => {
		const rotated = createFrame({
			id: "rot",
			transform: { x: 100, y: 100, rotation: 45 },
			bounds: { width: 100, height: 100 },
		});
		// Rotating the 100×100 box 45° about its origin makes a diamond with world
		// corners (100,100), (170.7,170.7), (100,241.4), (29.3,170.7).
		expect(findFrameAtPoint([rotated], { x: 110, y: 110 })?.id).toBe("rot");
		// (35,110) sits inside the diamond's AXIS-ALIGNED bounding box but outside
		// the diamond itself — an AABB-only hit test would wrongly match here.
		expect(findFrameAtPoint([rotated], { x: 35, y: 110 })).toBe(null);
	});
});
