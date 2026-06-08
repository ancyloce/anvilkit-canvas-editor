import {
	createCanvasIR,
	createGroup,
	createPage,
	createRect,
} from "@anvilkit/canvas-core";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import {
	CanvasStudioContext,
	type CanvasStudioContextValue,
} from "../../context/canvas-studio-context.js";
import { createFocusStore } from "../../stores/focus-store.js";
import { createSelectionStore } from "../../stores/selection-store.js";
import { SceneAccessibilityTree } from "../SceneAccessibilityTree.js";

afterEach(cleanup);

function makeCtx() {
	const page = createPage({ id: "p1" });
	page.root = createGroup({
		id: "p1-root",
		bounds: page.root.bounds,
		children: [
			createRect({ id: "a", bounds: { width: 10, height: 10 } }),
			createGroup({
				id: "g",
				bounds: { width: 0, height: 0 },
				children: [createRect({ id: "b", bounds: { width: 5, height: 5 } })],
			}),
		],
	});
	const ir = createCanvasIR({ id: "ir-1", pages: [page], now: () => "T" });
	const focusStore = createFocusStore();
	const selectionStore = createSelectionStore();
	const ctx = {
		ir,
		activePageId: "p1",
		focusStore,
		selectionStore,
	} as unknown as CanvasStudioContextValue;
	return { ctx, focusStore, selectionStore };
}

function mountTree(ctx: CanvasStudioContextValue) {
	return render(
		<CanvasStudioContext.Provider value={ctx}>
			<SceneAccessibilityTree />
		</CanvasStudioContext.Provider>,
	);
}

describe("SceneAccessibilityTree", () => {
	it("renders a role=tree with one treeitem per node (pre-order)", () => {
		const { ctx } = makeCtx();
		mountTree(ctx);
		expect(screen.getByRole("tree")).toBeTruthy();
		expect(screen.getAllByRole("treeitem")).toHaveLength(3); // a, g, b
	});

	it("uses roving tabindex (first item focusable when nothing focused)", () => {
		const { ctx } = makeCtx();
		mountTree(ctx);
		const items = screen.getAllByRole("treeitem");
		expect(items[0]?.getAttribute("tabindex")).toBe("0");
		expect(items[1]?.getAttribute("tabindex")).toBe("-1");
	});

	it("clicking a treeitem selects its node", () => {
		const { ctx, selectionStore } = makeCtx();
		mountTree(ctx);
		const g = screen.getAllByRole("treeitem")[1];
		if (!g) throw new Error("missing item");
		fireEvent.click(g);
		expect(selectionStore.getState().selectedIds).toContain("g");
	});

	it("Enter selects, ArrowDown moves roving focus in pre-order", () => {
		const { ctx, focusStore, selectionStore } = makeCtx();
		mountTree(ctx);
		const first = screen.getAllByRole("treeitem")[0];
		if (!first) throw new Error("missing item");
		fireEvent.keyDown(first, { key: "Enter" });
		expect(selectionStore.getState().selectedIds).toContain("a");
		fireEvent.keyDown(first, { key: "ArrowDown" });
		expect(focusStore.getState().focusedId).toBe("g");
	});
});
