import {
	type CanvasNode,
	createCanvasIR,
	createFrame,
	createGroup,
	createPage,
	createRect,
	insertNode,
} from "@anvilkit/canvas-core";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import {
	CanvasStudioContext,
	type CanvasStudioContextValue,
} from "@/context/canvas-studio-context.js";
import { createFieldPreviewStore } from "@/stores/field-preview-store.js";
import { createFocusStore } from "@/stores/focus-store.js";
import { createResolvedDocumentStore } from "@/stores/resolved-document-store.js";
import { createSceneStore } from "@/stores/scene-store.js";
import { createSelectionStore } from "@/stores/selection-store.js";
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

	// Konva paints to <canvas>, so this tree is the ONLY thing a screen reader
	// sees. Recursing only into groups hid every node inside a frame from AT.
	it("exposes frame children as nested treeitems", () => {
		const page = createPage({ id: "p1" });
		page.root = createGroup({
			id: "p1-root",
			bounds: page.root.bounds,
			children: [
				createFrame({
					id: "f",
					bounds: { width: 100, height: 100 },
					clip: true,
					children: [
						createRect({ id: "inner", bounds: { width: 5, height: 5 } }),
					],
				}),
			],
		});
		const ctx = {
			ir: createCanvasIR({ id: "ir-1", pages: [page], now: () => "T" }),
			activePageId: "p1",
			focusStore: createFocusStore(),
			selectionStore: createSelectionStore(),
		} as unknown as CanvasStudioContextValue;
		mountTree(ctx);
		const items = screen.getAllByRole("treeitem");
		expect(items).toHaveLength(2); // f, inner
		expect(items[1]?.getAttribute("aria-level")).toBe("2");
	});

	// T-M3-09 (TS-39): with the resolved store, traversal comes from the
	// resolved tree's childIds — flow order by construction.
	it("builds from the resolved view when the store is present", () => {
		const frame: CanvasNode = {
			...createFrame({
				id: "f1",
				name: "Card",
				bounds: { width: 200, height: 100 },
			}),
			autoLayout: {
				version: 1,
				direction: "horizontal",
				padding: { top: 0, right: 0, bottom: 0, left: 0 },
				gap: 10,
				primaryAlign: "start",
				crossAlign: "start",
			},
			children: [
				createRect({
					id: "r1",
					name: "First",
					bounds: { width: 40, height: 20 },
				}),
				createRect({
					id: "r2",
					name: "Second",
					bounds: { width: 40, height: 20 },
				}),
			],
		} as CanvasNode;
		const page = createPage({ id: "p1" });
		let ir = createCanvasIR({ id: "ir-1", pages: [page], now: () => "T" });
		ir = insertNode(ir, { parentId: page.root.id, node: frame });

		const sceneStore = createSceneStore({ initialIR: ir });
		const fieldPreviewStore = createFieldPreviewStore();
		const resolvedDocumentStore = createResolvedDocumentStore({
			sceneStore,
			fieldPreviewStore,
		});
		const disconnect = resolvedDocumentStore.connect();
		try {
			const ctx = {
				ir,
				activePageId: "p1",
				focusStore: createFocusStore(),
				selectionStore: createSelectionStore(),
				resolvedDocumentStore,
			} as unknown as CanvasStudioContextValue;
			mountTree(ctx);
			const items = screen.getAllByRole("treeitem");
			// Pre-order over the RESOLVED tree: frame, then its flow children.
			expect(items.map((el) => el.textContent)).toEqual([
				"Card",
				"First",
				"Second",
			]);
			expect(items[0]?.getAttribute("aria-level")).toBe("1");
			expect(items[1]?.getAttribute("aria-level")).toBe("2");
			// Order equals the resolved flow order, not merely the raw array.
			const view = resolvedDocumentStore.getState().view;
			expect(view.getChildren("f1").map((r) => r.sourceNodeId)).toEqual([
				"r1",
				"r2",
			]);
		} finally {
			disconnect();
		}
	});
});
