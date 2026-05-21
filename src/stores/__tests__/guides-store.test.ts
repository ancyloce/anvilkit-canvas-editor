import { describe, expect, it } from "vitest";
import type { SmartGuide } from "../../snap/snap-types.js";
import { createGuidesStore } from "../guides-store.js";

const guide: SmartGuide = {
	axis: "x",
	position: 100,
	from: { x: 100, y: 0 },
	to: { x: 100, y: 200 },
};

describe("createGuidesStore", () => {
	it("starts empty", () => {
		const store = createGuidesStore();
		expect(store.getState().guides).toEqual([]);
	});

	it("setGuides + clearGuides round-trip", () => {
		const store = createGuidesStore();
		store.getState().setGuides([guide]);
		expect(store.getState().guides).toEqual([guide]);
		store.getState().clearGuides();
		expect(store.getState().guides).toEqual([]);
	});

	it("two stores are independent", () => {
		const a = createGuidesStore();
		const b = createGuidesStore();
		a.getState().setGuides([guide]);
		expect(a.getState().guides).toHaveLength(1);
		expect(b.getState().guides).toHaveLength(0);
	});
});
