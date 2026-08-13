import type Konva from "konva";
import { GRID_CHROME_GROUP_NAME } from "../stage/Grid.js";
import type { RenderLayerName } from "../stage/RenderLayer.js";

/**
 * Editor-only RenderLayers that must NOT appear in an exported preview: the
 * "overlay" layer (persistent guides/layout aids plus selection chrome —
 * transformer handles, draft outlines, smart guides, pen/path overlays) and
 * collaborator presence (remote cursors/selections). `content` (background +
 * objects) and `drag` are real design content and are kept.
 */
const CHROME_LAYER_NAMES = new Set<RenderLayerName>(["overlay", "presence"]);

/**
 * Editor-only named GROUPS that live INSIDE kept layers, so hiding whole
 * layers cannot exclude them: the FR-112 grid renders inside the content
 * layer's background group. Namespaced (`ak-chrome-grid`, not a bare
 * `"grid"`) so it can't collide with a user-authored `CanvasNode.id` — which
 * `CanvasNodeRenderer` also uses as a Konva `name` — and matched via a
 * predicate rather than Konva's `.`-selector string syntax so the match
 * can't accidentally widen if a node's own name ever contains a space
 * (E-13; see `find-node-by-id.ts`).
 */
const CHROME_GROUP_NAMES: readonly string[] = [GRID_CHROME_GROUP_NAME];

export interface ExportStageContentOptions {
	/** Defaults handled by the caller; forwarded verbatim to `toDataURL`. */
	readonly pixelRatio?: number;
	readonly mimeType?: "image/png" | "image/jpeg" | "image/webp";
	readonly quality?: number;
}

/** Explicit capture rectangle handed to `toDataURL` (see {@link surfaceRect}). */
interface SurfaceRect {
	readonly x: number;
	readonly y: number;
	readonly width: number;
	readonly height: number;
}

/**
 * The page rectangle to capture, in unscaled surface units.
 *
 * WITHOUT this, `stage.toDataURL()` does NOT capture the page — Konva's
 * `Node._toKonvaCanvas` falls back to `this.getClientRect()` for both the
 * origin and the size, and for a Stage that resolves to
 * `Container.getClientRect`: the union of every visible child's rect, WITH
 * stroke and shadow included (neither `skipStroke` nor `skipShadow` is passed)
 * and WITHOUT any `clipFunc` applied. So a node overhanging the page edge — or
 * merely carrying a drop shadow, or clipped inside a frame — silently grows the
 * exported image and pushes the page off its own origin, and a content-only
 * export (no page background) crops to whatever the content happens to span.
 * `DesignBackground` draws a page-sized `Rect` at (0,0) on the live stage,
 * which hides all of that for documents whose content stays inside the page —
 * which is exactly why it reads as correct until it isn't.
 *
 * The rect is READ OFF THE STAGE rather than passed in, so every caller
 * keeps the "content-only, 1:1, page-bounded" guarantee for free (E-14).
 * The authoritative source is the `akSurfaceSize` attr `<CanvasStage>`
 * attaches — the unscaled page (or Source-root) size. It exists because the
 * K-1 windowed stage broke the old derivation: `stage.width()` is the
 * VIEWPORT WINDOW under K-1, not `surface × zoom`, so dividing it by the
 * scale recovers a slice of the page, and a live-stage raster export would
 * be cropped to whatever happened to be on screen. The `stage.width() /
 * scale.x` derivation is kept as the fallback for stages mounted without
 * the attr (host code composing `<CanvasStage>` directly, older unit-test
 * fakes) — those are never windowed, so it is still correct there.
 *
 * Returns an empty object (preserving Konva's own defaults) when the stage
 * cannot be measured or the scale is degenerate — unit-test fakes that expose
 * only `toDataURL`, and any non-finite/zero scale that would produce a garbage
 * rect.
 */
function surfaceRect(
	stage: Konva.Stage,
	scale: { x: number; y: number } | null,
): SurfaceRect | Record<string, never> {
	const getAttr = (stage as { getAttr?: (key: string) => unknown }).getAttr;
	if (typeof getAttr === "function") {
		const declared = getAttr.call(stage, "akSurfaceSize") as
			| { width?: unknown; height?: unknown }
			| undefined;
		if (
			declared !== undefined &&
			declared !== null &&
			typeof declared.width === "number" &&
			typeof declared.height === "number" &&
			Number.isFinite(declared.width) &&
			Number.isFinite(declared.height) &&
			declared.width > 0 &&
			declared.height > 0
		) {
			return { x: 0, y: 0, width: declared.width, height: declared.height };
		}
	}
	const widthFn = (stage as { width?: () => number }).width;
	const heightFn = (stage as { height?: () => number }).height;
	if (typeof widthFn !== "function" || typeof heightFn !== "function")
		return {};
	const stageWidth = widthFn.call(stage);
	const stageHeight = heightFn.call(stage);
	const scaleX = scale?.x ?? 1;
	const scaleY = scale?.y ?? 1;
	if (
		!Number.isFinite(stageWidth) ||
		!Number.isFinite(stageHeight) ||
		!Number.isFinite(scaleX) ||
		!Number.isFinite(scaleY) ||
		scaleX === 0 ||
		scaleY === 0
	) {
		return {};
	}
	const width = stageWidth / scaleX;
	const height = stageHeight / scaleY;
	if (width <= 0 || height <= 0) return {};
	return { x: 0, y: 0, width, height };
}

/**
 * Serialize a live editor stage to a data URL with the editor-only chrome
 * layers hidden and the viewport's live pan/zoom neutralized, so the exported
 * preview shows only design content, at the page's real 1:1 scale/position —
 * not the transformer handles, guides, or remote-presence overlays the user
 * happened to have on screen, nor whatever pan/zoom their viewport happened
 * to be at, at export time. Every caller of this function shares this
 * guarantee (E-14) — earlier, only the built-in raster exporters neutralized
 * the viewport themselves (E-8); `CanvasExportBridge`-driven DesignBlock
 * previews had no such reset, so a saved preview shifted/cropped (and its
 * resolution varied with zoom) whenever the stage was panned/zoomed.
 *
 * Konva's `toDataURL` composes only visible layers, so we flip the chrome
 * layers invisible for the duration of the serialize and restore them in a
 * `finally` (the stage is normally about to unmount, but we never leave it in
 * a mutated visual state). Named chrome GROUPS inside kept layers (see
 * {@link CHROME_GROUP_NAMES}) get the same hide/restore treatment via
 * `stage.find`. Scale/position are snapshotted, reset to 1:1/0:0, and
 * restored the same way. Stages that don't expose `getLayers`/`find`/
 * `scale`/`position` (e.g. unit-test fakes) skip whichever step they don't
 * support.
 *
 * The capture RECTANGLE is passed explicitly ({@link surfaceRect}) rather than
 * left to Konva's content-bounding-box default, which is what actually bounds
 * the output to the page — see that function for why the default is wrong here.
 */
export function exportStageContentDataURL(
	stage: Konva.Stage,
	options: ExportStageContentOptions = {},
): string {
	const getLayers = (stage as { getLayers?: () => ReadonlyArray<Konva.Layer> })
		.getLayers;
	const layers =
		typeof getLayers === "function" ? getLayers.call(stage) : undefined;

	const hidden: Konva.Layer[] = [];
	if (layers) {
		for (const layer of layers) {
			if (
				CHROME_LAYER_NAMES.has(layer.name() as RenderLayerName) &&
				layer.visible()
			) {
				layer.visible(false);
				hidden.push(layer);
			}
		}
	}

	const find = (
		stage as {
			find?: (
				selector: (node: Konva.Node) => boolean,
			) => ReadonlyArray<Konva.Node>;
		}
	).find;
	const hiddenGroups: Konva.Node[] = [];
	if (typeof find === "function") {
		for (const name of CHROME_GROUP_NAMES) {
			for (const node of find.call(stage, (n) => n.name() === name)) {
				if (node.visible()) {
					node.visible(false);
					hiddenGroups.push(node);
				}
			}
		}
	}

	// K-12: viewport-culled content must not vanish from an export. The
	// culling controller marks every node it hides with `akCulled: true` — a
	// marker it only ever sets on nodes whose DECLARED (IR) visibility is
	// true, which is what makes this unhide unconditional and safe. The
	// inverse of the chrome hiding above, with the same finally-restore.
	const shownCulled: Konva.Node[] = [];
	if (typeof find === "function") {
		for (const node of find.call(
			stage,
			(n) => n.getAttr?.("akCulled") === true,
		)) {
			if (!node.visible()) {
				node.visible(true);
				shownCulled.push(node);
			}
		}
	}

	type Vector2d = { x: number; y: number };
	const scaleFn = (stage as { scale?: (v?: Vector2d) => Vector2d }).scale;
	const positionFn = (stage as { position?: (v?: Vector2d) => Vector2d })
		.position;
	const prevScale = typeof scaleFn === "function" ? scaleFn.call(stage) : null;
	const prevPosition =
		typeof positionFn === "function" ? positionFn.call(stage) : null;
	const surface = surfaceRect(stage, prevScale);
	const viewportChanged =
		(prevScale !== null && (prevScale.x !== 1 || prevScale.y !== 1)) ||
		(prevPosition !== null && (prevPosition.x !== 0 || prevPosition.y !== 0));
	if (viewportChanged) {
		scaleFn?.call(stage, { x: 1, y: 1 });
		positionFn?.call(stage, { x: 0, y: 0 });
	}

	try {
		return stage.toDataURL({ ...options, ...surface });
	} finally {
		for (const layer of hidden) layer.visible(true);
		for (const node of hiddenGroups) node.visible(true);
		for (const node of shownCulled) node.visible(false);
		if (viewportChanged) {
			if (prevScale) scaleFn?.call(stage, prevScale);
			if (prevPosition) positionFn?.call(stage, prevPosition);
		}
		if (
			hidden.length +
				hiddenGroups.length +
				shownCulled.length +
				(viewportChanged ? 1 : 0) >
				0 &&
			typeof stage.batchDraw === "function"
		) {
			stage.batchDraw();
		}
	}
}
