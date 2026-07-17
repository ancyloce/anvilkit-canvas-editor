import {
	type CanvasIR,
	createCanvasIR,
	createGroup,
	createPage,
	createRect,
} from "@anvilkit/canvas-core";
import { cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { CanvasStudioContext } from "@/context/canvas-studio-context.js";
import { makeHarness } from "@/tools/__tests__/_tool-test-helpers.js";
import { CanvasKeyboardLayer } from "../useCanvasKeyboard.js";

afterEach(cleanup);

const FIXED_TS = "2026-05-20T00:00:00.000Z";

function fixtureIR(): CanvasIR {
	const page = createPage({ id: "p1" });
	page.root = createGroup({
		id: "p1-root",
		bounds: page.root.bounds,
		children: [createRect({ id: "a", bounds: { width: 50, height: 50 } })],
	});
	return createCanvasIR({ id: "ir", pages: [page], now: () => FIXED_TS });
}

function setup() {
	const h = makeHarness({ ir: fixtureIR() });
	render(
		<CanvasStudioContext.Provider value={h.studioCtx}>
			<CanvasKeyboardLayer />
		</CanvasStudioContext.Provider>,
	);
	const container = h.studioCtx.stage?.container();
	if (!container) throw new Error("fake stage has no container");
	return { h, container };
}

describe("useCanvasKeyboard — space-hold Hand tool (FR-041/043)", () => {
	it("holding Space switches to the Hand tool", () => {
		const { h, container } = setup();
		expect(h.studioCtx.toolStore.getState().activeTool).toBe("select");
		fireEvent.keyDown(container, { code: "Space" });
		expect(h.studioCtx.toolStore.getState().activeTool).toBe("hand");
	});

	it("releasing Space restores the tool active before the hold", () => {
		const { h, container } = setup();
		h.studioCtx.toolStore.getState().setActiveTool("rect");
		fireEvent.keyDown(container, { code: "Space" });
		expect(h.studioCtx.toolStore.getState().activeTool).toBe("hand");
		fireEvent.keyUp(container, { code: "Space" });
		expect(h.studioCtx.toolStore.getState().activeTool).toBe("rect");
	});

	it("OS key-repeat keydowns do not corrupt the remembered tool", () => {
		const { h, container } = setup();
		h.studioCtx.toolStore.getState().setActiveTool("ellipse");
		fireEvent.keyDown(container, { code: "Space" });
		// Auto-repeat: several more keydowns before any keyup.
		fireEvent.keyDown(container, { code: "Space" });
		fireEvent.keyDown(container, { code: "Space" });
		expect(h.studioCtx.toolStore.getState().activeTool).toBe("hand");
		fireEvent.keyUp(container, { code: "Space" });
		expect(h.studioCtx.toolStore.getState().activeTool).toBe("ellipse");
	});

	it("does not clobber a tool explicitly picked while Space was still held", () => {
		const { h, container } = setup();
		h.studioCtx.toolStore.getState().setActiveTool("rect");
		fireEvent.keyDown(container, { code: "Space" });
		expect(h.studioCtx.toolStore.getState().activeTool).toBe("hand");
		// User clicks a toolbar button mid-hold — a real, intentional tool change.
		h.studioCtx.toolStore.getState().setActiveTool("text");
		fireEvent.keyUp(container, { code: "Space" });
		expect(h.studioCtx.toolStore.getState().activeTool).toBe("text");
	});

	it("is a no-op when the Hand tool is already active", () => {
		const { h, container } = setup();
		h.studioCtx.toolStore.getState().setActiveTool("hand");
		fireEvent.keyDown(container, { code: "Space" });
		expect(h.studioCtx.toolStore.getState().activeTool).toBe("hand");
		fireEvent.keyUp(container, { code: "Space" });
		expect(h.studioCtx.toolStore.getState().activeTool).toBe("hand");
	});

	it("ignores Space while typing in a form field", () => {
		const { h, container } = setup();
		const input = document.createElement("input");
		container.appendChild(input);
		fireEvent.keyDown(input, { code: "Space" });
		expect(h.studioCtx.toolStore.getState().activeTool).toBe("select");
	});
});
