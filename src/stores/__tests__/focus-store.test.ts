import { describe, expect, it } from "vitest";
import { createFocusStore } from "../focus-store.js";

describe("createFocusStore", () => {
	it("starts unfocused", () => {
		const s = createFocusStore();
		expect(s.getState().focusedId).toBeNull();
		expect(s.getState().isFocused("x")).toBe(false);
	});

	it("sets + reports focus and clears with null", () => {
		const s = createFocusStore();
		s.getState().setFocus("n1");
		expect(s.getState().focusedId).toBe("n1");
		expect(s.getState().isFocused("n1")).toBe(true);
		expect(s.getState().isFocused("n2")).toBe(false);
		s.getState().setFocus(null);
		expect(s.getState().focusedId).toBeNull();
	});
});
