"use client";

import { findNode } from "@anvilkit/canvas-core";
import { useSyncExternalStore } from "react";
import { Rect } from "react-konva";
import { useCanvasStudio } from "../context/canvas-studio-context.js";

/** Distinct from the selection Transformer's accent so focus ≠ selection. */
const FOCUS_RING_STROKE = "#22c55e";
const FOCUS_RING_NAME = "ak-focus-ring";

/**
 * Konva overlay (a11y): outlines the roving keyboard-focused node so sighted
 * keyboard users see where focus is — independent of selection. Lives on the
 * selection layer (inside the stage, so it inherits the zoom/pan transform) and
 * is non-interactive. Renders nothing when nothing is focused.
 */
export function CanvasFocusRing(): React.JSX.Element | null {
	const ctx = useCanvasStudio();
	const focusedId = useSyncExternalStore(
		ctx.focusStore.subscribe,
		() => ctx.focusStore.getState().focusedId,
		() => ctx.focusStore.getState().focusedId,
	);
	if (!focusedId) return null;
	const found = findNode(ctx.ir, focusedId);
	if (!found || found.page.id !== ctx.activePageId) return null;
	const node = found.node;
	return (
		<Rect
			name={FOCUS_RING_NAME}
			listening={false}
			x={node.transform.x}
			y={node.transform.y}
			width={node.bounds.width}
			height={node.bounds.height}
			rotation={node.transform.rotation}
			stroke={FOCUS_RING_STROKE}
			strokeWidth={1.5}
			dash={[4, 3]}
		/>
	);
}
