import {
	type CanvasAssetRef,
	type CanvasCommand,
	type CanvasFrameNode,
	type CanvasImageNode,
	type CanvasNodeCreateCommand,
	type CanvasNodeUpdateCommand,
	createImage,
	isFrameNode,
	parentOf,
} from "@anvilkit/canvas-core";
import type { CanvasStudioContextValue } from "../context/canvas-studio-context.js";

/**
 * A frame carrying a `placeholder` is an image *well*: it holds exactly one
 * image, and filling it again replaces that image rather than stacking a second
 * one. A frame WITHOUT a placeholder is a plain container, where images
 * legitimately accumulate as children.
 */
export function isImageWell(frame: CanvasFrameNode): boolean {
	return frame.placeholder !== undefined;
}

/** The image node currently filling a well, if any. */
export function wellImage(frame: CanvasFrameNode): CanvasImageNode | undefined {
	const byPlaceholder = frame.placeholder?.assetId;
	const images = frame.children.filter(
		(c): c is CanvasImageNode => c.type === "image",
	);
	if (byPlaceholder !== undefined) {
		const match = images.find((i) => i.assetId === byPlaceholder);
		if (match) return match;
	}
	return images[0];
}

/**
 * Geometry for an image that COVERS a frame: scaled to fill the frame's box
 * while preserving the asset's aspect ratio, centred, with the overflow left for
 * the frame's clip to trim — the same contract as CSS `object-fit: cover`.
 *
 * The returned transform is in the frame's LOCAL space, because the image is
 * inserted as the frame's child.
 *
 * When the asset's natural size is unknown (`CanvasAssetRef.width/height` are
 * optional and hosts often omit them) there is no aspect ratio to preserve, so
 * the image is stretched to the box instead.
 */
export function coverGeometry(
	frame: CanvasFrameNode,
	asset: CanvasAssetRef | undefined,
): { transform: { x: number; y: number }; bounds: CanvasFrameNode["bounds"] } {
	const { width: fw, height: fh } = frame.bounds;
	const aw = asset?.width;
	const ah = asset?.height;
	if (!aw || !ah || aw <= 0 || ah <= 0) {
		return { transform: { x: 0, y: 0 }, bounds: { width: fw, height: fh } };
	}
	const scale = Math.max(fw / aw, fh / ah);
	const width = aw * scale;
	const height = ah * scale;
	return {
		transform: { x: (fw - width) / 2, y: (fh - height) / 2 },
		bounds: { width, height },
	};
}

export interface FillFrameOptions {
	frame: CanvasFrameNode;
	assetId: string;
	asset: CanvasAssetRef | undefined;
	pageId: string;
}

/**
 * The commands that put `assetId` into `frame`, as ONE logical action. Callers
 * hand the result to `commitBatch`, so the whole thing is a single undo step.
 *
 * Three shapes, by what the frame already is:
 *   - an image well that is already filled → `image.replace` on the existing
 *     child (preserving its geometry AND its crop) + re-point the placeholder;
 *   - an empty image well → insert the cover-sized child + fill the placeholder;
 *   - a plain frame → just insert the child.
 *
 * Deliberately NEVER flattens: the frame and the image stay separate nodes, and
 * the asset is carried by the child image, not baked into the frame. That
 * matches core's SVG serializer, which treats a resolved placeholder as an
 * `<image>` child clipped by the frame.
 */
export function buildFillFrameCommands(
	opts: FillFrameOptions,
): CanvasCommand[] {
	const { frame, assetId, asset, pageId } = opts;
	const existing = isImageWell(frame) ? wellImage(frame) : undefined;

	if (existing) {
		// Replace in place. `image.replace` only swaps `assetId`, so the child's
		// bounds, transform and `crop` all survive — that is the "frame geometry
		// and crop container are preserved" requirement.
		if (existing.assetId === assetId) return [];
		const commands: CanvasCommand[] = [
			{
				type: "image.replace",
				nodeId: existing.id,
				fromAssetId: existing.assetId,
				toAssetId: assetId,
			},
		];
		commands.push(placeholderPatch(frame, assetId));
		return commands;
	}

	const geo = coverGeometry(frame, asset);
	const node = createImage({
		bounds: geo.bounds,
		transform: geo.transform,
		assetId,
	});
	const create: CanvasNodeCreateCommand = {
		type: "node.create",
		node,
		pageId,
		parentId: frame.id,
	};
	const commands: CanvasCommand[] = [create];
	if (isImageWell(frame)) commands.push(placeholderPatch(frame, assetId));
	return commands;
}

/** Re-point the well's placeholder at the asset now filling it. */
function placeholderPatch(
	frame: CanvasFrameNode,
	assetId: string,
): CanvasNodeUpdateCommand<"frame"> {
	return {
		type: "node.update",
		nodeId: frame.id,
		kind: "frame",
		patch: {
			placeholder: { ...(frame.placeholder ?? { kind: "image" }), assetId },
		},
	};
}

/**
 * The frame whose well `node` fills, if any. An image is only a well's content
 * when its direct parent is a frame carrying a placeholder — an image merely
 * sitting inside a plain frame is an ordinary child.
 */
export function wellOf(
	ctx: CanvasStudioContextValue,
	node: CanvasImageNode,
): CanvasFrameNode | undefined {
	const parent = parentOf(ctx.getIR(), node.id)?.parent;
	if (!parent || !isFrameNode(parent) || !isImageWell(parent)) return undefined;
	return parent;
}

/**
 * The command list {@link replaceImage} commits — exported so other entry
 * points into the SAME replacement pipeline (context menu, FR-093
 * drag-to-replace) can compose it into a larger atomic batch (e.g. with the
 * `asset.put` of a just-uploaded file) instead of re-deriving the semantics.
 * Empty when the swap is a no-op.
 */
export function buildReplaceImageCommands(
	ctx: CanvasStudioContextValue,
	node: CanvasImageNode,
	assetId: string,
): CanvasCommand[] {
	if (!assetId || assetId === node.assetId) return [];
	const commands: CanvasCommand[] = [
		{
			type: "image.replace",
			nodeId: node.id,
			fromAssetId: node.assetId,
			toAssetId: assetId,
		},
	];
	const frame = wellOf(ctx, node);
	if (frame) commands.push(placeholderPatch(frame, assetId));
	return commands;
}

/**
 * Swap the asset behind an image, preserving its bounds, transform and `crop` —
 * `image.replace` only touches `assetId`. When the image fills a frame's well,
 * the frame's placeholder is re-pointed at the new asset in the SAME undo step,
 * so the two never drift apart.
 */
export function replaceImage(
	ctx: CanvasStudioContextValue,
	node: CanvasImageNode,
	assetId: string,
): boolean {
	const commands = buildReplaceImageCommands(ctx, node, assetId);
	if (commands.length === 0) return false;
	if (commands.length === 1 && commands[0]) ctx.commit(commands[0]);
	else ctx.commitBatch(commands, "Replace image");
	return true;
}

/** Put a freshly-picked asset into a frame, as one undo step. */
export async function replaceFrameImage(
	ctx: CanvasStudioContextValue,
	frame: CanvasFrameNode,
): Promise<boolean> {
	let assetId: string;
	try {
		assetId = await ctx.pickAsset();
	} catch {
		return false; // user cancelled the picker
	}
	if (!assetId) return false;

	const ir = ctx.getIR();
	const commands = buildFillFrameCommands({
		frame,
		assetId,
		asset: ir.assets[assetId],
		pageId: ctx.activePageId,
	});
	if (commands.length === 0) return false; // already the well's asset
	if (commands.length === 1 && commands[0]) ctx.commit(commands[0]);
	else ctx.commitBatch(commands, "Replace image");
	return true;
}

/**
 * Drop the crop on the image filling a frame's well, restoring the full asset.
 * The frame itself is untouched — its bounds, clip and radius are what make the
 * crop *look* cropped, and they must survive a reset.
 */
export function resetFrameCrop(
	ctx: CanvasStudioContextValue,
	frame: CanvasFrameNode,
): boolean {
	const image = wellImage(frame);
	if (!image || image.crop === undefined) return false;
	const cmd: CanvasNodeUpdateCommand<"image"> = {
		type: "node.update",
		nodeId: image.id,
		kind: "image",
		patch: { crop: undefined },
	};
	ctx.commit(cmd);
	return true;
}

/** Picker-driven {@link replaceImage}, for the image inspector's Replace button. */
export async function pickAndReplaceImage(
	ctx: CanvasStudioContextValue,
	node: CanvasImageNode,
): Promise<boolean> {
	let assetId: string;
	try {
		assetId = await ctx.pickAsset();
	} catch {
		return false; // user cancelled the picker
	}
	if (!assetId) return false;
	return replaceImage(ctx, node, assetId);
}
