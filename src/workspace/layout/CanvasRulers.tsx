"use client";

import * as React from "react";
import {
	type RefObject,
	useCallback,
	useEffect,
	useRef,
	useSyncExternalStore,
} from "react";
import { useCanvasActions } from "../../actions/editor-actions.js";
import {
	useCanvasStores,
	useCanvasT,
} from "../../context/canvas-studio-context.js";
import type { CanvasGuideAxis } from "../../stores/ruler-guide-store.js";

/** Ruler thickness in CSS px (FR-110). */
export const RULER_SIZE = 20;

/** Candidate tick steps in PAGE units; the first producing ≥ minPx spacing wins. */
const TICK_STEPS = [1, 2, 5, 10, 25, 50, 100, 250, 500, 1000, 2500, 5000];
const MIN_MAJOR_PX = 56;

function pickStep(zoom: number): number {
	for (const step of TICK_STEPS) {
		if (step * zoom >= MIN_MAJOR_PX) return step;
	}
	return TICK_STEPS[TICK_STEPS.length - 1] ?? 1000;
}

interface PageFrame {
	/** Active page origin relative to the ruler track, in CSS px. */
	originX: number;
	originY: number;
	/** Page size on screen (already zoom-scaled), CSS px. */
	screenWidth: number;
	screenHeight: number;
	zoom: number;
}

function drawRuler(
	canvas: HTMLCanvasElement,
	orientation: "horizontal" | "vertical",
	frame: PageFrame,
	style: { bg: string; fg: string; line: string },
): void {
	const c = canvas.getContext("2d");
	if (!c) return; // jsdom has no 2D context; interactions still work.
	const dpr =
		typeof window !== "undefined" ? (window.devicePixelRatio ?? 1) : 1;
	const cssW = canvas.clientWidth;
	const cssH = canvas.clientHeight;
	if (canvas.width !== cssW * dpr || canvas.height !== cssH * dpr) {
		canvas.width = cssW * dpr;
		canvas.height = cssH * dpr;
	}
	c.setTransform(dpr, 0, 0, dpr, 0, 0);
	c.clearRect(0, 0, cssW, cssH);
	c.fillStyle = style.bg;
	c.fillRect(0, 0, cssW, cssH);
	c.strokeStyle = style.line;
	c.fillStyle = style.fg;
	c.lineWidth = 1;
	c.font = "9px ui-sans-serif, system-ui, sans-serif";

	const horizontal = orientation === "horizontal";
	const trackLen = horizontal ? cssW : cssH;
	const origin = horizontal ? frame.originX : frame.originY;
	const step = pickStep(frame.zoom);
	const minor = step / 5;

	// First visible minor tick, in page units.
	const startUnit = Math.floor((0 - origin) / frame.zoom / minor) * minor;
	const endUnit = Math.ceil((trackLen - origin) / frame.zoom / minor) * minor;

	c.beginPath();
	for (let u = startUnit; u <= endUnit; u += minor) {
		const px = Math.round(origin + u * frame.zoom) + 0.5;
		if (px < 0 || px > trackLen) continue;
		const isMajor = Math.abs(u / step - Math.round(u / step)) < 1e-6;
		const len = isMajor ? RULER_SIZE : u % (step / 2) === 0 ? 8 : 5;
		if (horizontal) {
			c.moveTo(px, RULER_SIZE);
			c.lineTo(px, RULER_SIZE - len);
		} else {
			c.moveTo(RULER_SIZE, px);
			c.lineTo(RULER_SIZE - len, px);
		}
		if (isMajor) {
			const label = String(Math.round(u));
			if (horizontal) {
				c.fillText(label, px + 3, 9);
			} else {
				c.save();
				c.translate(9, px + 3);
				c.rotate(-Math.PI / 2);
				c.fillText(label, -c.measureText(label).width, 0);
				c.restore();
			}
		}
	}
	c.stroke();
}

export interface CanvasRulersProps {
	/** The scrollable canvas viewport (`PagesCanvas`'s scroll element). */
	scrollRef: RefObject<HTMLDivElement | null>;
}

/**
 * Zoom/pan-aware rulers for the active page (C-02, FR-110), overlaid on the
 * top/left edges of the canvas viewport. Marks are page coordinates in the
 * page's own unit, with the origin tracking the active page card as it
 * scrolls. Dragging from a ruler pulls out a new persistent guide
 * (FR-111): from the top ruler a horizontal guide, from the left ruler a
 * vertical one; the live preview renders on-stage via `pendingGuide`, and
 * releasing inside the page commits ONE `page.set-layout-aids` undo entry
 * through the action layer.
 */
export function CanvasRulers({
	scrollRef,
}: CanvasRulersProps): React.JSX.Element | null {
	const stores = useCanvasStores();
	const actions = useCanvasActions();
	const t = useCanvasT();
	const store = stores.rulerGuideStore;
	const visible = useSyncExternalStore(
		store?.subscribe ?? (() => () => undefined),
		() => store?.getState().rulersVisible ?? false,
		() => false,
	);
	const hRef = useRef<HTMLCanvasElement>(null);
	const vRef = useRef<HTMLCanvasElement>(null);
	const frameRef = useRef<PageFrame | null>(null);
	const rafRef = useRef(0);

	const redraw = useCallback((): void => {
		const scrollEl = scrollRef.current;
		const hCanvas = hRef.current;
		const vCanvas = vRef.current;
		if (!scrollEl || !hCanvas || !vCanvas) return;
		const surface = scrollEl.querySelector<HTMLElement>(
			'[data-page-surface="active"]',
		);
		if (!surface) return;
		const pageRect = surface.getBoundingClientRect();
		const hostRect = scrollEl.getBoundingClientRect();
		const zoom = stores.viewportStore.getState().zoom;
		const frame: PageFrame = {
			originX: pageRect.left - hostRect.left - RULER_SIZE,
			originY: pageRect.top - hostRect.top - RULER_SIZE,
			screenWidth: pageRect.width,
			screenHeight: pageRect.height,
			zoom,
		};
		frameRef.current = frame;
		const styles = getComputedStyle(hCanvas);
		const style = {
			bg: styles.getPropertyValue("--ruler-bg") || "#fafafa",
			fg: styles.getPropertyValue("--ruler-fg") || "#737373",
			line: styles.getPropertyValue("--ruler-line") || "#a3a3a3",
		};
		drawRuler(hCanvas, "horizontal", frame, style);
		drawRuler(vCanvas, "vertical", frame, style);
	}, [scrollRef, stores.viewportStore]);

	const scheduleRedraw = useCallback((): void => {
		if (rafRef.current) return;
		const raf =
			typeof requestAnimationFrame === "function"
				? requestAnimationFrame
				: (cb: FrameRequestCallback): number => {
						cb(0);
						return 0;
					};
		rafRef.current = raf(() => {
			rafRef.current = 0;
			redraw();
		});
	}, [redraw]);

	useEffect(() => {
		if (!visible) return;
		redraw();
		const scrollEl = scrollRef.current;
		if (!scrollEl) return;
		scrollEl.addEventListener("scroll", scheduleRedraw, { passive: true });
		const unsubZoom = stores.viewportStore.subscribe(scheduleRedraw);
		const unsubPage = stores.pagesStore.subscribe(scheduleRedraw);
		let ro: ResizeObserver | null = null;
		if (typeof ResizeObserver === "function") {
			ro = new ResizeObserver(scheduleRedraw);
			ro.observe(scrollEl);
		}
		return () => {
			scrollEl.removeEventListener("scroll", scheduleRedraw);
			unsubZoom();
			unsubPage();
			ro?.disconnect();
			if (rafRef.current && typeof cancelAnimationFrame === "function") {
				cancelAnimationFrame(rafRef.current);
				rafRef.current = 0;
			}
		};
	}, [visible, redraw, scheduleRedraw, scrollRef, stores]);

	const beginGuideDrag = (
		axis: CanvasGuideAxis,
		down: React.PointerEvent<HTMLCanvasElement>,
	): void => {
		if (!store || store.getState().guidesLocked) return;
		const scrollEl = scrollRef.current;
		if (!scrollEl) return;
		down.currentTarget.setPointerCapture?.(down.pointerId);
		const toPagePosition = (e: {
			clientX: number;
			clientY: number;
		}): number => {
			const surface = scrollEl.querySelector<HTMLElement>(
				'[data-page-surface="active"]',
			);
			const frame = frameRef.current;
			const zoom = stores.viewportStore.getState().zoom;
			if (surface) {
				const rect = surface.getBoundingClientRect();
				return axis === "horizontal"
					? (e.clientY - rect.top) / zoom
					: (e.clientX - rect.left) / zoom;
			}
			if (!frame) return Number.NaN;
			const hostRect = scrollEl.getBoundingClientRect();
			return axis === "horizontal"
				? (e.clientY - hostRect.top - RULER_SIZE - frame.originY) / frame.zoom
				: (e.clientX - hostRect.left - RULER_SIZE - frame.originX) / frame.zoom;
		};
		const onMove = (e: PointerEvent): void => {
			const position = toPagePosition(e);
			if (Number.isFinite(position)) {
				store.getState().setPendingGuide({ axis, position });
			}
		};
		const finish = (e: PointerEvent, commit: boolean): void => {
			window.removeEventListener("pointermove", onMove);
			window.removeEventListener("pointerup", onUp);
			window.removeEventListener("pointercancel", onCancel);
			const position = toPagePosition(e);
			store.getState().setPendingGuide(null);
			if (!commit || !Number.isFinite(position)) return;
			const page = stores
				.getIR()
				.pages.find((p) => p.id === stores.pagesStore.getState().activePageId);
			if (!page) return;
			const limit = axis === "horizontal" ? page.size.height : page.size.width;
			if (position < 0 || position > limit) return;
			actions.addGuide(axis, position);
		};
		const onUp = (e: PointerEvent): void => finish(e, true);
		const onCancel = (e: PointerEvent): void => finish(e, false);
		window.addEventListener("pointermove", onMove);
		window.addEventListener("pointerup", onUp);
		window.addEventListener("pointercancel", onCancel);
	};

	if (!visible) return null;

	return (
		<div
			data-testid="canvas-rulers"
			className="pointer-events-none absolute inset-0 z-20 [--ruler-bg:var(--color-neutral-100)] [--ruler-fg:var(--color-neutral-500)] [--ruler-line:var(--color-neutral-400)] dark:[--ruler-bg:var(--color-neutral-900)] dark:[--ruler-fg:var(--color-neutral-400)] dark:[--ruler-line:var(--color-neutral-600)]"
		>
			<div
				aria-hidden
				className="absolute top-0 left-0 size-5 border-r border-b border-border bg-[var(--ruler-bg)]"
			/>
			<canvas
				ref={hRef}
				data-testid="canvas-ruler-horizontal"
				role="presentation"
				aria-label={t("canvas.rulers.horizontal", "Horizontal ruler")}
				className="pointer-events-auto absolute top-0 right-0 left-5 h-5 cursor-row-resize touch-none border-b border-border"
				onPointerDown={(e) => beginGuideDrag("horizontal", e)}
			/>
			<canvas
				ref={vRef}
				data-testid="canvas-ruler-vertical"
				role="presentation"
				aria-label={t("canvas.rulers.vertical", "Vertical ruler")}
				className="pointer-events-auto absolute top-5 bottom-0 left-0 w-5 cursor-col-resize touch-none border-r border-border"
				onPointerDown={(e) => beginGuideDrag("vertical", e)}
			/>
		</div>
	);
}
