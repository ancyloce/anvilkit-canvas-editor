"use client";

/**
 * @file K-1 (review 0036): the live stage as a WINDOW over the page, not a
 * page-sized surface.
 *
 * The workspace lays pages out Canva-style: one scroll container holding a
 * column of page rows, where the active row hosts the live Konva stage. The
 * stage used to be sized to `page × zoom` and left in document flow, which
 * made every Konva canvas scale with zoom — at the largest shipped preset
 * (1080×1920) and max zoom 4 on a DPR-2 display that is ~133 Mpx per scene
 * canvas across TEN canvases (4 layers × scene+hit, plus the stage's two
 * buffers): ~3.3 GB of backing store, past iOS Safari's hard canvas cap and
 * deep into Chrome's eviction territory.
 *
 * The fix keeps the DOM layout: an in-flow "footprint" element still spans
 * `page × zoom`, so the page card, rulers, thumbnails, scroll range and
 * wheel-zoom anchoring are untouched. The Konva stage becomes an absolutely
 * positioned child covering only the footprint's intersection with the
 * scroll viewport — padded so near-offscreen content is pre-rendered, and
 * QUANTIZED so the window only moves when scroll crosses a coarse grid line.
 * Between grid lines a scroll frame costs nothing: the canvas is already
 * painted and the browser just composites it. Content stays put on screen
 * because the stage's Konva position compensates the window's offset
 * (`stage.x = panX − window.x`), and every coordinate mapping that uses the
 * stage transform (`getStagePointer`, `pageToClient`, `clientPointToPage`)
 * keeps working unchanged.
 *
 * `computeStageWindow` returns `null` when either box is unmeasurable —
 * jsdom, SSR, a bare `<CanvasStudio>` without the workspace scroll ancestor
 * (`[data-canvas-viewport]`), or mid-layout zero rects. Callers fall back to
 * the page-sized in-flow stage, which is exactly the pre-K-1 behavior, so
 * hosts that never mount the workspace shell are byte-identical.
 */

import {
	type RefObject,
	useCallback,
	useLayoutEffect,
	useRef,
	useState,
} from "react";
import { CANVAS_VIEWPORT_ATTRIBUTE } from "./viewport-point.js";

/** The stage window, in CSS px, relative to the footprint's top-left. */
export interface StageWindow {
	readonly x: number;
	readonly y: number;
	readonly width: number;
	readonly height: number;
}

/**
 * Padding (CSS px) rendered beyond the visible intersection on every side,
 * so content scrolling into view is already painted. Must comfortably exceed
 * {@link STAGE_WINDOW_QUANTUM}: the window is only re-derived when scroll
 * crosses a quantum boundary, so the guaranteed pre-rendered lead is
 * `PAD − QUANTUM`.
 */
export const STAGE_WINDOW_PAD = 384;

/**
 * Both window edges snap outward to this grid (CSS px). Scrolling inside one
 * quantum cell changes nothing — no state write, no React render, no Konva
 * redraw — so the steady-state cost of scrolling is pure compositing.
 */
export const STAGE_WINDOW_QUANTUM = 256;

/** Minimal rect shape — `DOMRect` satisfies it, and tests can hand plain
 * objects without a DOM. */
export interface WindowRect {
	readonly left: number;
	readonly top: number;
	readonly width: number;
	readonly height: number;
}

function isMeasurable(rect: WindowRect): boolean {
	return (
		Number.isFinite(rect.left) &&
		Number.isFinite(rect.top) &&
		Number.isFinite(rect.width) &&
		Number.isFinite(rect.height) &&
		rect.width > 0 &&
		rect.height > 0
	);
}

function axisWindow(
	viewportStart: number,
	viewportLength: number,
	footprintStart: number,
	footprintLength: number,
	pad: number,
	quantum: number,
): { start: number; length: number } {
	// Visible band in footprint-local coordinates. An empty intersection (the
	// page scrolled fully out of view) collapses to a zero-length band clamped
	// to the nearest footprint edge — the pad below then keeps a small window
	// alive there, so re-entry never starts from a blank stage.
	const visStart = Math.min(
		Math.max(viewportStart - footprintStart, 0),
		footprintLength,
	);
	const visEnd = Math.min(
		Math.max(viewportStart + viewportLength - footprintStart, 0),
		footprintLength,
	);
	const start = Math.max(0, Math.floor((visStart - pad) / quantum) * quantum);
	const end = Math.min(
		footprintLength,
		Math.ceil((visEnd + pad) / quantum) * quantum,
	);
	// `end` is quantized but the footprint edge is not, so guarantee ≥ 1 px.
	const length = Math.max(1, Math.round(end - start));
	return { start, length };
}

/**
 * Derive the stage window from the footprint's and the scroll viewport's
 * client rects. Pure — see the file header for the contract.
 */
export function computeStageWindow(
	footprint: WindowRect,
	viewport: WindowRect,
	pad: number = STAGE_WINDOW_PAD,
	quantum: number = STAGE_WINDOW_QUANTUM,
): StageWindow | null {
	if (!isMeasurable(footprint) || !isMeasurable(viewport)) return null;
	const x = axisWindow(
		viewport.left,
		viewport.width,
		footprint.left,
		footprint.width,
		pad,
		quantum,
	);
	const y = axisWindow(
		viewport.top,
		viewport.height,
		footprint.top,
		footprint.height,
		pad,
		quantum,
	);
	return { x: x.start, y: y.start, width: x.length, height: y.length };
}

/** Value equality — the hook keeps the previous reference for equal windows
 * so downstream memo/deps never churn on a no-op update. */
export function stageWindowsEqual(
	a: StageWindow | null,
	b: StageWindow | null,
): boolean {
	if (a === null || b === null) return a === b;
	return (
		a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height
	);
}

/**
 * Measure the stage window for a mounted footprint element.
 *
 * Listens to scroll on the closest `[data-canvas-viewport]` ancestor
 * (rAF-coalesced) and to size changes of both boxes. Returns `null` — full
 * page-sized stage — whenever there is no such ancestor or nothing is
 * measurable yet.
 */
export function useStageWindow(
	footprintRef: RefObject<HTMLElement | null>,
): StageWindow | null {
	const [window_, setWindow] = useState<StageWindow | null>(null);

	const apply = useCallback((next: StageWindow | null): void => {
		setWindow((prev) => (stageWindowsEqual(prev, next) ? prev : next));
	}, []);

	// The rAF handle lives in a ref so scroll bursts coalesce to one measure
	// per frame and unmount can cancel a pending one.
	const frameRef = useRef<number | null>(null);

	useLayoutEffect(() => {
		const el = footprintRef.current;
		if (!el) {
			apply(null);
			return;
		}
		const host = el.closest?.(`[${CANVAS_VIEWPORT_ATTRIBUTE}]`);
		if (!(host instanceof HTMLElement)) {
			apply(null);
			return;
		}

		const measure = (): void => {
			frameRef.current = null;
			apply(
				computeStageWindow(
					el.getBoundingClientRect(),
					host.getBoundingClientRect(),
				),
			);
		};
		const schedule = (): void => {
			if (frameRef.current !== null) return;
			if (typeof requestAnimationFrame === "function") {
				frameRef.current = requestAnimationFrame(measure);
			} else {
				measure();
			}
		};

		measure();
		host.addEventListener("scroll", schedule, { passive: true });
		let observer: ResizeObserver | null = null;
		if (typeof ResizeObserver === "function") {
			observer = new ResizeObserver(schedule);
			observer.observe(el);
			observer.observe(host);
		}
		return () => {
			host.removeEventListener("scroll", schedule);
			observer?.disconnect();
			if (frameRef.current !== null) {
				if (typeof cancelAnimationFrame === "function") {
					cancelAnimationFrame(frameRef.current);
				}
				frameRef.current = null;
			}
		};
		// `footprintRef` is a stable ref object; `apply` is a stable callback.
	}, [footprintRef, apply]);

	return window_;
}
