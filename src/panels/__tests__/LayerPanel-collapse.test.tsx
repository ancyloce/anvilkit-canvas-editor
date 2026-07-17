import {
	type CanvasIR,
	createCanvasIR,
	createGroup,
	createPage,
	createRect,
} from "@anvilkit/canvas-core";
import {
	act,
	cleanup,
	fireEvent,
	render,
	screen,
} from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { CanvasStudioContext } from "@/context/canvas-studio-context.js";
import { makeHarness } from "@/tools/__tests__/_tool-test-helpers.js";
import { LayerPanel } from "../LayerPanel.js";

afterEach(cleanup);

const FIXED_TS = "2026-05-20T00:00:00.000Z";

/**
 * root (bottom-first): [rect-a, g(=[gx, inner(=[deep])])].
 * Panel renders top-first: g, inner, deep, gx, rect-a.
 */
function nestedIR(): CanvasIR {
	const ir = createCanvasIR({
		id: "ir-1",
		pages: [createPage({ id: "p1" })],
		now: () => FIXED_TS,
	});
	const firstPage = ir.pages[0];
	if (!firstPage) throw new Error("expected at least one page");
	firstPage.root.children = [
		createRect({ id: "rect-a", bounds: { width: 10, height: 10 } }),
		createGroup({
			id: "g",
			bounds: { width: 60, height: 60 },
			children: [
				createRect({ id: "gx", bounds: { width: 10, height: 10 } }),
				createGroup({
					id: "inner",
					bounds: { width: 30, height: 30 },
					children: [
						createRect({ id: "deep", bounds: { width: 5, height: 5 } }),
					],
				}),
			],
		}),
	];
	return ir;
}

function setup() {
	const h = makeHarness({ ir: nestedIR() });
	render(
		<CanvasStudioContext.Provider value={h.studioCtx}>
			<LayerPanel />
		</CanvasStudioContext.Provider>,
	);
	return h;
}

const dt = () => ({ setData: () => undefined, effectAllowed: "" });

describe("LayerPanel collapse/expand (FR-050)", () => {
	it("collapsing a container hides its descendants from the rendered list", () => {
		setup();
		expect(screen.queryByTestId("layer-row-inner")).not.toBeNull();
		expect(screen.queryByTestId("layer-row-deep")).not.toBeNull();
		expect(screen.queryByTestId("layer-row-gx")).not.toBeNull();
		fireEvent.click(screen.getByTestId("layer-row-g-toggle"));
		// g's own row stays; its descendants (inner, deep, gx) are folded out.
		expect(screen.queryByTestId("layer-row-g")).not.toBeNull();
		expect(screen.queryByTestId("layer-row-inner")).toBeNull();
		expect(screen.queryByTestId("layer-row-deep")).toBeNull();
		expect(screen.queryByTestId("layer-row-gx")).toBeNull();
		// A sibling outside the collapsed subtree is unaffected.
		expect(screen.queryByTestId("layer-row-rect-a")).not.toBeNull();
	});

	it("expanding restores the folded descendants", () => {
		setup();
		const toggle = screen.getByTestId("layer-row-g-toggle");
		fireEvent.click(toggle);
		expect(screen.queryByTestId("layer-row-inner")).toBeNull();
		fireEvent.click(toggle);
		expect(screen.queryByTestId("layer-row-inner")).not.toBeNull();
		expect(screen.queryByTestId("layer-row-deep")).not.toBeNull();
		expect(screen.queryByTestId("layer-row-gx")).not.toBeNull();
	});

	it("collapsing a nested container only folds its own subtree", () => {
		setup();
		fireEvent.click(screen.getByTestId("layer-row-inner-toggle"));
		// inner's own child (deep) is hidden…
		expect(screen.queryByTestId("layer-row-deep")).toBeNull();
		// …but inner's row and its sibling gx remain visible.
		expect(screen.queryByTestId("layer-row-inner")).not.toBeNull();
		expect(screen.queryByTestId("layer-row-gx")).not.toBeNull();
	});

	it("toggle exposes aria-expanded on both the button and the treeitem, defaulting to expanded", () => {
		setup();
		const toggle = screen.getByTestId("layer-row-g-toggle");
		const row = screen.getByTestId("layer-row-g");
		expect(toggle.getAttribute("aria-expanded")).toBe("true");
		expect(row.getAttribute("aria-expanded")).toBe("true");
		fireEvent.click(toggle);
		expect(toggle.getAttribute("aria-expanded")).toBe("false");
		expect(row.getAttribute("aria-expanded")).toBe("false");
	});

	it("a leaf row has no toggle control and no aria-expanded", () => {
		setup();
		expect(screen.queryByTestId("layer-row-rect-a-toggle")).toBeNull();
		expect(
			screen.getByTestId("layer-row-rect-a").getAttribute("aria-expanded"),
		).toBeNull();
	});

	it("clicking the toggle does not change selection (click does not bubble to the row)", () => {
		const h = setup();
		fireEvent.click(screen.getByTestId("layer-row-g-toggle"));
		expect(h.studioCtx.selectionStore.getState().selectedIds).toEqual([]);
	});

	it("selecting a canvas-side node inside multiple collapsed ancestors auto-expands all of them and reveals it", () => {
		const h = setup();
		// Collapse "inner" first (hides "deep"), then collapse "g" (which now
		// also hides "inner" and "gx").
		fireEvent.click(screen.getByTestId("layer-row-inner-toggle"));
		fireEvent.click(screen.getByTestId("layer-row-g-toggle"));
		expect(screen.queryByTestId("layer-row-inner")).toBeNull();
		expect(screen.queryByTestId("layer-row-deep")).toBeNull();
		// A canvas click (not a panel click) selects the deeply-nested node.
		act(() => {
			h.studioCtx.selectionStore.getState().setSelection(["deep"]);
		});
		// Both ancestors are auto-expanded and "deep" reappears.
		expect(screen.queryByTestId("layer-row-deep")).not.toBeNull();
		expect(
			screen.getByTestId("layer-row-g-toggle").getAttribute("aria-expanded"),
		).toBe("true");
		expect(
			screen
				.getByTestId("layer-row-inner-toggle")
				.getAttribute("aria-expanded"),
		).toBe("true");
	});

	it("collapse state does not change rename/lock behavior on still-visible rows", () => {
		const h = setup();
		// Collapse "g" — gx/inner/deep fold away but "g" and "rect-a" stay visible.
		fireEvent.click(screen.getByTestId("layer-row-g-toggle"));
		fireEvent.click(screen.getByTestId("layer-row-g-lock"));
		expect(h.commits).toHaveLength(1);
		expect(h.commits[0]).toMatchObject({
			type: "node.update",
			nodeId: "g",
			patch: { locked: true },
		});
		fireEvent.doubleClick(screen.getByTestId("layer-row-rect-a"));
		const input = screen.getByTestId("layer-rename-rect-a") as HTMLInputElement;
		fireEvent.change(input, { target: { value: "Renamed" } });
		fireEvent.keyDown(input, { key: "Enter" });
		expect(h.commits).toHaveLength(2);
		expect(h.commits[1]).toMatchObject({
			type: "node.update",
			nodeId: "rect-a",
			patch: { name: "Renamed" },
		});
	});

	it("collapse state does not change drag-and-drop onto a still-visible (collapsed) container row", () => {
		const h = setup();
		fireEvent.click(screen.getByTestId("layer-row-g-toggle"));
		const rowA = screen.getByTestId("layer-row-rect-a");
		const rowG = screen.getByTestId("layer-row-g");
		fireEvent.dragStart(rowA, { dataTransfer: dt() });
		fireEvent.dragOver(rowG, { dataTransfer: dt() });
		expect(rowG.getAttribute("data-drop-zone")).toBe("inside");
		expect(rowG.getAttribute("data-drop-valid")).toBe("true");
		fireEvent.drop(rowG, { dataTransfer: dt() });
		expect(h.commits).toHaveLength(1);
		expect(h.commits[0]).toMatchObject({
			type: "node.reparent",
			nodeId: "rect-a",
			toParentId: "g",
		});
	});
});
