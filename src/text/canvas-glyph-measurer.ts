import type { ResolvedSpanStyle } from "@anvilkit/canvas-core";
import type { GlyphWidthMeasurer } from "./rich-text-layout.js";

/**
 * A shared offscreen Canvas2D context, created lazily on first use. `font` is
 * reassigned per call (cheap) rather than creating a new canvas per measure.
 */
let measureContext: CanvasRenderingContext2D | null | undefined;

function getMeasureContext(): CanvasRenderingContext2D | null {
	if (measureContext === undefined) {
		measureContext = document.createElement("canvas").getContext("2d");
	}
	return measureContext;
}

function fontString(style: ResolvedSpanStyle): string {
	const italic = style.italic ? "italic " : "";
	return `${italic}${style.fontWeight} ${style.fontSize}px ${style.fontFamily}`;
}

/**
 * Approximate glyph width used only when no 2D context is available (jsdom
 * has no canvas backend by default — see `rich-text-layout.test.ts`'s stub
 * for the same reason). Keeps the stage renderable instead of throwing; real
 * browsers always take the `measureText` path above.
 */
const FALLBACK_CHAR_WIDTH_RATIO = 0.55;

/** {@link GlyphWidthMeasurer} backed by a real Canvas2D `measureText`. */
export const measureGlyphWidth: GlyphWidthMeasurer = (text, style) => {
	if (text.length === 0) return 0;
	const ctx = getMeasureContext();
	if (!ctx) return text.length * style.fontSize * FALLBACK_CHAR_WIDTH_RATIO;
	ctx.font = fontString(style);
	return ctx.measureText(text).width;
};
