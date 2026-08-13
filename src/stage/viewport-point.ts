import type { CanvasStudioContextValue } from "../context/canvas-studio-context.js";

/** The slice of the studio context the mappings here actually read. */
export type ViewportPointContext = Pick<
	CanvasStudioContextValue,
	"stage" | "viewportStore"
>;

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
function stageContainer(ctx: ViewportPointContext): HTMLElement | null {
	const stage = ctx.stage;
	return stage && typeof stage.container === "function"
		? stage.container()
		: null;
}

/**
 * Attribute marking the stage FOOTPRINT — the in-flow element spanning
 * `page × zoom` that the K-1 windowed stage positions its (smaller) canvas
 * window inside. A runtime contract like {@link CANVAS_VIEWPORT_ATTRIBUTE}.
 *
 * Every screen ↔ page mapping in this file anchors on the footprint when
 * one exists: `footprintRect.origin + page × zoom + pan` is the page-origin
 * anchor REGARDLESS of where the canvas window currently sits, because the
 * stage's Konva position compensates the window offset exactly
 * (`stage.x = pan − window.x` while the container div sits at `window.x`
 * inside the footprint — the two cancel). Anchoring here rather than on the
 * stage transform keeps the mapping reactive to the viewport store with no
 * commit lag, and keeps the pre-K-1 formula bit-for-bit for stages mounted
 * without a footprint (bare hosts, unit-test fakes, the offscreen
 * rasterizer).
 */
export const CANVAS_STAGE_FOOTPRINT_ATTRIBUTE = "data-canvas-stage-footprint";

/**
 * The rect page-space maps against: the K-1 footprint when the container is
 * mounted inside one, else the container itself (identical before K-1, and
 * still identical whenever the stage is not windowed).
 */
function pageAnchorRect(ctx: ViewportPointContext): { left: number; top: number } | undefined {
	const container = stageContainer(ctx);
	if (!container) return undefined;
	const footprint = container.closest?.(
		`[${CANVAS_STAGE_FOOTPRINT_ATTRIBUTE}]`,
	);
	const rect = (footprint ?? container).getBoundingClientRect?.();
	return rect ?? container.getBoundingClientRect?.();
}

/**
 * Convert a drop event's screen coordinates into page-space coordinates
 * (FR-092 "inserted at the drop position"). The inverse of
 * {@link pageToClientPoint}. Returns undefined when there's no live stage to
 * anchor against, so callers fall back to page-center insertion.
 */
export function clientPointToPage(
	ctx: ViewportPointContext,
	clientX: number,
	clientY: number,
): { x: number; y: number } | undefined {
	const rect = pageAnchorRect(ctx);
	if (!rect) return undefined;
	const vp = ctx.viewportStore.getState();
	return {
		x: (clientX - rect.left - vp.panX) / vp.zoom,
		y: (clientY - rect.top - vp.panY) / vp.zoom,
	};
}

/**
 * The screen (client) position of a page-space point — the ONE forward
 * mapping shared by every DOM overlay anchored to canvas content
 * (`TextEditorOverlay`, `RichTextToolbar`, `CropEditorOverlay`,
 * `CornerRadiusOverlay`). Each of those used to inline
 * `containerRect + page × zoom + pan`, which silently assumed the stage
 * container starts at the page origin; under the K-1 windowed stage that is
 * the FOOTPRINT's origin, not the container's (see
 * {@link CANVAS_STAGE_FOOTPRINT_ATTRIBUTE}). Returns undefined without a
 * measurable anchor, so callers can skip rendering rather than anchor at
 * (0,0).
 */
export function pageToClientPoint(
	ctx: ViewportPointContext,
	pageX: number,
	pageY: number,
): { x: number; y: number } | undefined {
	const rect = pageAnchorRect(ctx);
	if (!rect) return undefined;
	const vp = ctx.viewportStore.getState();
	return {
		x: rect.left + pageX * vp.zoom + vp.panX,
		y: rect.top + pageY * vp.zoom + vp.panY,
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
 * `undefined` when the stage is unmeasurable: no mounted stage, or a rect with
 * NO positive area (jsdom's default, and any container that has not been laid
 * out yet). Callers fall back to the page centre rather than inserting at the
 * page origin — an element pinned to (0, 0) reads as a bug, and "no measurement
 * means centre of the page" is the fallback `buildAssetInsertCommands` already
 * uses for an out-of-bounds drop.
 *
 * EITHER dimension being zero is enough to disqualify the rect, not both. A
 * container measured mid-layout as `{ width: 800, height: 0 }` is not a
 * measurement: the host intersection below cannot satisfy `bottom > top`, so
 * the centre collapses onto `rect.top` and the element lands at the top edge —
 * off-page once its own height is subtracted — while the documented page-centre
 * fallback is skipped because a point WAS returned.
 */
export function viewportCenterInPage(
	ctx: ViewportPointContext,
): { x: number; y: number } | undefined {
	const container = stageContainer(ctx);
	const rect = container?.getBoundingClientRect?.();
	if (!rect || rect.width <= 0 || rect.height <= 0) return undefined;
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
