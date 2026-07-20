"use client";

import { Rect } from "react-konva";
import { useCanvasStudio } from "../context/canvas-studio-context.js";
import { pageBackgroundFill } from "../render/page-background.js";

/**
 * Page-background fill for the LIVE stage (M0-04). Draws the same page-sized
 * background `<Rect>` the thumbnail rasterizer draws, so the canvas and the
 * page navigator agree — this replaced a null stub that made
 * `page.background` invisible on the live stage while thumbnails showed it.
 * Fill resolution goes through {@link pageBackgroundFill} (FR-063): solid
 * values render as-is; reserved gradient/image kinds render the neutral
 * fallback instead of leaking a raw non-color string into Konva.
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
			fill={pageBackgroundFill(page.background)}
			listening={false}
		/>
	);
}
