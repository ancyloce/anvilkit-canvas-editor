"use client";

import { useSyncExternalStore } from "react";
import { Ellipse, Line, Rect, RegularPolygon, Star } from "react-konva";
import { useCanvasStores } from "../context/canvas-studio-context.js";

export const DRAFT_STROKE_COLOR = "#3b82f6";
export const DRAFT_DASH: [number, number] = [4, 4];
// Match `createPolygon`/`createStar`'s own defaults — the drag preview and
// the node committed on pointerup must agree without any extra draft config.
const DRAFT_POLYGON_SIDES = 5;
const DRAFT_STAR_POINTS = 5;
const DRAFT_STAR_INNER_RADIUS_RATIO = 0.5;

export function DraftRenderer(): React.JSX.Element | null {
	const { draftStore } = useCanvasStores();
	const draft = useSyncExternalStore(
		draftStore.subscribe,
		() => draftStore.getState().draft,
		() => draftStore.getState().draft,
	);
	if (!draft) return null;
	// 'move' (Konva direct-mutation) and 'pan' (viewport-only) have no visual draft.
	if (draft.type === "move" || draft.type === "pan") return null;
	const { startX, startY, currentX, currentY } = draft;
	if (draft.type === "marquee") {
		return (
			<Rect
				x={Math.min(startX, currentX)}
				y={Math.min(startY, currentY)}
				width={Math.abs(currentX - startX)}
				height={Math.abs(currentY - startY)}
				stroke={DRAFT_STROKE_COLOR}
				strokeWidth={1}
				dash={DRAFT_DASH}
				fill="rgba(59, 130, 246, 0.1)"
				listening={false}
			/>
		);
	}
	switch (draft.type) {
		case "rect":
		case "frame":
			return (
				<Rect
					x={Math.min(startX, currentX)}
					y={Math.min(startY, currentY)}
					width={Math.abs(currentX - startX)}
					height={Math.abs(currentY - startY)}
					stroke={DRAFT_STROKE_COLOR}
					strokeWidth={1}
					dash={DRAFT_DASH}
					listening={false}
				/>
			);
		case "ellipse": {
			const cx = (startX + currentX) / 2;
			const cy = (startY + currentY) / 2;
			return (
				<Ellipse
					x={cx}
					y={cy}
					radiusX={Math.abs(currentX - startX) / 2}
					radiusY={Math.abs(currentY - startY) / 2}
					stroke={DRAFT_STROKE_COLOR}
					strokeWidth={1}
					dash={DRAFT_DASH}
					listening={false}
				/>
			);
		}
		case "polygon": {
			const width = Math.abs(currentX - startX);
			const height = Math.abs(currentY - startY);
			return (
				<RegularPolygon
					x={(startX + currentX) / 2}
					y={(startY + currentY) / 2}
					sides={DRAFT_POLYGON_SIDES}
					radius={width / 2}
					scaleY={width > 0 ? height / width : 1}
					stroke={DRAFT_STROKE_COLOR}
					strokeWidth={1}
					dash={DRAFT_DASH}
					listening={false}
				/>
			);
		}
		case "star": {
			const width = Math.abs(currentX - startX);
			const height = Math.abs(currentY - startY);
			const outerRadius = width / 2;
			return (
				<Star
					x={(startX + currentX) / 2}
					y={(startY + currentY) / 2}
					numPoints={DRAFT_STAR_POINTS}
					innerRadius={outerRadius * DRAFT_STAR_INNER_RADIUS_RATIO}
					outerRadius={outerRadius}
					scaleY={width > 0 ? height / width : 1}
					stroke={DRAFT_STROKE_COLOR}
					strokeWidth={1}
					dash={DRAFT_DASH}
					listening={false}
				/>
			);
		}
		case "line":
			return (
				<Line
					points={[startX, startY, currentX, currentY]}
					stroke={DRAFT_STROKE_COLOR}
					strokeWidth={1}
					dash={DRAFT_DASH}
					listening={false}
				/>
			);
	}
}
