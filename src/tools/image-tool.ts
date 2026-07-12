import {
	type CanvasCommand,
	type CanvasNodeCreateCommand,
	createImage,
} from "@anvilkit/canvas-core";
import { buildFillFrameCommands } from "../selection/frame-image-actions.js";
import { findFrameAtPoint } from "./frame-target.js";
import type { Tool, ToolContext } from "./tool-types.js";

const DEFAULT_IMAGE_WIDTH = 200;
const DEFAULT_IMAGE_HEIGHT = 200;

/**
 * MVP-7: single click → host's pickAsset() resolves → exactly one undo step
 * commits. pointermove/pointerup are not implemented (no drag interaction),
 * so the MVP-7 down→move*→up sequence yields ≤ 1 undoable action.
 *
 * If pickAsset rejects (user cancels) or returns an empty string, no commit
 * fires. The async resolution happens out-of-band — selection is set once
 * the promise resolves, which can be after the pointer interaction is over.
 *
 * Clicking INSIDE a frame targets that frame (the innermost one, per
 * {@link findFrameAtPoint}) and places the image as its clipped child rather
 * than dropping a loose image on top of it. Filling an image well may need two
 * commands (the child + the frame's placeholder), which is why this goes
 * through `commitBatch` — one gesture stays one undo step.
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

			const ir = ctx.getIR();
			const page = ir.pages.find((p) => p.id === ctx.activePageId);
			const frame = page ? findFrameAtPoint(page.root.children, e.point) : null;

			if (frame) {
				const commands = buildFillFrameCommands({
					frame,
					assetId,
					asset: ir.assets[assetId],
					pageId: ctx.activePageId,
				});
				// Re-placing the asset already in the well is a no-op, not an undo step.
				if (commands.length === 0) return;
				commitAsOne(ctx, commands, "Place image");
				selectPlaced(ctx, commands, frame.id);
				return;
			}

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

/**
 * One undo step. `ToolContext.commitBatch` is optional (lightweight tool-test
 * contexts may omit it), so fall back to per-command `commit` — which costs the
 * single-undo-step guarantee, hence the single-command fast path first.
 */
function commitAsOne(
	ctx: ToolContext,
	commands: readonly CanvasCommand[],
	label: string,
): void {
	const [first] = commands;
	if (commands.length === 1 && first) {
		ctx.commit(first);
		return;
	}
	if (ctx.commitBatch) {
		ctx.commitBatch(commands, label);
		return;
	}
	for (const cmd of commands) ctx.commit(cmd);
}

/** Select the image the gesture put in the frame: the new child, or the replaced one. */
function selectPlaced(
	ctx: ToolContext,
	commands: readonly CanvasCommand[],
	frameId: string,
): void {
	let id = frameId;
	for (const cmd of commands) {
		if (cmd.type === "node.create") {
			id = cmd.node.id;
			break;
		}
		if (cmd.type === "image.replace") {
			id = cmd.nodeId;
			break;
		}
	}
	ctx.selectionStore.getState().setSelection([id]);
}
