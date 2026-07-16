import {
	type CanvasIR,
	createCanvasIR,
	createGroup,
	createPage,
	createRect,
	findNode,
} from "@anvilkit/canvas-core";
import { cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { CanvasStudioContext } from "@/context/canvas-studio-context.js";
import { createSceneStore } from "@/stores/scene-store.js";
import { makeHarness } from "@/tools/__tests__/_tool-test-helpers.js";
import { CanvasKeyboardLayer } from "../useCanvasKeyboard.js";

afterEach(cleanup);

const FIXED_TS = "2026-05-20T00:00:00.000Z";

function fixtureIR(): CanvasIR {
	const page = createPage({ id: "p1" });
	page.root = createGroup({
		id: "p1-root",
		bounds: page.root.bounds,
		children: [
			createRect({
				id: "a",
				transform: { x: 0 },
				bounds: { width: 50, height: 50 },
			}),
		],
	});
	return createCanvasIR({ id: "ir", pages: [page], now: () => FIXED_TS });
}

function nodeX(ir: CanvasIR): number {
	const found = findNode(ir, "a");
	if (!found) throw new Error("node a missing");
	return found.node.transform.x;
}

/**
 * Harness with a REAL history entry: `a` moved 0 → 10 through the history
 * store, scene store attached so undo/redo have somewhere to write.
 */
function setup() {
	const h = makeHarness({ ir: fixtureIR() });
	const moved = h.studioCtx.historyStore.getState().commit(h.ir, {
		type: "node.move",
		nodeId: "a",
		from: { x: 0, y: 0 },
		to: { x: 10, y: 0 },
	});
	h.setIR(moved);
	const sceneStore = createSceneStore({ initialIR: moved });
	h.studioCtx.sceneStore = sceneStore;
	render(
		<CanvasStudioContext.Provider value={h.studioCtx}>
			<CanvasKeyboardLayer />
		</CanvasStudioContext.Provider>,
	);
	const container = h.studioCtx.stage?.container();
	if (!container) throw new Error("fake stage has no container");
	return { h, sceneStore, container };
}

describe("useCanvasKeyboard — undo/redo shortcuts (M0-03 interim)", () => {
	it("Ctrl/Cmd+Z undoes the last commit into the scene store", () => {
		const { h, sceneStore, container } = setup();
		expect(nodeX(sceneStore.getState().ir)).toBe(10);
		fireEvent.keyDown(container, { key: "z", ctrlKey: true });
		expect(nodeX(sceneStore.getState().ir)).toBe(0);
		expect(h.studioCtx.historyStore.getState().canRedo()).toBe(true);
	});

	it("Ctrl/Cmd+Shift+Z and Ctrl+Y redo", () => {
		const { h, sceneStore, container } = setup();
		fireEvent.keyDown(container, { key: "z", ctrlKey: true });
		h.setIR(sceneStore.getState().ir);
		fireEvent.keyDown(container, { key: "z", ctrlKey: true, shiftKey: true });
		expect(nodeX(sceneStore.getState().ir)).toBe(10);

		// Undo again, then redo via Ctrl+Y (Windows/Linux alternate).
		h.setIR(sceneStore.getState().ir);
		fireEvent.keyDown(container, { key: "z", ctrlKey: true });
		h.setIR(sceneStore.getState().ir);
		fireEvent.keyDown(container, { key: "y", ctrlKey: true });
		expect(nodeX(sceneStore.getState().ir)).toBe(10);
		expect(h.studioCtx.historyStore.getState().canRedo()).toBe(false);
	});

	it("does nothing when there is nothing to undo, and works without selection", () => {
		const { h, sceneStore, container } = setup();
		// Selection empty throughout — undo must not require one.
		expect(h.studioCtx.selectionStore.getState().selectedIds).toHaveLength(0);
		fireEvent.keyDown(container, { key: "z", ctrlKey: true });
		h.setIR(sceneStore.getState().ir);
		// History exhausted: a second undo is a silent no-op.
		fireEvent.keyDown(container, { key: "z", ctrlKey: true });
		expect(nodeX(sceneStore.getState().ir)).toBe(0);
		expect(h.studioCtx.historyStore.getState().canUndo()).toBe(false);
	});

	it("ignores the shortcut while typing in a form field", () => {
		const { sceneStore, container } = setup();
		const input = document.createElement("input");
		container.appendChild(input);
		fireEvent.keyDown(input, { key: "z", ctrlKey: true });
		expect(nodeX(sceneStore.getState().ir)).toBe(10);
	});

	it("Ctrl/Cmd+A selects all top-level nodes but excludes locked ones (FR-190)", () => {
		const ir = fixtureIR();
		// Add a locked sibling; FR-190 select-all must skip it.
		const locked = createRect({
			id: "locked",
			bounds: { width: 10, height: 10 },
		});
		(locked as { locked?: boolean }).locked = true;
		ir.pages[0]?.root.children.push(locked);
		const h = makeHarness({ ir });
		const sceneStore = createSceneStore({ initialIR: ir });
		h.studioCtx.sceneStore = sceneStore;
		render(
			<CanvasStudioContext.Provider value={h.studioCtx}>
				<CanvasKeyboardLayer />
			</CanvasStudioContext.Provider>,
		);
		const container = h.studioCtx.stage?.container();
		if (!container) throw new Error("fake stage has no container");
		fireEvent.keyDown(container, { key: "a", ctrlKey: true });
		expect(h.studioCtx.selectionStore.getState().selectedIds).toEqual(["a"]);
	});
});
