import { describe, expect, it } from "vitest";
import { createCropStore } from "../crop-store.js";

describe("crop-store", () => {
	it("starts closed", () => {
		const store = createCropStore();
		expect(store.getState().cropNodeId).toBeNull();
		expect(store.getState().draft).toBeNull();
	});

	it("begin opens for a node and resets any prior draft", () => {
		const store = createCropStore();
		store.getState().setDraft({ x: 1, y: 2, width: 3, height: 4 });
		store.getState().begin("img-a");
		expect(store.getState().cropNodeId).toBe("img-a");
		expect(store.getState().draft).toBeNull();
	});

	it("setDraft stores the rect; clear closes everything", () => {
		const store = createCropStore();
		store.getState().begin("img-a");
		store.getState().setDraft({ x: 5, y: 6, width: 7, height: 8 });
		expect(store.getState().draft).toEqual({ x: 5, y: 6, width: 7, height: 8 });
		store.getState().clear();
		expect(store.getState().cropNodeId).toBeNull();
		expect(store.getState().draft).toBeNull();
	});
});
