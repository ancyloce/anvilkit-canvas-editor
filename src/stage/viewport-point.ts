import type { CanvasStudioContextValue } from "../context/canvas-studio-context.js";

/**
 * @file Screen ↔ page-space mapping for the live stage (`cp3-004`).
 *
 * ONE inverse of the stage transform, shared by every caller.
 *
 * `clientPointToPage` was previously a module-private function inside
 * `workspace/uploads/CanvasDropZone.tsx`, where it served the FR-092/093 image
 * drop paths alone. `cp3-004` needs the same mapping from the element drop path
 * AND an equivalent one for "the centre of what the user is currently looking
 * at", so it moved here rather than being copied — a second, drifting copy of
 * the zoom/pan inverse is exactly how a drop lands 20 px off at one zoom level
 * and not another. `CanvasDropZone` now imports it; its behaviour is unchanged.
 *
 * Lives in `stage/` beside `node-world-position.ts` and `resolved-page-space.ts`
 * because it is stage geometry, not an action: it reads the Konva container and
 * the viewport store and returns page coordinates, and it commits nothing.
 */

/**
 * The live stage's DOM container, or `null` when there is no mounted stage
 * (SSR, a headless context, or before first paint).
 *
 * Call `container()` AS A METHOD — an unbound reference drops Konva's `this`
 * binding and crashes against a real stage (the same note is on
 * `CropEditorOverlay`/`TextEditorOverlay`).
 */
function stageContainer(ctx: CanvasStudioContextValue): HTMLElement | null {
	const stage = ctx.stage;
	return stage && typeof stage.container === "function"
		? stage.container()
		: null;
}

/**
 * Convert a drop event's screen coordinates into page-space coordinates
 * (FR-092 "inserted at the drop position"). Mirrors — inverted — the
 * container + zoom + pan transform already used to place on-stage overlays
 * (`CropEditorOverlay`/`TextEditorOverlay`/`RichTextToolbar`:
 * `screenX = containerRect.left + pageX * zoom + panX`). Returns undefined
 * when there's no live stage to anchor against, so callers fall back to
 * page-center insertion.
 */
export function clientPointToPage(
	ctx: CanvasStudioContextValue,
	clientX: number,
	clientY: number,
): { x: number; y: number } | undefined {
	const container = stageContainer(ctx);
	const rect = container?.getBoundingClientRect?.();
	if (!rect) return undefined;
	const vp = ctx.viewportStore.getState();
	return {
		x: (clientX - rect.left - vp.panX) / vp.zoom,
		y: (clientY - rect.top - vp.panY) / vp.zoom,
	};
}

/**
 * Attribute marking the scrollable canvas viewport (`PagesCanvas`'s scroll
 * element). A RUNTIME contract, not a test hook — the same role
 * `[data-page-surface="active"]` already plays for `CanvasRulers`, which reads
 * it to place the ruler origin.
 *
 * It exists because the stage container is sized to the active page × zoom, so
 * once the user zooms past "fit" the container is LARGER than what is on
 * screen and its own centre is the page's centre, not the view's. Intersecting
 * the two rects is what makes {@link viewportCenterInPage} mean "the middle of
 * what I can see" at every zoom level.
 */
export const CANVAS_VIEWPORT_ATTRIBUTE = "data-canvas-viewport";

/**
 * The page-space point at the centre of the VISIBLE canvas area.
 *
 * The visible area is the stage container's client rect intersected with the
 * scroll viewport's ({@link CANVAS_VIEWPORT_ATTRIBUTE}); without that ancestor
 * — a bare `<CanvasStudio>` mounted outside the workspace shell — the
 * container's own rect is used, which is correct there because nothing is
 * clipping it.
 *
 * `undefined` when the stage is unmeasurable: no mounted stage, or a
 * zero-by-zero rect (jsdom's default, and any container that has not been laid
 * out yet). Callers fall back to the page centre rather than inserting at the
 * page origin — an element pinned to (0, 0) reads as a bug, and "no measurement
 * means centre of the page" is the fallback `buildAssetInsertCommands` already
 * uses for an out-of-bounds drop.
 */
export function viewportCenterInPage(
	ctx: CanvasStudioContextValue,
): { x: number; y: number } | undefined {
	const container = stageContainer(ctx);
	const rect = container?.getBoundingClientRect?.();
	if (!rect || (rect.width <= 0 && rect.height <= 0)) return undefined;
	const host = container
		?.closest?.(`[${CANVAS_VIEWPORT_ATTRIBUTE}]`)
		?.getBoundingClientRect?.();
	// An empty intersection (the active page scrolled entirely out of view)
	// falls back to the stage's own centre: the alternative is a point outside
	// the page, which `buildAssetInsertCommands` already treats as "centre it".
	const left = host ? Math.max(rect.left, host.left) : rect.left;
	const right = host ? Math.min(rect.right, host.right) : rect.right;
	const top = host ? Math.max(rect.top, host.top) : rect.top;
	const bottom = host ? Math.min(rect.bottom, host.bottom) : rect.bottom;
	const usable = right > left && bottom > top;
	return clientPointToPage(
		ctx,
		usable ? (left + right) / 2 : (rect.left + rect.right) / 2,
		usable ? (top + bottom) / 2 : (rect.top + rect.bottom) / 2,
	);
}
