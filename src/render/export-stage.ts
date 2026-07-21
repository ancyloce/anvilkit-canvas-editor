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

	type Vector2d = { x: number; y: number };
	const scaleFn = (stage as { scale?: (v?: Vector2d) => Vector2d }).scale;
	const positionFn = (stage as { position?: (v?: Vector2d) => Vector2d })
		.position;
	const prevScale = typeof scaleFn === "function" ? scaleFn.call(stage) : null;
	const prevPosition =
		typeof positionFn === "function" ? positionFn.call(stage) : null;
	const viewportChanged =
		(prevScale !== null && (prevScale.x !== 1 || prevScale.y !== 1)) ||
		(prevPosition !== null && (prevPosition.x !== 0 || prevPosition.y !== 0));
	if (viewportChanged) {
		scaleFn?.call(stage, { x: 1, y: 1 });
		positionFn?.call(stage, { x: 0, y: 0 });
	}

	try {
		return stage.toDataURL(options);
	} finally {
		for (const layer of hidden) layer.visible(true);
		for (const node of hiddenGroups) node.visible(true);
		if (viewportChanged) {
			if (prevScale) scaleFn?.call(stage, prevScale);
			if (prevPosition) positionFn?.call(stage, prevPosition);
		}
		if (
			hidden.length + hiddenGroups.length + (viewportChanged ? 1 : 0) > 0 &&
			typeof stage.batchDraw === "function"
		) {
			stage.batchDraw();
		}
	}
}
