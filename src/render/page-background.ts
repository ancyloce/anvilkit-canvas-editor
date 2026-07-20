import type { CanvasPageBackground } from "@anvilkit/canvas-core";

/**
 * FR-063: the Konva fill for a page background. `solid` is the only kind
 * with first-class rendering — the schema reserves `image`/`gradient`, but
 * their `value` has no defined format yet, and feeding an arbitrary string
 * into a canvas `fillStyle` is undefined behavior (invalid values silently
 * keep the PREVIOUS fillStyle, so pages could paint with whatever color was
 * drawn last). Non-solid kinds therefore render the neutral default page
 * white, matching the SVG serializer, which emits a typed
 * `BACKGROUND_UNSUPPORTED` warning for them instead of guessing. The live
 * stage, the thumbnail/export rasterizer, and the serializer stay in
 * agreement by construction.
 */
export const FALLBACK_PAGE_BACKGROUND = "#ffffff";

export function pageBackgroundFill(background: CanvasPageBackground): string {
	return background.kind === "solid"
		? background.value
		: FALLBACK_PAGE_BACKGROUND;
}
