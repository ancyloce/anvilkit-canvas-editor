// @vitest-environment node
// Pure geometry — no DOM. The hook half of stage-window.ts is exercised
// through the EditorStage integration test; this file pins the arithmetic
// K-1's memory guarantee rests on.
import { describe, expect, it } from "vitest";
import {
	computeStageWindow,
	STAGE_WINDOW_PAD,
	STAGE_WINDOW_QUANTUM,
	type StageWindow,
	stageWindowsEqual,
} from "../stage-window.js";

function rect(left: number, top: number, width: number, height: number) {
	return { left, top, width, height };
}

describe("computeStageWindow (K-1)", () => {
	it("returns null for unmeasurable rects (jsdom zeros, SSR)", () => {
		expect(computeStageWindow(rect(0, 0, 0, 0), rect(0, 0, 800, 600))).toBe(
			null,
		);
		expect(computeStageWindow(rect(0, 0, 800, 600), rect(0, 0, 0, 0))).toBe(
			null,
		);
		expect(
			computeStageWindow(rect(0, 0, Number.NaN, 100), rect(0, 0, 800, 600)),
		).toBe(null);
	});

	it("covers the whole footprint when it fits inside the viewport", () => {
		// A fitted page: footprint smaller than the scroll viewport. The window
		// clamps to the footprint — i.e. the stage is exactly the pre-K-1 box
		// and windowing is a no-op.
		const window_ = computeStageWindow(
			rect(100, 50, 400, 300),
			rect(0, 0, 1200, 900),
		);
		expect(window_).toEqual({ x: 0, y: 0, width: 400, height: 300 });
	});

	it("windows a footprint much larger than the viewport", () => {
		// Zoomed in: 4320×7680 footprint (1080×1920 at zoom 4) behind a
		// 1200×800 viewport, scrolled some way down.
		const footprint = rect(-1000, -2000, 4320, 7680);
		const viewport = rect(0, 0, 1200, 800);
		const window_ = computeStageWindow(footprint, viewport);
		expect(window_).not.toBe(null);
		const w = window_ as StageWindow;
		// The visible band is [1000, 2200]×[2000, 2800] in footprint coords;
		// the window must contain it plus the pad, snapped to the quantum.
		expect(w.x).toBeLessThanOrEqual(
			1000 - (STAGE_WINDOW_PAD - STAGE_WINDOW_QUANTUM),
		);
		expect(w.x + w.width).toBeGreaterThanOrEqual(
			2200 + (STAGE_WINDOW_PAD - STAGE_WINDOW_QUANTUM),
		);
		expect(w.y).toBeLessThanOrEqual(
			2000 - (STAGE_WINDOW_PAD - STAGE_WINDOW_QUANTUM),
		);
		expect(w.y + w.height).toBeGreaterThanOrEqual(
			2800 + (STAGE_WINDOW_PAD - STAGE_WINDOW_QUANTUM),
		);
		// And it must stay bounded — the whole point of K-1. The window may
		// not exceed viewport + 2·pad + 2·quantum on either axis.
		expect(w.width).toBeLessThanOrEqual(
			1200 + 2 * STAGE_WINDOW_PAD + 2 * STAGE_WINDOW_QUANTUM,
		);
		expect(w.height).toBeLessThanOrEqual(
			800 + 2 * STAGE_WINDOW_PAD + 2 * STAGE_WINDOW_QUANTUM,
		);
		// Edges are quantized and inside the footprint.
		expect(w.x % STAGE_WINDOW_QUANTUM).toBe(0);
		expect(w.y % STAGE_WINDOW_QUANTUM).toBe(0);
		expect(w.x).toBeGreaterThanOrEqual(0);
		expect(w.y).toBeGreaterThanOrEqual(0);
		expect(w.x + w.width).toBeLessThanOrEqual(4320);
		expect(w.y + w.height).toBeLessThanOrEqual(7680);
	});

	it("is scroll-stable inside one quantum cell", () => {
		// Two scroll positions a few px apart must produce the SAME window —
		// that is what makes steady-state scrolling free.
		const viewport = rect(0, 0, 1200, 800);
		const a = computeStageWindow(rect(-1000, -2000, 4320, 7680), viewport);
		const b = computeStageWindow(rect(-1010, -2030, 4320, 7680), viewport);
		expect(stageWindowsEqual(a, b)).toBe(true);
	});

	it("keeps a minimal window alive when the footprint is fully out of view", () => {
		// Page scrolled entirely above the viewport: the visible band is empty,
		// clamped to the bottom edge. A (small) window must survive there so
		// re-entry never starts from a blank stage — and it must still be a
		// valid box inside the footprint.
		const window_ = computeStageWindow(
			rect(0, -5000, 800, 1000),
			rect(0, 0, 1200, 800),
		);
		expect(window_).not.toBe(null);
		const w = window_ as StageWindow;
		expect(w.width).toBeGreaterThan(0);
		expect(w.height).toBeGreaterThan(0);
		expect(w.y + w.height).toBeLessThanOrEqual(1000);
		// Anchored at the edge nearest the viewport (the bottom).
		expect(w.y + w.height).toBe(1000);
	});

	it("never emits a zero-sized window for a sliver overlap", () => {
		// 1-px overlap at the footprint's bottom edge.
		const window_ = computeStageWindow(
			rect(0, -999, 800, 1000),
			rect(0, 0, 1200, 800),
		);
		expect(window_).not.toBe(null);
		const w = window_ as StageWindow;
		expect(w.width).toBeGreaterThan(0);
		expect(w.height).toBeGreaterThan(0);
	});
});

describe("stageWindowsEqual", () => {
	it("compares by value and treats null as only equal to null", () => {
		const a: StageWindow = { x: 0, y: 256, width: 1024, height: 768 };
		expect(stageWindowsEqual(a, { ...a })).toBe(true);
		expect(stageWindowsEqual(a, { ...a, y: 512 })).toBe(false);
		expect(stageWindowsEqual(a, null)).toBe(false);
		expect(stageWindowsEqual(null, null)).toBe(true);
	});
});
