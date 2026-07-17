import type { CanvasNode } from "@anvilkit/canvas-core";

/** Rect/frame carry an optional uniform `radius` and per-corner `cornerRadii`. */
export type RoundableNode = CanvasNode & {
	radius?: number;
	cornerRadii?: unknown;
	bounds: { width: number; height: number };
};

/** True for the node kinds that support a corner radius (FR-076). */
export function isRoundable(node: CanvasNode): node is RoundableNode {
	return node.type === "rect" || node.type === "frame";
}

/** The largest radius that still fits the box — half its shorter side. */
export function maxCornerRadius(node: {
	bounds: { width: number; height: number };
}): number {
	return Math.max(0, Math.min(node.bounds.width, node.bounds.height) / 2);
}

/**
 * FR-076 drag-to-adjust: turn a pointer delta (already converted to LOCAL
 * units) into a new uniform radius. The handle rides the top-left→center
 * diagonal, so the radius follows the average of the two axes' movement,
 * clamped to `[0, maxRadius]`.
 */
export function computeCornerRadiusDrag(
	startRadius: number,
	dxLocal: number,
	dyLocal: number,
	maxRadius: number,
): number {
	const next = startRadius + (dxLocal + dyLocal) / 2;
	return Math.max(0, Math.min(maxRadius, Math.round(next)));
}
