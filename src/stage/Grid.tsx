"use client";

import { useSyncExternalStore } from "react";
import { Group, Line } from "react-konva";
import { useCanvasStudio } from "../context/canvas-studio-context.js";

/**
 * Per-axis budget for grid lines (main and sub-grid counted separately). See
 * the coarsening strategy note on {@link Grid}.
 */
export const MAX_GRID_LINES = 512;

/**
 * Konva name for the chrome group below, namespaced so it can never collide
 * with a user-authored `CanvasNode.id` (which `CanvasNodeRenderer` also uses
 * as a Konva `name` — see `commonProps`). A bare `"grid"` name previously
 * meant a design that happened to have a node id of `"grid"` got silently
 * hidden by `export-stage.ts`'s chrome-hiding pass (E-13); IR ids are
 * untrusted (looseObject/hostile-peer by design), so this must not be a
 * plausible id.
 */
export const GRID_CHROME_GROUP_NAME = "ak-chrome-grid";

/**
 * Interior line positions for one axis: multiples of `step` strictly between
 * 0 and `extent` (the page edges themselves are the page border, not grid
 * lines). Index-based so fractional steps don't accumulate float error.
 * `skipEvery` drops every Nth position (sub-grid positions that coincide with
 * a main line).
 */
function linePositions(
	extent: number,
	step: number,
	skipEvery?: number,
): number[] {
	const positions: number[] = [];
	const epsilon = step / 1e6;
	for (let i = 1; i * step < extent - epsilon; i += 1) {
		if (skipEvery !== undefined && i % skipEvery === 0) continue;
		positions.push(i * step);
	}
	return positions;
}

/**
 * FR-112 grid overlay for the LIVE stage. Renders page-bounded main lines
 * every `gridSize` px and (when `gridSubdivisions > 1`) sub-lines at
 * `gridSize / gridSubdivisions` spacing, in page coordinates — the stage
 * transform applies zoom/pan, and `strokeWidth = 1 / zoom` keeps the lines
 * one screen pixel like `GuideLayoutOverlay`'s guides. Visibility
 * (`gridEnabled`) is INDEPENDENT of snapping (`snapToGridEnabled`) — hiding
 * the grid does not turn grid snap off (see `viewport-store.ts`).
 *
 * PERFORMANCE — line-count budget: one Konva `<Line>` per grid line is the
 * house style (page-bounded Line lists, not a single sceneFunc Shape), so the
 * node count must stay bounded for tiny grid sizes on large pages. Strategy:
 * with `step = gridSize`, first DROP the sub-grid whenever
 * `maxPageDimension / (step / subdivisions)` exceeds {@link MAX_GRID_LINES},
 * then COARSEN the main step (double it repeatedly) until
 * `maxPageDimension / step` fits the budget. Coarsened lines still sit on
 * grid multiples, so what remains is an honest (sparser) view of the grid.
 *
 * Chrome only: wrapped in `<Group name={GRID_CHROME_GROUP_NAME} listening={false}>`
 * so `export-stage.ts` can hide it during live-stage serialization; the
 * offscreen rasterizer never mounts it.
 */
export function Grid(): React.JSX.Element | null {
	const ctx = useCanvasStudio();
	const vs = useSyncExternalStore(
		ctx.viewportStore.subscribe,
		ctx.viewportStore.getState,
		ctx.viewportStore.getState,
	);
	const page = ctx.ir.pages.find((p) => p.id === ctx.activePageId);
	if (!vs.gridEnabled || !page || vs.gridSize <= 0) return null;

	const { width, height } = page.size;
	const maxDimension = Math.max(width, height);

	// Budget (see the component doc comment): coarsen the main step first…
	let step = vs.gridSize;
	while (maxDimension / step > MAX_GRID_LINES) step *= 2;
	// …and keep the sub-grid only when it independently fits the budget.
	const subdivisions = Math.floor(vs.gridSubdivisions);
	const subStep =
		subdivisions > 1 && maxDimension / (step / subdivisions) <= MAX_GRID_LINES
			? step / subdivisions
			: null;

	const mainStrokeWidth = 1 / vs.zoom;
	const subStrokeWidth = 0.5 / vs.zoom;

	return (
		<Group name={GRID_CHROME_GROUP_NAME} listening={false}>
			{/* Sub-grid first so main lines paint on top at shared crossings. */}
			{subStep !== null
				? linePositions(width, subStep, subdivisions).map((x) => (
						<Line
							key={`grid-sub-v-${x}`}
							points={[x, 0, x, height]}
							stroke={vs.subGridColor}
							strokeWidth={subStrokeWidth}
							listening={false}
							perfectDrawEnabled={false}
						/>
					))
				: null}
			{subStep !== null
				? linePositions(height, subStep, subdivisions).map((y) => (
						<Line
							key={`grid-sub-h-${y}`}
							points={[0, y, width, y]}
							stroke={vs.subGridColor}
							strokeWidth={subStrokeWidth}
							listening={false}
							perfectDrawEnabled={false}
						/>
					))
				: null}
			{linePositions(width, step).map((x) => (
				<Line
					key={`grid-v-${x}`}
					points={[x, 0, x, height]}
					stroke={vs.gridColor}
					strokeWidth={mainStrokeWidth}
					listening={false}
					perfectDrawEnabled={false}
				/>
			))}
			{linePositions(height, step).map((y) => (
				<Line
					key={`grid-h-${y}`}
					points={[0, y, width, y]}
					stroke={vs.gridColor}
					strokeWidth={mainStrokeWidth}
					listening={false}
					perfectDrawEnabled={false}
				/>
			))}
		</Group>
	);
}
