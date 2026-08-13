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
	Shape: (props: Record<string, unknown>) => {
		calls.push({ type: "Shape", props });
		return null;
	},
}));

import { CanvasStudioContext } from "@/context/canvas-studio-context.js";
import type { CreateViewportStoreOptions } from "@/stores/viewport-store.js";
import { makeHarness } from "@/tools/__tests__/_tool-test-helpers.js";
import {
	computeGridGeometry,
	GRID_CHROME_GROUP_NAME,
	Grid,
	MAX_GRID_LINES,
} from "../Grid.js";

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

function shapes(): ElementCall[] {
	return calls.filter((c) => c.type === "Shape");
}

function tierByStroke(stroke: string): ElementCall | undefined {
	return shapes().find((c) => c.props.stroke === stroke);
}

const PAGE = { width: 400, height: 200 };

/**
 * K-8. Grid geometry is a pure function so the budget rules can be asserted
 * directly. This used to be checked through one rendered `<Line>` per grid
 * line — which pinned the very thing that made a fine grid on a large page
 * cost ~2000 Konva nodes on the same layer as the design content.
 */
describe("computeGridGeometry (FR-112)", () => {
	it("places page-bounded interior lines at gridSize spacing", () => {
		const g = computeGridGeometry(PAGE, 100, 1);
		// 400x200 page @ 100px: vertical x=100,200,300; horizontal y=100. Page
		// edges are the page border, not grid lines.
		expect(g.mainVertical).toEqual([100, 200, 300]);
		expect(g.mainHorizontal).toEqual([100]);
		expect(g.step).toBe(100);
		expect(g.subStep).toBeNull();
	});

	it("places sub-grid lines between main lines, skipping coinciding positions", () => {
		const g = computeGridGeometry(PAGE, 100, 2);
		expect(g.subStep).toBe(50);
		// x=100/200/300 coincide with main lines and are skipped.
		expect(g.subVertical).toEqual([50, 150, 250, 350]);
		expect(g.subHorizontal).toEqual([50, 150]);
		// Main lines are unaffected by the sub-grid.
		expect(g.mainVertical).toEqual([100, 200, 300]);
	});

	it("emits no sub-grid for subdivisions of 0 and 1", () => {
		for (const subdivisions of [0, 1]) {
			const g = computeGridGeometry(PAGE, 100, subdivisions);
			expect(g.subStep).toBeNull();
			expect(g.subVertical).toEqual([]);
			expect(g.subHorizontal).toEqual([]);
			expect(g.mainVertical).toHaveLength(3);
		}
	});

	it("coarsens the step to stay under the per-axis line budget", () => {
		// 1080 / 0.5 = 2160 lines per axis — over budget. Doubling: 0.5 → 1 →
		// 2 → 4 (1080 / 4 = 270 <= 512). Interior lines: 269 per axis.
		const g = computeGridGeometry({ width: 1080, height: 1080 }, 0.5, 1);
		expect(g.step).toBe(4);
		expect(g.mainVertical).toHaveLength(269);
		expect(g.mainVertical[0]).toBe(4);
		expect(g.mainVertical.length).toBeLessThanOrEqual(MAX_GRID_LINES);
	});

	it("drops the sub-grid before coarsening when only the sub-grid busts the budget", () => {
		const g = computeGridGeometry({ width: 1080, height: 1080 }, 8, 10);
		// Main grid fits (1080 / 8 = 135 <= 512) and is untouched…
		expect(g.step).toBe(8);
		expect(g.mainVertical).toHaveLength(134);
		// …but the sub-grid (step 0.8 → 1350 lines/axis) is skipped entirely.
		expect(g.subStep).toBeNull();
		expect(g.subVertical).toEqual([]);
	});
});

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

	it("wraps everything in a non-listening namespaced chrome group so export can exclude it", () => {
		renderGrid({ gridSize: 100 });
		const group = calls.find((c) => c.type === "Group");
		expect(group?.props).toMatchObject({
			name: GRID_CHROME_GROUP_NAME,
			listening: false,
		});
	});

	// The node-count guarantee itself: ONE Konva node per tier, regardless of
	// how many lines that tier draws.
	it("paints each tier as a single Shape, not one node per line", () => {
		renderGrid({ pageWidth: 1080, pageHeight: 1080, gridSize: 8 });
		// 1080/8 → 134 interior lines per axis, 268 lines total, 1 node.
		expect(shapes()).toHaveLength(1);
		expect(calls.filter((c) => c.type === "Line")).toHaveLength(0);
	});

	it("adds a second Shape for the sub-grid, painted below the main tier", () => {
		const { h } = renderGrid({ gridSize: 100, gridSubdivisions: 2 });
		const vs = h.studioCtx.viewportStore.getState();
		const all = shapes();
		expect(all).toHaveLength(2);
		// Sub-grid first so main lines paint on top at shared crossings.
		expect(all[0]?.props.stroke).toBe(vs.subGridColor);
		expect(all[1]?.props.stroke).toBe(vs.gridColor);
	});

	it("applies the store's grid + sub-grid colors and stroke widths", () => {
		renderGrid({
			gridSize: 100,
			gridSubdivisions: 2,
			gridColor: "#ff0000",
			subGridColor: "#00ff00",
		});
		expect(tierByStroke("#ff0000")?.props.strokeWidth).toBe(1);
		expect(tierByStroke("#00ff00")?.props.strokeWidth).toBe(0.5);
	});

	it("keeps lines one screen pixel via strokeWidth = 1/zoom", () => {
		renderGrid({ gridSize: 100, gridSubdivisions: 2, zoom: 2 });
		const widths = new Set(shapes().map((c) => c.props.strokeWidth));
		expect(widths).toEqual(new Set([1 / 2, 0.5 / 2]));
	});

	it("declares the page box so the Shape does not measure 0x0", () => {
		renderGrid({ pageWidth: 400, pageHeight: 200, gridSize: 100 });
		expect(shapes()[0]?.props).toMatchObject({
			width: 400,
			height: 200,
			listening: false,
			perfectDrawEnabled: false,
		});
	});

	// The painted result must be identical to the per-Line version: the
	// sceneFunc is the only place the positions are consumed now, so it is
	// driven against a recording context here.
	it("strokes exactly the computed line positions in one path", () => {
		renderGrid({ gridSize: 100 });
		const sceneFunc = shapes()[0]?.props.sceneFunc as (
			ctx: unknown,
			shape: unknown,
		) => void;
		expect(typeof sceneFunc).toBe("function");
		const ops: string[] = [];
		const recorder = {
			beginPath: () => ops.push("begin"),
			moveTo: (x: number, y: number) => ops.push(`move ${x},${y}`),
			lineTo: (x: number, y: number) => ops.push(`line ${x},${y}`),
			strokeShape: () => ops.push("stroke"),
		};
		const shape = {};
		sceneFunc(recorder, shape);
		expect(ops).toEqual([
			"begin",
			// verticals x=100,200,300 spanning the page height…
			"move 100,0",
			"line 100,200",
			"move 200,0",
			"line 200,200",
			"move 300,0",
			"line 300,200",
			// …then the single horizontal y=100 spanning the page width.
			"move 0,100",
			"line 400,100",
			"stroke",
		]);
	});
});
