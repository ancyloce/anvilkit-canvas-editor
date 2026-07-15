import {
	type CanvasIR,
	createCanvasIR,
	createGroup,
	createPage,
	createRect,
	findNode,
} from "@anvilkit/canvas-core";
import { cleanup, fireEvent, render } from "@testing-library/react";
import { useRef } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { CanvasStudioContext } from "@/context/canvas-studio-context.js";
import { createSceneStore } from "@/stores/scene-store.js";
import { makeHarness } from "@/tools/__tests__/_tool-test-helpers.js";
import type { CanvasShortcutOptions } from "../shortcut-registry.js";
import { WorkspaceShortcutLayer } from "../WorkspaceShortcutLayer.js";

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
			createRect({
				id: "b",
				transform: { x: 80 },
				bounds: { width: 50, height: 50 },
			}),
		],
	});
	return createCanvasIR({ id: "ir", pages: [page], now: () => FIXED_TS });
}

function Host({ options }: { options?: CanvasShortcutOptions }) {
	const rootRef = useRef<HTMLDivElement | null>(null);
	return (
		<div ref={rootRef} data-testid="ws-root">
			<WorkspaceShortcutLayer rootRef={rootRef} options={options} />
			<input data-testid="ws-input" />
		</div>
	);
}

function setup(options?: CanvasShortcutOptions) {
	const h = makeHarness({ ir: fixtureIR() });
	// Real history entry so undo has something to do.
	const moved = h.studioCtx.historyStore.getState().commit(h.ir, {
		type: "node.move",
		nodeId: "a",
		from: { x: 0, y: 0 },
		to: { x: 10, y: 0 },
	});
	h.setIR(moved);
	const sceneStore = createSceneStore({ initialIR: moved });
	h.studioCtx.sceneStore = sceneStore;
	const utils = render(
		<CanvasStudioContext.Provider value={h.studioCtx}>
			<Host options={options} />
		</CanvasStudioContext.Provider>,
	);
	const root = utils.getByTestId("ws-root");
	return { h, sceneStore, root, utils };
}

function nodeX(ir: CanvasIR): number {
	const found = findNode(ir, "a");
	if (!found) throw new Error("node a missing");
	return found.node.transform.x;
}

describe("WorkspaceShortcutLayer (A-04)", () => {
	it("runs undo/redo from anywhere under the workspace root", () => {
		const { h, sceneStore, root } = setup();
		fireEvent.keyDown(root, { key: "z", ctrlKey: true });
		expect(nodeX(sceneStore.getState().ir)).toBe(0);
		h.setIR(sceneStore.getState().ir);
		fireEvent.keyDown(root, { key: "z", ctrlKey: true, shiftKey: true });
		expect(nodeX(sceneStore.getState().ir)).toBe(10);
	});

	it("routes delete through the action layer (single batch, locked-safe)", () => {
		const { h, root } = setup();
		h.studioCtx.selectionStore.getState().setSelection(["a", "b"]);
		fireEvent.keyDown(root, { key: "Delete" });
		expect(h.studioCtx.commitBatch).toHaveBeenCalledTimes(1);
		expect(h.commits.map((c) => c.type)).toEqual([
			"node.delete",
			"node.delete",
		]);
		expect(h.studioCtx.selectionStore.getState().selectedIds).toHaveLength(0);
	});

	it("toggles lock via Ctrl/Cmd+Shift+L through the action layer", () => {
		const { h, root } = setup();
		h.studioCtx.selectionStore.getState().setSelection(["a"]);
		fireEvent.keyDown(root, { key: "l", ctrlKey: true, shiftKey: true });
		expect(h.commits.map((c) => c.type)).toEqual(["node.update"]);
		expect(
			(h.commits[0] as { patch?: { locked?: boolean } }).patch?.locked,
		).toBe(true);
		// Locking clears the selection.
		expect(h.studioCtx.selectionStore.getState().selectedIds).toHaveLength(0);
	});

	it("ignores keystrokes from form fields (typing guard)", () => {
		const { sceneStore, utils } = setup();
		fireEvent.keyDown(utils.getByTestId("ws-input"), {
			key: "z",
			ctrlKey: true,
		});
		expect(nodeX(sceneStore.getState().ir)).toBe(10);
	});

	it("skips events a lower layer already claimed via preventDefault", () => {
		const { sceneStore, root, utils } = setup();
		const input = utils.getByTestId("ws-input");
		input.addEventListener("keydown", (e) => e.preventDefault());
		// Dispatch on a non-editable child that preventDefaults first.
		const child = document.createElement("div");
		root.appendChild(child);
		child.addEventListener("keydown", (e) => e.preventDefault());
		fireEvent.keyDown(child, { key: "z", ctrlKey: true });
		expect(nodeX(sceneStore.getState().ir)).toBe(10);
	});

	it("plain-letter tool shortcuts switch the active tool (A-10)", () => {
		const { h, root } = setup();
		fireEvent.keyDown(root, { key: "r" });
		expect(h.studioCtx.toolStore.getState().activeTool).toBe("rect");
		fireEvent.keyDown(root, { key: "v" });
		expect(h.studioCtx.toolStore.getState().activeTool).toBe("select");
	});

	it("host extraBindings fire and can override built-ins", () => {
		const seen: string[] = [];
		const { sceneStore, root } = setup({
			extraBindings: [
				{
					id: "undo",
					combos: [{ key: "z", ctrlOrMeta: true }],
					labelKey: "host.undo",
					label: "Host undo",
					category: "edit",
					run: () => seen.push("host-undo"),
				},
			],
		});
		fireEvent.keyDown(root, { key: "z", ctrlKey: true });
		expect(seen).toEqual(["host-undo"]);
		// Built-in undo was replaced — the document did NOT change.
		expect(nodeX(sceneStore.getState().ir)).toBe(10);
	});
});
