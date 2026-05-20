import { describe, expect, it } from "vitest";
import { createViewportStore, DEFAULT_GRID_SIZE } from "../viewport-store.js";

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
