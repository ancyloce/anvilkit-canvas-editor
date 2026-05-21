import {
	type CanvasNodeCreateCommand,
	createImage,
} from "@anvilkit/canvas-core";
import type { Tool } from "./tool-types.js";

const DEFAULT_IMAGE_WIDTH = 200;
const DEFAULT_IMAGE_HEIGHT = 200;

/**
 * MVP-7: single click → host's pickAsset() resolves → exactly one node.create
 * commits. pointermove/pointerup are not implemented (no drag interaction),
 * so the MVP-7 down→move*→up sequence yields ≤ 1 command.
 *
 * If pickAsset rejects (user cancels) or returns an empty string, no commit
 * fires. The async resolution happens out-of-band — selection is set once
 * the promise resolves, which can be after the pointer interaction is over.
 */
export const imageTool: Tool = {
	id: "image",
	cursor: "crosshair",

	onPointerDown(e, ctx) {
		const place = async () => {
			let assetId: string;
			try {
				assetId = await ctx.pickAsset();
			} catch {
				return; // user cancelled the picker
			}
			if (!assetId) return;
			const node = createImage({
				bounds: {
					width: DEFAULT_IMAGE_WIDTH,
					height: DEFAULT_IMAGE_HEIGHT,
				},
				transform: { x: e.point.x, y: e.point.y },
				assetId,
			});
			const cmd: CanvasNodeCreateCommand = {
				type: "node.create",
				node,
				pageId: ctx.activePageId,
			};
			ctx.commit(cmd);
			ctx.selectionStore.getState().setSelection([node.id]);
		};
		void place();
	},
};
