import type Konva from "konva";
import type { RenderLayerName } from "../stage/RenderLayer.js";

/**
 * Editor-only RenderLayers that must NOT appear in an exported preview:
 * the selection chrome (transformer handles, draft outlines, smart guides,
 * pen/path overlays) and collaborator presence (remote cursors/selections).
 * `background`, `objects`, and `drag` are real design content and are kept.
 */
const CHROME_LAYER_NAMES = new Set<RenderLayerName>(["selection", "presence"]);

export interface ExportStageContentOptions {
	/** Defaults handled by the caller; forwarded verbatim to `toDataURL`. */
	readonly pixelRatio?: number;
	readonly mimeType?: "image/png" | "image/jpeg" | "image/webp";
	readonly quality?: number;
}

/**
 * Serialize a live editor stage to a data URL with the editor-only chrome
 * layers hidden, so the exported preview shows only design content — not the
 * selection transformer, smart guides, or remote-presence overlays the user
 * happened to have on screen at export time.
 *
 * Konva's `toDataURL` composes only visible layers, so we flip the chrome
 * layers invisible for the duration of the serialize and restore them in a
 * `finally` (the stage is normally about to unmount, but we never leave it in
 * a mutated visual state). Stages that don't expose `getLayers` (e.g. unit-test
 * fakes) fall through to a plain `toDataURL` — there are no layers to hide.
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

	try {
		return stage.toDataURL(options);
	} finally {
		for (const layer of hidden) layer.visible(true);
		if (hidden.length > 0 && typeof stage.batchDraw === "function") {
			stage.batchDraw();
		}
	}
}
