import {
	type CanvasIR,
	createCanvasIR,
	createGroup,
	createPage,
	createRect,
	createText,
} from "@anvilkit/canvas-core";
import { cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { CanvasStudioContext } from "@/context/canvas-studio-context.js";
import { makeHarness } from "@/tools/__tests__/_tool-test-helpers.js";
import { LayerPanel } from "../LayerPanel.js";
import {
	EMPTY_LAYER_FILTER,
	findLayers,
	matchesLayerFilter,
	nodeTextContent,
	revealLayer,
} from "../layer-filter.js";

afterEach(cleanup);

function makeIR(): CanvasIR {
	const p1 = createPage({
		id: "p1",
		root: createGroup({
			children: [
				createRect({
					id: "hero",
					name: "Hero",
					bounds: { width: 10, height: 10 },
				}),
				{
					...createRect({
						id: "hidden-rect",
						name: "Backdrop",
						bounds: { width: 10, height: 10 },
					}),
					visible: false,
				},
				{
					...createRect({
						id: "locked-rect",
						name: "Frame border",
						bounds: { width: 10, height: 10 },
					}),
					locked: true,
				},
			],
		}),
	});
	const p2 = createPage({
		id: "p2",
		name: "Back page",
		root: createGroup({
			children: [
				createText({
					id: "headline",
					text: "Grand Opening Sale",
					fontFamily: "Inter",
					fontSize: 24,
					fill: "#000",
					bounds: { width: 100, height: 30 },
				}),
			],
		}),
	});
	return createCanvasIR({ id: "doc", pages: [p1, p2] });
}

describe("layer filter predicates (FR-053)", () => {
	it("matches by name, kind, visibility, and lock — never mutating", () => {
		const ir = makeIR();
		const page = ir.pages[0];
		if (!page) throw new Error("no page");
		const [hero, hidden, locked] = page.root.children;
		if (!hero || !hidden || !locked) throw new Error("fixture");
		expect(
			matchesLayerFilter(hero, { ...EMPTY_LAYER_FILTER, query: "hero" }),
		).toBe(true);
		expect(
			matchesLayerFilter(hero, { ...EMPTY_LAYER_FILTER, kind: "text" }),
		).toBe(false);
		expect(
			matchesLayerFilter(hidden, {
				...EMPTY_LAYER_FILTER,
				visibility: "hidden",
			}),
		).toBe(true);
		expect(
			matchesLayerFilter(hero, { ...EMPTY_LAYER_FILTER, visibility: "hidden" }),
		).toBe(false);
		expect(
			matchesLayerFilter(locked, { ...EMPTY_LAYER_FILTER, lock: "locked" }),
		).toBe(true);
		const before = JSON.stringify(ir);
		findLayers(ir, { ...EMPTY_LAYER_FILTER, query: "e" });
		expect(JSON.stringify(ir)).toBe(before);
	});

	it("searches text content (FR-191) and extracts rich-text spans", () => {
		const ir = makeIR();
		const results = findLayers(ir, { ...EMPTY_LAYER_FILTER, query: "opening" });
		expect(results.map((r) => r.node.id)).toEqual(["headline"]);
		expect(results[0]?.pageId).toBe("p2");
		expect(nodeTextContent(results[0]?.node ?? ({} as never))).toContain(
			"Grand Opening",
		);
	});

	it("revealLayer switches page, selects, and leaves history untouched", () => {
		const h = makeHarness({ ir: makeIR() });
		const result = findLayers(h.studioCtx.getIR(), {
			...EMPTY_LAYER_FILTER,
			query: "opening",
		})[0];
		if (!result) throw new Error("no result");
		revealLayer(h.studioCtx, result);
		expect(h.studioCtx.pagesStore.getState().activePageId).toBe("p2");
		expect(h.studioCtx.selectionStore.getState().selectedIds).toEqual([
			"headline",
		]);
		expect(h.commits).toHaveLength(0);
	});
});

describe("LayerPanel search UI (C-08)", () => {
	function mount() {
		const h = makeHarness({ ir: makeIR() });
		const view = render(
			<CanvasStudioContext.Provider
				value={{ ...h.studioCtx, ir: h.studioCtx.getIR() }}
			>
				<LayerPanel />
			</CanvasStudioContext.Provider>,
		);
		return { h, view };
	}

	it("filters rows non-destructively and disables dragging while filtered", () => {
		const { view } = mount();
		expect(view.getByTestId("layer-row-hero")).toBeDefined();
		fireEvent.change(view.getByTestId("layer-search"), {
			target: { value: "backdrop" },
		});
		expect(view.queryByTestId("layer-row-hero")).toBeNull();
		const row = view.getByTestId("layer-row-hidden-rect");
		expect(row.getAttribute("draggable")).toBe("false");
	});

	it("document scope lists cross-page results and reveals on click", () => {
		const { h, view } = mount();
		fireEvent.change(view.getByTestId("layer-search"), {
			target: { value: "opening" },
		});
		fireEvent.click(view.getByTestId("layer-search-scope"));
		const result = view.getByTestId("layer-find-result-headline");
		expect(result.textContent).toContain("Back page");
		fireEvent.click(result);
		expect(h.studioCtx.pagesStore.getState().activePageId).toBe("p2");
		expect(h.studioCtx.selectionStore.getState().selectedIds).toEqual([
			"headline",
		]);
	});

	it("shows the no-matches empty state for a fruitless filter", () => {
		const { view } = mount();
		fireEvent.change(view.getByTestId("layer-search"), {
			target: { value: "zzz-nothing" },
		});
		expect(view.getByTestId("layer-panel-empty").textContent).toContain(
			"No layers match",
		);
	});
});
