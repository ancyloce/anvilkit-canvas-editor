"use client";

import type { CanvasInsets, CanvasPage } from "@anvilkit/canvas-core";
import type Konva from "konva";
import * as React from "react";
import { useSyncExternalStore } from "react";
import { Line, Rect } from "react-konva";
import { useCanvasActions } from "../actions/editor-actions.js";
import {
	useCanvasStores,
	useCanvasStudio,
} from "../context/canvas-studio-context.js";
import type { CanvasGuideAxis } from "../stores/ruler-guide-store.js";

/**
 * Konva colors for guide/layout-aid chrome (C-02). Canvas shapes take literal
 * colors (same posture as `SMART_GUIDE_COLOR`); these are chrome-only and
 * never serialize into exports.
 */
export const RULER_GUIDE_COLOR = "#0ea5e9";
export const LAYOUT_MARGIN_COLOR = "#a855f7";
export const LAYOUT_BLEED_COLOR = "#ef4444";
export const LAYOUT_SAFE_COLOR = "#22c55e";
export const CENTER_LINE_COLOR = "#f59e0b";
export const LAYOUT_AID_DASH: [number, number] = [6, 4];

/** Grab tolerance for guide dragging, in SCREEN px (divided by zoom). */
const GUIDE_HIT_WIDTH = 8;

const NOOP_UNSUBSCRIBE = (): void => {
	// Partial test contexts have no ruler-guide store; nothing to release.
};
const NOOP_SUBSCRIBE = (): (() => void) => NOOP_UNSUBSCRIBE;

interface GuideLineProps {
	axis: CanvasGuideAxis;
	index: number;
	position: number;
	page: CanvasPage;
	zoom: number;
	draggable: boolean;
	onMove: (axis: CanvasGuideAxis, index: number, position: number) => void;
	onRemove: (axis: CanvasGuideAxis, index: number) => void;
}

function GuideLine({
	axis,
	index,
	position,
	page,
	zoom,
	draggable,
	onMove,
	onRemove,
}: GuideLineProps): React.JSX.Element {
	const horizontal = axis === "horizontal";
	const { width, height } = page.size;
	const points: number[] = horizontal
		? [0, position, width, position]
		: [position, 0, position, height];
	return (
		<Line
			name={`ruler-guide-${axis}-${index}`}
			points={points}
			stroke={RULER_GUIDE_COLOR}
			strokeWidth={1 / zoom}
			hitStrokeWidth={GUIDE_HIT_WIDTH / zoom}
			draggable={draggable}
			listening={draggable}
			dragBoundFunc={(pos: Konva.Vector2d) =>
				horizontal ? { x: 0, y: pos.y } : { x: pos.x, y: 0 }
			}
			onMouseEnter={(e: Konva.KonvaEventObject<MouseEvent>) => {
				const stage = e.target.getStage();
				if (stage)
					stage.container().style.cursor = horizontal
						? "row-resize"
						: "col-resize";
			}}
			onMouseLeave={(e: Konva.KonvaEventObject<MouseEvent>) => {
				const stage = e.target.getStage();
				if (stage) stage.container().style.cursor = "";
			}}
			onDragEnd={(e: Konva.KonvaEventObject<DragEvent>) => {
				const node = e.target;
				// The Line's points stay fixed; the drag moved the node itself, in
				// layer (page) coordinates. Fold the offset back into a document
				// position and reset the node before committing.
				const offset = horizontal ? node.y() : node.x();
				const next = position + offset;
				node.position({ x: 0, y: 0 });
				const limit = horizontal ? height : width;
				if (next < 0 || next > limit) onRemove(axis, index);
				else onMove(axis, index, next);
			}}
		/>
	);
}

function insetsRect(
	insets: CanvasInsets,
	page: CanvasPage,
): { x: number; y: number; width: number; height: number } {
	return {
		x: insets.left,
		y: insets.top,
		width: page.size.width - insets.left - insets.right,
		height: page.size.height - insets.top - insets.bottom,
	};
}

/**
 * Active-page overlay for persistent guides and layout aids (C-02, FR-111/
 * FR-113): document guides (draggable to move, drag off-page to delete,
 * lockable/hideable via `ruler-guide-store`), the drag-from-ruler preview,
 * and margin/bleed/safe-area/center-line rendering. Chrome only — none of
 * this reaches serializers, and guide MUTATIONS go through the action layer.
 */
export function GuideLayoutOverlay(): React.JSX.Element | null {
	const ctx = useCanvasStudio();
	const stores = useCanvasStores();
	const actions = useCanvasActions();
	const store = stores.rulerGuideStore;
	const chrome = useSyncExternalStore(
		store?.subscribe ?? NOOP_SUBSCRIBE,
		() => store?.getState() ?? null,
		() => store?.getState() ?? null,
	);
	const zoom = useSyncExternalStore(
		ctx.viewportStore.subscribe,
		() => ctx.viewportStore.getState().zoom,
		() => ctx.viewportStore.getState().zoom,
	);
	const page = ctx.ir.pages.find((p) => p.id === ctx.activePageId);
	if (!page || !chrome) return null;

	const aids = page.layoutAids;
	const guides = aids?.guides;
	const strokeWidth = 1 / zoom;
	const { width, height } = page.size;

	return (
		<>
			{chrome.layoutAidsVisible && aids?.bleed ? (
				<Rect
					name="layout-aid-bleed"
					{...insetsRect(
						{
							top: -aids.bleed.top,
							right: -aids.bleed.right,
							bottom: -aids.bleed.bottom,
							left: -aids.bleed.left,
						},
						page,
					)}
					stroke={LAYOUT_BLEED_COLOR}
					strokeWidth={strokeWidth}
					dash={LAYOUT_AID_DASH}
					listening={false}
				/>
			) : null}
			{chrome.layoutAidsVisible && aids?.margin ? (
				<Rect
					name="layout-aid-margin"
					{...insetsRect(aids.margin, page)}
					stroke={LAYOUT_MARGIN_COLOR}
					strokeWidth={strokeWidth}
					dash={LAYOUT_AID_DASH}
					listening={false}
				/>
			) : null}
			{chrome.layoutAidsVisible && aids?.safeArea ? (
				<Rect
					name="layout-aid-safe-area"
					{...insetsRect(aids.safeArea, page)}
					stroke={LAYOUT_SAFE_COLOR}
					strokeWidth={strokeWidth}
					dash={LAYOUT_AID_DASH}
					listening={false}
				/>
			) : null}
			{chrome.centerLinesVisible ? (
				<>
					<Line
						name="center-line-vertical"
						points={[width / 2, 0, width / 2, height]}
						stroke={CENTER_LINE_COLOR}
						strokeWidth={strokeWidth}
						dash={LAYOUT_AID_DASH}
						listening={false}
					/>
					<Line
						name="center-line-horizontal"
						points={[0, height / 2, width, height / 2]}
						stroke={CENTER_LINE_COLOR}
						strokeWidth={strokeWidth}
						dash={LAYOUT_AID_DASH}
						listening={false}
					/>
				</>
			) : null}
			{chrome.guidesVisible && guides
				? (
						[
							["horizontal", guides.horizontal],
							["vertical", guides.vertical],
						] as const
					).flatMap(([axis, positions]) =>
						positions.map((position, index) => (
							<GuideLine
								key={`${axis}-${index}-${position}`}
								axis={axis}
								index={index}
								position={position}
								page={page}
								zoom={zoom}
								draggable={!chrome.guidesLocked}
								onMove={actions.moveGuide}
								onRemove={actions.removeGuide}
							/>
						)),
					)
				: null}
			{chrome.pendingGuide ? (
				<Line
					name="pending-guide"
					points={
						chrome.pendingGuide.axis === "horizontal"
							? [
									0,
									chrome.pendingGuide.position,
									width,
									chrome.pendingGuide.position,
								]
							: [
									chrome.pendingGuide.position,
									0,
									chrome.pendingGuide.position,
									height,
								]
					}
					stroke={RULER_GUIDE_COLOR}
					strokeWidth={strokeWidth}
					dash={[4 / zoom, 4 / zoom]}
					listening={false}
				/>
			) : null}
		</>
	);
}
