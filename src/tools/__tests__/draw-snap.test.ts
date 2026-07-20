import type { CanvasIR } from "@anvilkit/canvas-core";
import {
	createCanvasIR,
	createGroup,
	createPage,
	createRect,
} from "@anvilkit/canvas-core";
import { describe, expect, it } from "vitest";
import { snapPoint } from "../draw-snap.js";
import { makeHarness } from "./_tool-test-helpers.js";

const FIXED_TS = "2026-05-20T00:00:00.000Z";

/** One page with a single 50x50 rect at (100, 100) to edge-snap against. */
function fixtureIR(): CanvasIR {
	const page = createPage({ id: "p1" });
	page.root = createGroup({
		id: "p1-root",
		bounds: page.root.bounds,
		children: [
			createRect({
				id: "other",
				bounds: { width: 50, height: 50 },
				transform: { x: 100, y: 100 },
			}),
		],
	});
	return createCanvasIR({ id: "ir-1", pages: [page], now: () => FIXED_TS });
}

describe("snapPoint — FR-112 grid-snap gating", () => {
	it("snaps to the grid when snapToGridEnabled is on, even while the grid is HIDDEN", () => {
		const h = makeHarness();
		const vs = h.ctx.viewportStore.getState();
		expect(vs.gridEnabled).toBe(false); // harness default: grid not drawn
		vs.setSnapToGridEnabled(true);
		// gridSize default 8: (13, 18) → nearest multiples (16, 16).
		const result = snapPoint(h.ctx, { x: 13, y: 18 });
		expect(result.x).toBe(16);
		expect(result.y).toBe(16);
		// Grid snaps never emit smart guides.
		expect(result.guides).toEqual([]);
	});

	it("does NOT snap to the grid when snapToGridEnabled is off, even while the grid is VISIBLE", () => {
		const h = makeHarness();
		const vs = h.ctx.viewportStore.getState();
		vs.setGridEnabled(true);
		expect(vs.snapToGridEnabled).toBe(false); // harness default
		const result = snapPoint(h.ctx, { x: 13, y: 18 });
		expect(result.x).toBe(13);
		expect(result.y).toBe(18);
	});
});

describe("snapPoint — snapThreshold passthrough (FR-112)", () => {
	it("with the default threshold (6), a 9px-away edge does not snap", () => {
		const h = makeHarness();
		h.ctx.getIR = () => fixtureIR();
		const result = snapPoint(h.ctx, { x: 91, y: 50 });
		expect(result.x).toBe(91);
		expect(result.y).toBe(50);
	});

	it("a raised store threshold reaches the same edge", () => {
		const h = makeHarness();
		h.ctx.getIR = () => fixtureIR();
		h.ctx.viewportStore.getState().setSnapThreshold(10);
		// 9px from the other rect's left edge at x=100 — within the new
		// threshold; y stays put (nearest y edge is 50px away).
		const result = snapPoint(h.ctx, { x: 91, y: 50 });
		expect(result.x).toBe(100);
		expect(result.y).toBe(50);
		expect(result.guides.map((g) => g.axis)).toEqual(["x"]);
	});
});
