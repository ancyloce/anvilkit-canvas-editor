import {
	type CanvasIR,
	type CanvasNodeReparentCommand,
	createCanvasIR,
	createGroup,
	createPage,
	createRect,
} from "@anvilkit/canvas-core";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { CanvasStudioContext } from "@/context/canvas-studio-context.js";
import { makeHarness } from "@/tools/__tests__/_tool-test-helpers.js";
import { LayerPanel } from "../LayerPanel.js";

afterEach(cleanup);

const FIXED_TS = "2026-05-20T00:00:00.000Z";

/** children (bottom-first): [a, b, g(gc), locked1] — panel renders top-first. */
function fixtureIR(): CanvasIR {
	const page = createPage({ id: "p1" });
	page.root = createGroup({
		id: "p1-root",
		bounds: page.root.bounds,
		children: [
			createRect({ id: "a", bounds: { width: 10, height: 10 } }),
			createRect({ id: "b", bounds: { width: 10, height: 10 } }),
			createGroup({
				id: "g",
				children: [createRect({ id: "gc", bounds: { width: 10, height: 10 } })],
			}),
			{
				...createRect({ id: "locked1", bounds: { width: 10, height: 10 } }),
				locked: true,
			},
		],
	});
	return createCanvasIR({ id: "ir", pages: [page], now: () => FIXED_TS });
}

function setup() {
	const h = makeHarness({ ir: fixtureIR() });
	render(
		<CanvasStudioContext.Provider value={h.studioCtx}>
			<LayerPanel />
		</CanvasStudioContext.Provider>,
	);
	return h;
}

const dt = () => ({ setData: () => undefined, effectAllowed: "" });

describe("LayerPanel selection model (FR-051)", () => {
	it("Ctrl/Cmd+click toggles; Shift+click range-selects across rows", () => {
		const h = setup();
		fireEvent.click(screen.getByTestId("layer-row-a"));
		expect(h.studioCtx.selectionStore.getState().selectedIds).toEqual(["a"]);
		fireEvent.click(screen.getByTestId("layer-row-g"), { ctrlKey: true });
		expect(h.studioCtx.selectionStore.getState().selectedIds).toEqual([
			"a",
			"g",
		]);
		// Range from anchor g → b: panel order is locked1, g, gc, b, a.
		fireEvent.click(screen.getByTestId("layer-row-b"), { shiftKey: true });
		expect(h.studioCtx.selectionStore.getState().selectedIds).toEqual([
			"g",
			"gc",
			"b",
		]);
	});
});

describe("LayerPanel rename (FR-051)", () => {
	it("double-click opens an input; Enter commits node.update {name}", () => {
		const h = setup();
		fireEvent.doubleClick(screen.getByTestId("layer-row-a"));
		const input = screen.getByTestId("layer-rename-a") as HTMLInputElement;
		fireEvent.change(input, { target: { value: "Hero shape" } });
		fireEvent.keyDown(input, { key: "Enter" });
		expect(h.commits).toHaveLength(1);
		expect(h.commits[0]).toMatchObject({
			type: "node.update",
			nodeId: "a",
			patch: { name: "Hero shape" },
		});
	});

	it("Escape cancels without committing", () => {
		const h = setup();
		fireEvent.doubleClick(screen.getByTestId("layer-row-b"));
		const input = screen.getByTestId("layer-rename-b");
		fireEvent.keyDown(input, { key: "Escape" });
		expect(h.commits).toHaveLength(0);
		expect(screen.queryByTestId("layer-rename-b")).toBeNull();
	});
});

describe("LayerPanel drag and drop (FR-052)", () => {
	it("dropping a leaf onto a group (inside) emits node.reparent to the top", () => {
		const h = setup();
		const rowA = screen.getByTestId("layer-row-a");
		const rowG = screen.getByTestId("layer-row-g");
		fireEvent.dragStart(rowA, { dataTransfer: dt() });
		fireEvent.dragOver(rowG, { dataTransfer: dt() });
		expect(rowG.getAttribute("data-drop-zone")).toBe("inside");
		expect(rowG.getAttribute("data-drop-valid")).toBe("true");
		fireEvent.drop(rowG, { dataTransfer: dt() });
		const cmd = h.commits[0] as CanvasNodeReparentCommand;
		expect(cmd).toMatchObject({
			type: "node.reparent",
			nodeId: "a",
			toParentId: "g",
			toIndex: 1,
		});
		expect(h.studioCtx.selectionStore.getState().selectedIds).toEqual(["a"]);
	});

	it("dropping onto a leaf reorders within the parent (visual before = higher index)", () => {
		const h = setup();
		fireEvent.dragStart(screen.getByTestId("layer-row-a"), {
			dataTransfer: dt(),
		});
		const rowB = screen.getByTestId("layer-row-b");
		fireEvent.dragOver(rowB, { dataTransfer: dt() });
		expect(rowB.getAttribute("data-drop-zone")).toBe("before");
		fireEvent.drop(rowB, { dataTransfer: dt() });
		const cmd = h.commits[0] as CanvasNodeReparentCommand;
		// children minus a = [b, g, locked1]; before-b (visually above) → index 1.
		expect(cmd).toMatchObject({
			type: "node.reparent",
			nodeId: "a",
			toParentId: "p1-root",
			toIndex: 1,
		});
	});

	it("blocks dropping a container into its own descendant", () => {
		const h = setup();
		fireEvent.dragStart(screen.getByTestId("layer-row-g"), {
			dataTransfer: dt(),
		});
		const rowGc = screen.getByTestId("layer-row-gc");
		fireEvent.dragOver(rowGc, { dataTransfer: dt() });
		expect(rowGc.getAttribute("data-drop-valid")).toBe("false");
		fireEvent.drop(rowGc, { dataTransfer: dt() });
		expect(h.commits).toHaveLength(0);
	});

	it("locked rows are not draggable and are filtered from multi-drags", () => {
		const h = setup();
		expect(
			screen.getByTestId("layer-row-locked1").getAttribute("draggable"),
		).toBe("false");
		h.studioCtx.selectionStore.getState().setSelection(["a", "locked1"]);
		fireEvent.dragStart(screen.getByTestId("layer-row-a"), {
			dataTransfer: dt(),
		});
		fireEvent.dragOver(screen.getByTestId("layer-row-g"), {
			dataTransfer: dt(),
		});
		fireEvent.drop(screen.getByTestId("layer-row-g"), { dataTransfer: dt() });
		const reparented = h.commits.map(
			(c) => (c as CanvasNodeReparentCommand).nodeId,
		);
		expect(reparented).toEqual(["a"]);
	});
});
