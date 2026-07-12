import type { CanvasTextMeasurer } from "@anvilkit/canvas-core";
import { measureGlyphWidth } from "./canvas-glyph-measurer.js";
import { layoutRichText } from "./rich-text-layout.js";

/**
 * A `CanvasTextMeasurer` (core's headless text-measurement contract) backed
 * by a real Canvas2D context — pass this to core's
 * `serializePageToSvg({ textMeasurer })` (or `canvasToSvg` in
 * `@anvilkit/plugin-export-canvas`) so an SVG export wraps rich text at
 * exactly the points the stage does. Both paths go through the same internal
 * layout function; only the glyph-width source differs from what the stage
 * renderer (`CanvasNodeRenderer.tsx`) uses, and it is the same source.
 */
export function createCanvasTextMeasurer(): CanvasTextMeasurer {
	return (request) => layoutRichText(request, measureGlyphWidth);
}
