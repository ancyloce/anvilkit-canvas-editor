import type {
	CanvasLayoutMeasurementProvider,
	CanvasTextMeasurer,
} from "@anvilkit/canvas-core";
import { measureGlyphWidth } from "./canvas-glyph-measurer.js";
import { fontManifestHash } from "./font-status.js";
import { getCachedLayout } from "./layout-cache.js";
import { layoutRichText } from "./rich-text-layout.js";

/**
 * A `CanvasTextMeasurer` (core's headless text-measurement contract) backed
 * by a real Canvas2D context — pass this to core's
 * `serializePageToSvg({ textMeasurer })` (or `canvasToSvg` in
 * `@anvilkit/plugin-export-canvas`) so an SVG export wraps rich text at
 * exactly the points the stage does. Both paths go through the same internal
 * layout function; only the glyph-width source differs from what the stage
 * renderer (`CanvasNodeRenderer.tsx`) uses, and it is the same source.
 *
 * Routes through the editor's ONE measurement cache (T-M3-04), keyed on the
 * request's own `defaults` and the live font manifest — an export and the
 * stage therefore share measurements instead of re-laying-out.
 */
export function createCanvasTextMeasurer(): CanvasTextMeasurer {
	return (request) =>
		getCachedLayout(
			request.paragraphs,
			request.width,
			request.wrap,
			() => layoutRichText(request, measureGlyphWidth),
			{ defaults: request.defaults, manifestHash: fontManifestHash() },
		);
}

/**
 * The editor's `CanvasLayoutMeasurementProvider` for `resolveCanvasLayout`
 * (T-M3-04 step 5). `measureText` is the cached Canvas2D measurer above;
 * `manifestHash` is a live getter over the font-status registry, so a
 * resolution after a font load sees a new manifest and re-measures instead of
 * reusing pre-load metrics.
 *
 * `getIntrinsicAssetSize` is deliberately not supplied: the resolver consults
 * the document's own `ir.assets[id].width/height` FIRST (the authoritative
 * path an export worker also has), and the editor records intrinsic sizes
 * there on import.
 */
export function createCanvasLayoutMeasurementProvider(): CanvasLayoutMeasurementProvider {
	return {
		measureText: createCanvasTextMeasurer(),
		get manifestHash(): string {
			return fontManifestHash();
		},
	};
}
