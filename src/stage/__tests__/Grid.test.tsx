import {
	type CanvasIR,
	createCanvasIR,
	createPage,
} from "@anvilkit/canvas-core";
import { cleanup, render } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

type ElementCall = { type: string; props: Record<string, unknown> };
const calls: ElementCall[] = [];

vi.mock("react-konva", () => ({
	Group: ({
		children,
		...props
	}: Record<string, unknown> & { children?: ReactNode }) => {
		calls.push({ type: "Group", props });
		return <div data-testid="Group">{children}</div>;
	},
	Line: (props: Record<string, unknown>) => {
		calls.push({ type: "Line", props });
		return null;
	},
}));

import { CanvasStudioContext } from "@/context/canvas-studio-context.js";
import type { CreateViewportStoreOptions } from "@/stores/viewport-store.js";
import { makeHarness } from "@/tools/__tests__/_tool-test-helpers.js";
import { Grid, MAX_GRID_LINES } from "../Grid.js";

afterEach(() => {
	cleanup();
	calls.length = 0;
});

const FIXED_TS = "2026-05-20T00:00:00.000Z";

function irWithPage(width: number, height: number): CanvasIR {
	const page = createPage({ id: "p1", size: { width, height } });
	return createCanvasIR({ id: "ir", pages: [page], now: () => FIXED_TS });
}

interface RenderGridOptions extends CreateViewportStoreOptions {
	pageWidth?: number;
	pageHeight?: number;
	activePageId?: string;
}

function renderGrid(opts: RenderGridOptions = {}) {
	const {
		pageWidth = 400,
		pageHeight = 200,
		activePageId = "p1",
		...viewport
	} = opts;
	const ir = irWithPage(pageWidth, pageHeight);
	const h = makeHarness({ ir });
	// The harness disables the grid for tool tests; grid tests opt back in and
	// apply per-test viewport settings through the real setters.
	const vs = h.studioCtx.viewportStore.getState();
	vs.setGridEnabled(viewport.gridEnabled ?? true);
	if (viewport.gridSize !== undefined) vs.setGridSize(viewport.gridSize);
	if (viewport.gridSubdivisions !== undefined)
		vs.setGridSubdivisions(viewport.gridSubdivisions);
	if (viewport.gridColor !== undefined) vs.setGridColor(viewport.gridColor);
	if (viewport.subGridColor !== undefined)
		vs.setSubGridColor(viewport.subGridColor);
	if (viewport.zoom !== undefined) vs.setZoom(viewport.zoom);
	const view = render(
		<CanvasStudioContext.Provider value={{ ...h.studioCtx, ir, activePageId }}>
			<Grid />
		</CanvasStudioContext.Provider>,
	);
	return { h, view };
}

function lines(): ElementCall[] {
	return calls.filter((c) => c.type === "Line");
}

function linesByStroke(stroke: string): ElementCall[] {
	return lines().filter((c) => c.props.stroke === stroke);
}

describe("Grid (FR-112)", () => {
	it("renders nothing when gridEnabled is false", () => {
		renderGrid({ gridEnabled: false });
		expect(calls).toHaveLength(0);
	});

	it("renders nothing when the active page is missing", () => {
		renderGrid({ activePageId: "not-a-page" });
		expect(calls).toHaveLength(0);
	});

	it("renders nothing when gridSize <= 0", () => {
		renderGrid({ gridSize: 0 });
		expect(calls).toHaveLength(0);
	});

	it("wraps everything in a non-listening 'grid' group so export can exclude it", () => {
		renderGrid({ gridSize: 100 });
		const group = calls.find((c) => c.type === "Group");
		expect(group?.props).toMatchObject({ name: "grid", listening: false });
	});

	it("renders page-bounded interior lines at gridSize spacing", () => {
		const { h } = renderGrid({ gridSize: 100 });
		const gridColor = h.studioCtx.viewportStore.getState().gridColor;
		const main = linesByStroke(gridColor);
		// 400x200 page @ 100px: vertical x=100,200,300; horizontal y=100. Page
		// edges are the page border, not grid lines.
		expect(main.map((c) => c.props.points)).toEqual([
			[100, 0, 100, 200],
			[200, 0, 200, 200],
			[300, 0, 300, 200],
			[0, 100, 400, 100],
		]);
		for (const line of main) {
			expect(line.props.listening).toBe(false);
			expect(line.props.perfectDrawEnabled).toBe(false);
		}
	});

	it("renders sub-grid lines between main lines, skipping coinciding positions", () => {
		const { h } = renderGrid({ gridSize: 100, gridSubdivisions: 2 });
		const vs = h.studioCtx.viewportStore.getState();
		const sub = linesByStroke(vs.subGridColor);
		// Sub-step 50: x=50,150,250,350 (100/200/300 coincide with main lines and
		// are skipped), y=50,150.
		expect(sub.map((c) => c.props.points)).toEqual([
			[50, 0, 50, 200],
			[150, 0, 150, 200],
			[250, 0, 250, 200],
			[350, 0, 350, 200],
			[0, 50, 400, 50],
			[0, 150, 400, 150],
		]);
		// Main lines are unaffected by the sub-grid.
		expect(linesByStroke(vs.gridColor)).toHaveLength(4);
	});

	it("gridSubdivisions of 0 and 1 render no sub-grid", () => {
		for (const subdivisions of [0, 1]) {
			calls.length = 0;
			cleanup();
			const { h } = renderGrid({
				gridSize: 100,
				gridSubdivisions: subdivisions,
			});
			const vs = h.studioCtx.viewportStore.getState();
			expect(linesByStroke(vs.subGridColor)).toHaveLength(0);
			expect(linesByStroke(vs.gridColor)).toHaveLength(4);
		}
	});

	it("applies the store's grid + sub-grid colors and stroke widths", () => {
		renderGrid({
			gridSize: 100,
			gridSubdivisions: 2,
			gridColor: "#ff0000",
			subGridColor: "#00ff00",
		});
		const main = linesByStroke("#ff0000");
		const sub = linesByStroke("#00ff00");
		expect(main.length).toBeGreaterThan(0);
		expect(sub.length).toBeGreaterThan(0);
		for (const line of main) expect(line.props.strokeWidth).toBe(1);
		for (const line of sub) expect(line.props.strokeWidth).toBe(0.5);
	});

	it("keeps lines one screen pixel via strokeWidth = 1/zoom", () => {
		renderGrid({ gridSize: 100, gridSubdivisions: 2, zoom: 2 });
		const widths = new Set(lines().map((c) => c.props.strokeWidth));
		expect(widths).toEqual(new Set([1 / 2, 0.5 / 2]));
	});

	it("coarsens the step to stay under the per-axis line budget (1080px page, 0.5px grid)", () => {
		const { h } = renderGrid({
			pageWidth: 1080,
			pageHeight: 1080,
			gridSize: 0.5,
		});
		const vs = h.studioCtx.viewportStore.getState();
		const main = linesByStroke(vs.gridColor);
		// 1080 / 0.5 = 2160 lines per axis — over budget. Doubling: 0.5 → 1 →
		// 2 → 4 (1080 / 4 = 270 <= 512). Interior lines: 269 per axis.
		expect(main).toHaveLength(269 * 2);
		const verticals = main.filter(
			(c) =>
				(c.props.points as number[])[1] === 0 &&
				(c.props.points as number[])[3] === 1080 &&
				(c.props.points as number[])[0] === (c.props.points as number[])[2],
		);
		expect(verticals[0]?.props.points).toEqual([4, 0, 4, 1080]);
		expect(verticals.length).toBeLessThanOrEqual(MAX_GRID_LINES);
	});

	it("drops the sub-grid before coarsening when only the sub-grid busts the budget", () => {
		const { h } = renderGrid({
			pageWidth: 1080,
			pageHeight: 1080,
			gridSize: 8,
			gridSubdivisions: 10,
		});
		const vs = h.studioCtx.viewportStore.getState();
		// Main grid fits (1080 / 8 = 135 <= 512) and is untouched…
		expect(linesByStroke(vs.gridColor)).toHaveLength(134 * 2);
		// …but the sub-grid (step 0.8 → 1350 lines/axis) is skipped entirely.
		expect(linesByStroke(vs.subGridColor)).toHaveLength(0);
	});
});
