import { describe, expect, it } from "vitest";
import { DEFAULT_SNAP_THRESHOLD } from "@/snap/snap-engine.js";
import {
	createViewportStore,
	DEFAULT_GRID_COLOR,
	DEFAULT_GRID_SIZE,
	DEFAULT_SUB_GRID_COLOR,
} from "../viewport-store.js";

describe("createViewportStore — defaults", () => {
	it("zoom=1, pan=(0,0), grid+snap on, gridSize=8", () => {
		const store = createViewportStore();
		const s = store.getState();
		expect(s.zoom).toBe(1);
		expect(s.panX).toBe(0);
		expect(s.panY).toBe(0);
		expect(s.gridEnabled).toBe(true);
		expect(s.gridSize).toBe(DEFAULT_GRID_SIZE);
		expect(s.snapToObjectsEnabled).toBe(true);
	});

	it("FR-112 grid/snap defaults: subdivisions 0, default colors, snap-to-grid on, engine threshold", () => {
		const s = createViewportStore().getState();
		expect(s.gridSubdivisions).toBe(0);
		expect(s.gridColor).toBe(DEFAULT_GRID_COLOR);
		expect(s.subGridColor).toBe(DEFAULT_SUB_GRID_COLOR);
		// Compat note (FR-112): grid snap used to fire whenever the grid was
		// VISIBLE (gridEnabled default true) — snapToGridEnabled defaults true
		// so out-of-the-box behavior stays "snapping on".
		expect(s.snapToGridEnabled).toBe(true);
		// Pinned to the snap engine's own default so the two cannot drift.
		expect(s.snapThreshold).toBe(DEFAULT_SNAP_THRESHOLD);
		expect(s.snapThreshold).toBe(6);
	});

	it("honors initial options", () => {
		const store = createViewportStore({
			zoom: 2,
			panX: 100,
			panY: -50,
			gridEnabled: false,
			gridSize: 16,
			snapToObjectsEnabled: false,
		});
		const s = store.getState();
		expect(s.zoom).toBe(2);
		expect(s.panX).toBe(100);
		expect(s.panY).toBe(-50);
		expect(s.gridEnabled).toBe(false);
		expect(s.gridSize).toBe(16);
		expect(s.snapToObjectsEnabled).toBe(false);
	});

	it("honors the FR-112 grid/snap options", () => {
		const s = createViewportStore({
			gridSubdivisions: 4,
			gridColor: "#123456",
			subGridColor: "#654321",
			snapToGridEnabled: false,
			snapThreshold: 12,
		}).getState();
		expect(s.gridSubdivisions).toBe(4);
		expect(s.gridColor).toBe("#123456");
		expect(s.subGridColor).toBe("#654321");
		expect(s.snapToGridEnabled).toBe(false);
		expect(s.snapThreshold).toBe(12);
	});
});

describe("createViewportStore — setters", () => {
	it("setZoom updates zoom only", () => {
		const store = createViewportStore();
		store.getState().setZoom(0.5);
		expect(store.getState().zoom).toBe(0.5);
		expect(store.getState().panX).toBe(0);
	});

	it("setPan updates both axes", () => {
		const store = createViewportStore();
		store.getState().setPan(20, 30);
		expect(store.getState().panX).toBe(20);
		expect(store.getState().panY).toBe(30);
	});

	it("setGridEnabled / setGridSize / setSnapToObjectsEnabled", () => {
		const store = createViewportStore();
		store.getState().setGridEnabled(false);
		expect(store.getState().gridEnabled).toBe(false);
		store.getState().setGridSize(4);
		expect(store.getState().gridSize).toBe(4);
		store.getState().setSnapToObjectsEnabled(false);
		expect(store.getState().snapToObjectsEnabled).toBe(false);
	});

	it("setGridSubdivisions / setGridColor / setSubGridColor", () => {
		const store = createViewportStore();
		store.getState().setGridSubdivisions(5);
		expect(store.getState().gridSubdivisions).toBe(5);
		store.getState().setGridColor("#ff0000");
		expect(store.getState().gridColor).toBe("#ff0000");
		store.getState().setSubGridColor("#00ff00");
		expect(store.getState().subGridColor).toBe("#00ff00");
	});

	it("setSnapToGridEnabled / setSnapThreshold", () => {
		const store = createViewportStore();
		store.getState().setSnapToGridEnabled(false);
		expect(store.getState().snapToGridEnabled).toBe(false);
		store.getState().setSnapThreshold(24);
		expect(store.getState().snapThreshold).toBe(24);
	});

	it("hiding the grid does NOT flip the snap-to-grid toggle (FR-112 separation)", () => {
		const store = createViewportStore();
		store.getState().setGridEnabled(false);
		expect(store.getState().snapToGridEnabled).toBe(true);
	});
});

/**
 * Zoom/pan become the Konva stage's scale/position, so a non-finite value lands
 * in every node's absolute transform — where `Transform.decompose()` turns it
 * into a `NaN` rotation that `Transformer.nodes()` writes onto itself, making
 * EVERY later selection log `NaN is a not valid value for "rotation"`. Every
 * producer divides by a page or viewport dimension, and `clampZoom` cannot
 * sanitise it (`Math.min`/`Math.max` propagate `NaN`).
 */
describe("createViewportStore — non-finite viewport values are ignored", () => {
	it.each([
		Number.NaN,
		Number.POSITIVE_INFINITY,
		Number.NEGATIVE_INFINITY,
	])("setZoom(%p) leaves the previous zoom in place", (bad) => {
		const store = createViewportStore({ zoom: 1.5 });
		store.getState().setZoom(bad);
		expect(store.getState().zoom).toBe(1.5);
	});

	it("setPan ignores an update when EITHER axis is non-finite", () => {
		const store = createViewportStore({ panX: 5, panY: 6 });
		store.getState().setPan(Number.NaN, 20);
		store.getState().setPan(20, Number.POSITIVE_INFINITY);
		expect(store.getState().panX).toBe(5);
		expect(store.getState().panY).toBe(6);
	});

	it("still accepts legitimate zero and fractional values", () => {
		const store = createViewportStore({ zoom: 1 });
		store.getState().setZoom(0.1);
		store.getState().setPan(0, -12.5);
		expect(store.getState().zoom).toBe(0.1);
		expect(store.getState().panX).toBe(0);
		expect(store.getState().panY).toBe(-12.5);
	});
});

describe("createViewportStore — independent instances", () => {
	it("two stores do not share state", () => {
		const a = createViewportStore();
		const b = createViewportStore();
		a.getState().setPan(99, 99);
		expect(a.getState().panX).toBe(99);
		expect(b.getState().panX).toBe(0);
	});
});
