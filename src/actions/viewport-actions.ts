import { findNode } from "@anvilkit/canvas-core";
import type { CanvasStudioContextValue } from "../context/canvas-studio-context.js";

/**
 * @file Viewport actions (A-07, PRD 0012 FR-043/FR-040 zoom rows). Pure
 * viewport-store updates — zoom/pan NEVER commit history entries (§13.1).
 * Fit computations read the canvas viewport size that `PagesCanvas` mirrors
 * into the viewport store, so the action layer stays DOM-free.
 */

export const CANVAS_ZOOM_MIN = 0.1;
export const CANVAS_ZOOM_MAX = 4;
/** Multiplicative step used by the zoom-in/out shortcuts and buttons. */
export const ZOOM_STEP_FACTOR = 1.25;
/** Breathing room applied by fit operations. */
const FIT_MARGIN = 0.9;

export function clampZoom(zoom: number): number {
	return Math.min(
		CANVAS_ZOOM_MAX,
		Math.max(CANVAS_ZOOM_MIN, Math.round(zoom * 100) / 100),
	);
}

/**
 * Exponential wheel→zoom mapping (pinch gestures arrive as ctrl+wheel).
 * Negative deltaY (scroll up / pinch out) zooms in.
 */
export function computeWheelZoom(prevZoom: number, deltaY: number): number {
	return clampZoom(prevZoom * Math.exp(-deltaY * 0.01));
}

export function zoomInImpl(ctx: CanvasStudioContextValue): void {
	const viewport = ctx.viewportStore.getState();
	viewport.setZoom(clampZoom(viewport.zoom * ZOOM_STEP_FACTOR));
}

export function zoomOutImpl(ctx: CanvasStudioContextValue): void {
	const viewport = ctx.viewportStore.getState();
	viewport.setZoom(clampZoom(viewport.zoom / ZOOM_STEP_FACTOR));
}

/** FR-040 "Actual Size": zoom to 100%. */
export function resetZoomImpl(ctx: CanvasStudioContextValue): void {
	ctx.viewportStore.getState().setZoom(1);
}

/** Fit the ACTIVE page into the measured canvas viewport. */
export function zoomToFitImpl(ctx: CanvasStudioContextValue): void {
	const viewport = ctx.viewportStore.getState();
	const size = viewport.viewportSize;
	if (!size || size.width <= 0 || size.height <= 0) return;
	const activePageId = ctx.pagesStore.getState().activePageId;
	const page = ctx.getIR().pages.find((p) => p.id === activePageId);
	if (!page) return;
	viewport.setZoom(
		clampZoom(
			Math.min(size.width / page.size.width, size.height / page.size.height) *
				FIT_MARGIN,
		),
	);
}

/** Fit the selection's combined AABB into the measured canvas viewport. */
export function zoomToSelectionImpl(ctx: CanvasStudioContextValue): void {
	const viewport = ctx.viewportStore.getState();
	const size = viewport.viewportSize;
	if (!size || size.width <= 0 || size.height <= 0) return;
	const ir = ctx.getIR();
	let minX = Number.POSITIVE_INFINITY;
	let minY = Number.POSITIVE_INFINITY;
	let maxX = Number.NEGATIVE_INFINITY;
	let maxY = Number.NEGATIVE_INFINITY;
	let any = false;
	for (const id of ctx.selectionStore.getState().selectedIds) {
		const found = findNode(ir, id);
		if (!found) continue;
		any = true;
		const { x, y } = found.node.transform;
		minX = Math.min(minX, x);
		minY = Math.min(minY, y);
		maxX = Math.max(maxX, x + found.node.bounds.width);
		maxY = Math.max(maxY, y + found.node.bounds.height);
	}
	if (!any || maxX <= minX || maxY <= minY) return;
	viewport.setZoom(
		clampZoom(
			Math.min(size.width / (maxX - minX), size.height / (maxY - minY)) *
				FIT_MARGIN,
		),
	);
}
