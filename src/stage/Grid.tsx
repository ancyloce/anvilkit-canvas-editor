"use client";

import type Konva from "konva";
import * as React from "react";
import { useMemo, useSyncExternalStore } from "react";
import { Group, Shape } from "react-konva";
import {
	useActivePage,
	useCanvasStudio,
} from "../context/canvas-studio-context.js";

/**
 * Per-axis budget for grid lines (main and sub-grid counted separately). See
 * the coarsening strategy note on {@link computeGridGeometry}.
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

/** Where every grid line sits, in page coordinates. */
export interface GridGeometry {
	/** Main-grid spacing actually used, after any budget coarsening. */
	readonly step: number;
	/** Sub-grid spacing, or `null` when the sub-grid was dropped. */
	readonly subStep: number | null;
	readonly mainVertical: readonly number[];
	readonly mainHorizontal: readonly number[];
	readonly subVertical: readonly number[];
	readonly subHorizontal: readonly number[];
}

/**
 * Resolve the visible grid to line positions — pure, and exported so the
 * budget rules below are unit-testable without rendering anything.
 *
 * LINE-COUNT BUDGET. The node count must stay bounded for tiny grid sizes on
 * large pages. Strategy: with `step = gridSize`, first DROP the sub-grid
 * whenever `maxPageDimension / (step / subdivisions)` exceeds
 * {@link MAX_GRID_LINES}, then COARSEN the main step (double it repeatedly)
 * until `maxPageDimension / step` fits the budget. Coarsened lines still sit
 * on grid multiples, so what remains is an honest (sparser) view of the grid.
 */
export function computeGridGeometry(
	size: { width: number; height: number },
	gridSize: number,
	gridSubdivisions: number,
): GridGeometry {
	const { width, height } = size;
	const maxDimension = Math.max(width, height);

	let step = gridSize;
	while (maxDimension / step > MAX_GRID_LINES) step *= 2;
	const subdivisions = Math.floor(gridSubdivisions);
	const subStep =
		subdivisions > 1 && maxDimension / (step / subdivisions) <= MAX_GRID_LINES
			? step / subdivisions
			: null;

	return {
		step,
		subStep,
		mainVertical: linePositions(width, step),
		mainHorizontal: linePositions(height, step),
		subVertical:
			subStep !== null ? linePositions(width, subStep, subdivisions) : [],
		subHorizontal:
			subStep !== null ? linePositions(height, subStep, subdivisions) : [],
	};
}

/**
 * One grid tier (main or sub) as a SINGLE Konva node.
 *
 * This used to be one `<Line>` per grid line, which on a large page with a
 * fine grid meant up to `MAX_GRID_LINES × 2 × 2` ≈ 2048 Konva nodes — each a
 * full scene-graph member with its own transform, attrs and React element,
 * all living on the same physical layer as the design content, and so all
 * re-stroked whenever anything on that layer redraws (Konva clears and
 * re-walks a whole layer per draw; `Layer.drawScene`). Collapsing a tier into
 * one `sceneFunc` keeps the identical painted result — same positions, same
 * stroke — while the layer walks 1 node instead of ~1000 (K-8).
 *
 * `sceneFunc` is memoised because Konva's `_setAttr` never short-circuits a
 * function-valued attribute, so a fresh closure per render would re-set it and
 * re-request a draw every commit (K-3).
 */
function GridTier({
	vertical,
	horizontal,
	width,
	height,
	stroke,
	strokeWidth,
}: {
	vertical: readonly number[];
	horizontal: readonly number[];
	width: number;
	height: number;
	stroke: string;
	strokeWidth: number;
}): React.JSX.Element {
	const sceneFunc = useMemo(
		() => (ctx: Konva.Context, shape: Konva.Shape) => {
			// One path for the whole tier: `strokeShape` then applies the shape's
			// own stroke/strokeWidth to all of it in a single stroke() call.
			ctx.beginPath();
			for (const x of vertical) {
				ctx.moveTo(x, 0);
				ctx.lineTo(x, height);
			}
			for (const y of horizontal) {
				ctx.moveTo(0, y);
				ctx.lineTo(width, y);
			}
			ctx.strokeShape(shape);
		},
		[vertical, horizontal, width, height],
	);
	return (
		<Shape
			sceneFunc={sceneFunc}
			stroke={stroke}
			strokeWidth={strokeWidth}
			// A custom Shape cannot infer its own bounds from `sceneFunc`, so the
			// page box is declared explicitly — otherwise it measures 0×0 and
			// silently drops out of every `getClientRect` union it takes part in.
			width={width}
			height={height}
			listening={false}
			// Editor-only chrome, excluded from every export, so the buffer-canvas
			// pass Konva would use for a semi-transparent stroked shape buys
			// nothing here. (Content shapes deliberately keep it — see K-10.)
			perfectDrawEnabled={false}
		/>
	);
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
 * Geometry lives in {@link computeGridGeometry}; each tier paints as one
 * {@link GridTier} node rather than one node per line.
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
	// Resolved-source page (plan 0024 Phase 2) so the grid extent tracks a live
	// page-size preview instead of snapping only on commit.
	const page = useActivePage();
	const size = page?.size;
	// Hoisted above the early return — hooks may not be conditional. Memoised on
	// the page size plus the two grid settings, which is every input.
	const geometry = useMemo(
		() =>
			size && vs.gridSize > 0
				? computeGridGeometry(size, vs.gridSize, vs.gridSubdivisions)
				: null,
		[size, vs.gridSize, vs.gridSubdivisions],
	);
	if (!vs.gridEnabled || !size || !geometry) return null;

	const { width, height } = size;
	return (
		<Group name={GRID_CHROME_GROUP_NAME} listening={false}>
			{/* Sub-grid first so main lines paint on top at shared crossings. */}
			{geometry.subStep !== null ? (
				<GridTier
					vertical={geometry.subVertical}
					horizontal={geometry.subHorizontal}
					width={width}
					height={height}
					stroke={vs.subGridColor}
					strokeWidth={0.5 / vs.zoom}
				/>
			) : null}
			<GridTier
				vertical={geometry.mainVertical}
				horizontal={geometry.mainHorizontal}
				width={width}
				height={height}
				stroke={vs.gridColor}
				strokeWidth={1 / vs.zoom}
			/>
		</Group>
	);
}
