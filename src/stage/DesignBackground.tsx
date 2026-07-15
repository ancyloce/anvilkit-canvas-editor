"use client";

import { Rect } from "react-konva";
import { useCanvasStudio } from "../context/canvas-studio-context.js";

/**
 * Page-background fill for the LIVE stage (M0-04). Draws the same page-sized
 * `<Rect fill={page.background.value}>` the thumbnail rasterizer draws, so
 * the canvas and the page navigator agree — this replaced a null stub that
 * made `page.background` invisible on the live stage while thumbnails showed
 * it. Gradient/image background kinds currently paint their raw `value`
 * exactly like the rasterizer; real gradient/image backgrounds arrive with
 * page settings (PRD 0012 FR-063).
 */
export function DesignBackground(): React.JSX.Element | null {
	const { ir, activePageId } = useCanvasStudio();
	const page = ir.pages.find((p) => p.id === activePageId);
	if (!page) return null;
	return (
		<Rect
			x={0}
			y={0}
			width={page.size.width}
			height={page.size.height}
			fill={page.background.value}
			listening={false}
		/>
	);
}
