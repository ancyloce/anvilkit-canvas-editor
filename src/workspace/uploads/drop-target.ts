import {
	type AffineMatrix,
	type CanvasFrameNode,
	type CanvasImageNode,
	type CanvasNode,
	isContainerNode,
	isFrameNode,
	multiplyMatrix,
	pointInNode,
	toAffineMatrix,
} from "@anvilkit/canvas-core";
import { isImageWell } from "../../selection/frame-image-actions.js";

const IDENTITY: AffineMatrix = [1, 0, 0, 1, 0, 0];

/**
 * FR-093 drop-target resolution: what a single dragged image should REPLACE
 * at a page point — an existing image node (its `assetId` swaps via
 * `image.replace`, preserving bounds/transform/crop), or an image-well frame
 * (filled via `buildFillFrameCommands`). `undefined` means "no replace
 * target here" and the caller falls back to plain insertion (FR-092).
 */
export type CanvasDropTarget =
	| { kind: "image"; node: CanvasImageNode }
	| { kind: "well"; frame: CanvasFrameNode };

function isImageNode(node: CanvasNode): node is CanvasImageNode {
	return node.type === "image";
}

/**
 * Container-aware, paint-order point query over the active page's children —
 * the same traversal contract as `tools/frame-target.ts` (its doc comment is
 * the canonical description): later siblings win, nested candidates beat
 * ancestors, groups are transparent, locked/hidden nodes are never targets,
 * and a clipped frame hides its subtree outside its box. Candidates here are
 * image NODES and empty-or-filled image-WELL frames; when a filled well's
 * image child is hit it wins (deliberately — `image.replace` on the child
 * re-points the well's placeholder in the same undo step via `wellOf`).
 */
export function resolveDropTarget(
	nodes: readonly CanvasNode[],
	world: { x: number; y: number },
	parentMatrix: AffineMatrix = IDENTITY,
): CanvasDropTarget | undefined {
	let target: CanvasDropTarget | undefined;
	for (const node of nodes) {
		if (node.visible === false || node.locked === true) continue;
		if (isImageNode(node) && pointInNode(node, world, parentMatrix)) {
			target = { kind: "image", node };
			continue;
		}
		if (!isContainerNode(node)) continue;
		const frame = isFrameNode(node) ? node : null;
		const inside = frame ? pointInNode(frame, world, parentMatrix) : true;
		if (frame?.clip && !inside) continue;
		if (frame && inside && isImageWell(frame)) {
			target = { kind: "well", frame };
		}
		const worldMatrix = multiplyMatrix(
			parentMatrix,
			toAffineMatrix(node.transform),
		);
		const inner = resolveDropTarget(node.children, world, worldMatrix);
		if (inner) target = inner;
	}
	return target;
}
