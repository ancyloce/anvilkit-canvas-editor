import {
	type CanvasCommand,
	type CanvasNodeCreateCommand,
	createImage,
} from "@anvilkit/canvas-core";
import type { CanvasPickedAsset } from "../assets/adapter-types.js";
import { buildAssetInsertCommands } from "../assets/upload-actions.js";
import { buildFillFrameCommands } from "../selection/frame-image-actions.js";
import { findFrameAtPoint } from "./frame-target.js";
import type { Tool, ToolContext } from "./tool-types.js";

const DEFAULT_IMAGE_WIDTH = 200;
const DEFAULT_IMAGE_HEIGHT = 200;

/**
 * MVP-7: single click → host's pickAsset()/pickAssets() resolves → exactly
 * one undo step commits. pointermove/pointerup are not implemented (no drag
 * interaction), so the MVP-7 down→move*→up sequence yields ≤ 1 undoable
 * action.
 *
 * If the picker rejects (user cancels) or returns nothing, no commit fires.
 * The async resolution happens out-of-band — selection is set once the
 * promise resolves, which can be after the pointer interaction is over.
 *
 * Clicking INSIDE a frame targets that frame (the innermost one, per
 * {@link findFrameAtPoint}) and places ONE image (the first picked, when
 * several were picked — a frame's image well is a single slot) as its
 * clipped child rather than dropping a loose image on top of it. Filling an
 * image well may need two commands (the child + the frame's placeholder),
 * which is why this goes through `commitBatch` — one gesture stays one undo
 * step.
 *
 * FR-090 (B-10) multi-select: when `ctx.pickAssets` is wired (a full
 * `assetPicker` adapter) and the user picks more than one image on a click
 * that lands OUTSIDE a frame, every picked image is inserted at once —
 * grid-arranged around the click point via the same
 * {@link buildAssetInsertCommands} core the multi-file drop path uses, so
 * multi-pick and multi-drop look identical. Picking exactly one image keeps
 * the original single-asset behavior (no `asset.put`, default size) byte for
 * byte, whether it came from `pickAssets` or the legacy `pickAsset`.
 */
export const imageTool: Tool = {
	id: "image",
	cursor: "crosshair",

	onPointerDown(e, ctx) {
		const place = async () => {
			let ids: string[];
			let picked: readonly CanvasPickedAsset[] = [];
			if (ctx.pickAssets) {
				try {
					picked = await ctx.pickAssets();
				} catch {
					return; // user cancelled the picker
				}
				if (picked.length === 0) return;
				ids = picked.map((a) => a.id);
			} else {
				let assetId: string;
				try {
					assetId = await ctx.pickAsset();
				} catch {
					return; // user cancelled the picker
				}
				if (!assetId) return;
				ids = [assetId];
			}

			// Re-resolve the active page from the CURRENT document (E-17): the
			// picker await can span an arbitrary amount of time (it's a real user
			// dialog), during which `ctx.activePageId` — snapshotted for this
			// gesture — may no longer exist (the page was deleted or the doc was
			// replaced). Bail rather than commit against a vanished page.
			try {
				const ir = ctx.getIR();
				const page = ir.pages.find((p) => p.id === ctx.activePageId);
				if (!page) return;
				const frame = findFrameAtPoint(page.root.children, e.point);

				if (frame) {
					const assetId = ids[0]!;
					const commands = buildFillFrameCommands({
						frame,
						assetId,
						asset: ir.assets[assetId],
						pageId: page.id,
					});
					// Re-placing the asset already in the well is a no-op, not an undo step.
					if (commands.length === 0) return;
					commitAsOne(ctx, commands, "Place image");
					selectPlaced(ctx, commands, frame.id);
					return;
				}

				if (ids.length > 1) {
					const { commands, nodeIds } = buildAssetInsertCommands(
						picked,
						page,
						e.point,
					);
					if (commands.length === 0) return;
					commitAsOne(ctx, commands, "Add images");
					ctx.selectionStore.getState().setSelection(nodeIds);
					return;
				}

				const node = createImage({
					bounds: {
						width: DEFAULT_IMAGE_WIDTH,
						height: DEFAULT_IMAGE_HEIGHT,
					},
					transform: { x: e.point.x, y: e.point.y },
					assetId: ids[0]!,
				});
				const cmd: CanvasNodeCreateCommand = {
					type: "node.create",
					node,
					pageId: page.id,
				};
				ctx.commit(cmd);
				ctx.selectionStore.getState().setSelection([node.id]);
			} catch {
				// The target page/frame vanished between the picker resolving and
				// the commit — nothing to select, nothing to recover.
			}
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
