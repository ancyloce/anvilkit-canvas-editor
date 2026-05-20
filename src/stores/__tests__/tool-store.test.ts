import { describe, expect, it } from "vitest";
import { createToolStore, DEFAULT_TOOL } from "../tool-store.js";

describe("createToolStore — defaults", () => {
	it("starts on `select` when no initial tool is provided", () => {
		const store = createToolStore();
		expect(store.getState().activeTool).toBe(DEFAULT_TOOL);
		expect(DEFAULT_TOOL).toBe("select");
	});

	it("honors `initialTool`", () => {
		const store = createToolStore({ initialTool: "rect" });
		expect(store.getState().activeTool).toBe("rect");
	});
});

describe("createToolStore — setActiveTool", () => {
	it("updates the active tool", () => {
		const store = createToolStore();
		store.getState().setActiveTool("ellipse");
		expect(store.getState().activeTool).toBe("ellipse");
		store.getState().setActiveTool("hand");
		expect(store.getState().activeTool).toBe("hand");
	});
});

describe("createToolStore — independent instances", () => {
	it("two stores do not share state", () => {
		const a = createToolStore();
		const b = createToolStore();
		a.getState().setActiveTool("text");
		expect(a.getState().activeTool).toBe("text");
		expect(b.getState().activeTool).toBe("select");
	});
});
