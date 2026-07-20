import type Konva from "konva";
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
 * layer's background group (`<Group name="grid">` in `Grid.tsx`). Hidden by
 * Konva name-selector (`.grid`) for the duration of the serialize.
 */
const CHROME_GROUP_NAMES: readonly string[] = ["grid"];

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
 * a mutated visual state). Named chrome GROUPS inside kept layers (see
 * {@link CHROME_GROUP_NAMES}) get the same hide/restore treatment via
 * `stage.find`. Stages that don't expose `getLayers`/`find` (e.g. unit-test
 * fakes) fall through to a plain `toDataURL` — there is no chrome to hide.
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
		stage as { find?: (selector: string) => ReadonlyArray<Konva.Node> }
	).find;
	const hiddenGroups: Konva.Node[] = [];
	if (typeof find === "function") {
		for (const name of CHROME_GROUP_NAMES) {
			for (const node of find.call(stage, `.${name}`)) {
				if (node.visible()) {
					node.visible(false);
					hiddenGroups.push(node);
				}
			}
		}
	}

	try {
		return stage.toDataURL(options);
	} finally {
		for (const layer of hidden) layer.visible(true);
		for (const node of hiddenGroups) node.visible(true);
		if (
			hidden.length + hiddenGroups.length > 0 &&
			typeof stage.batchDraw === "function"
		) {
			stage.batchDraw();
		}
	}
}
