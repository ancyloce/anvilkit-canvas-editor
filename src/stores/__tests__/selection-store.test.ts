import { describe, expect, it } from "vitest";
import { createSelectionStore } from "../selection-store.js";

describe("createSelectionStore — defaults", () => {
	it("starts with an empty selection", () => {
		const store = createSelectionStore();
		expect(store.getState().selectedIds).toEqual([]);
		expect(store.getState().isSelected("n1")).toBe(false);
	});
});

describe("createSelectionStore — setSelection", () => {
	it("replaces the current selection", () => {
		const store = createSelectionStore();
		store.getState().setSelection(["a", "b"]);
		expect(store.getState().selectedIds).toEqual(["a", "b"]);
		store.getState().setSelection(["c"]);
		expect(store.getState().selectedIds).toEqual(["c"]);
	});

	it("dedupes input", () => {
		const store = createSelectionStore();
		store.getState().setSelection(["a", "a", "b"]);
		expect(store.getState().selectedIds).toEqual(["a", "b"]);
	});
});

describe("createSelectionStore — add / remove / toggle", () => {
	it("addToSelection appends if not present", () => {
		const store = createSelectionStore();
		store.getState().addToSelection("a");
		store.getState().addToSelection("b");
		store.getState().addToSelection("a"); // no-op
		expect(store.getState().selectedIds).toEqual(["a", "b"]);
	});

	it("removeFromSelection drops the id (no-op if absent)", () => {
		const store = createSelectionStore();
		store.getState().setSelection(["a", "b"]);
		store.getState().removeFromSelection("a");
		expect(store.getState().selectedIds).toEqual(["b"]);
		store.getState().removeFromSelection("missing");
		expect(store.getState().selectedIds).toEqual(["b"]);
	});

	it("toggleSelection adds when missing, removes when present", () => {
		const store = createSelectionStore();
		store.getState().toggleSelection("a");
		expect(store.getState().selectedIds).toEqual(["a"]);
		store.getState().toggleSelection("a");
		expect(store.getState().selectedIds).toEqual([]);
		store.getState().toggleSelection("b");
		store.getState().toggleSelection("c");
		expect(store.getState().selectedIds).toEqual(["b", "c"]);
	});
});

describe("createSelectionStore — clearSelection / isSelected", () => {
	it("clearSelection empties the list", () => {
		const store = createSelectionStore();
		store.getState().setSelection(["a", "b", "c"]);
		store.getState().clearSelection();
		expect(store.getState().selectedIds).toEqual([]);
	});

	it("isSelected reflects membership", () => {
		const store = createSelectionStore();
		store.getState().setSelection(["a"]);
		expect(store.getState().isSelected("a")).toBe(true);
		expect(store.getState().isSelected("b")).toBe(false);
	});
});

describe("createSelectionStore — independent instances", () => {
	it("two stores do not share state", () => {
		const a = createSelectionStore();
		const b = createSelectionStore();
		a.getState().addToSelection("x");
		expect(a.getState().selectedIds).toEqual(["x"]);
		expect(b.getState().selectedIds).toEqual([]);
	});
});
