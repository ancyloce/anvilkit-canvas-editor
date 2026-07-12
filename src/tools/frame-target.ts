import {
	type AffineMatrix,
	type CanvasFrameNode,
	type CanvasNode,
	isContainerNode,
	isFrameNode,
	multiplyMatrix,
	pointInNode,
	toAffineMatrix,
} from "@anvilkit/canvas-core";

const IDENTITY: AffineMatrix = [1, 0, 0, 1, 0, 0];

interface Point {
	x: number;
	y: number;
}

/**
 * The innermost frame whose box contains `world`, or null.
 *
 * This is the editor's only container-aware point query. Everything else stops
 * at `page.root.children`: the select tool resolves a click by walking UP the
 * Konva tree, and `marqueeHits` takes a flat sibling list. Placing an image
 * *into* a frame needs the opposite direction — walk DOWN and compose each
 * container's transform — which is exactly what core's `pointInNode` grew its
 * `parentMatrix` parameter for (this is its first caller).
 *
 * Resolution order:
 *   - Siblings are scanned in paint order, so a frame painted on top of an
 *     overlapping one wins.
 *   - A nested frame beats its ancestor, so dropping into a frame-in-a-frame
 *     targets the inner well.
 *   - Groups are transparent: they are recursed through but are never targets.
 *   - A locked or hidden frame is never a drop target.
 *   - A *clipped* frame hides everything outside its box, so when the point
 *     falls outside it, neither it nor its subtree can be hit.
 */
export function findFrameAtPoint(
	nodes: readonly CanvasNode[],
	world: Point,
	parentMatrix: AffineMatrix = IDENTITY,
): CanvasFrameNode | null {
	return findFrameHitAtPoint(nodes, world, parentMatrix)?.frame ?? null;
}

export interface FrameHit {
	frame: CanvasFrameNode;
	/**
	 * The frame's full world matrix (ancestors composed in). Invert it to map a
	 * world point into the frame's LOCAL space — which is the space a new child
	 * of this frame must be expressed in.
	 */
	worldMatrix: AffineMatrix;
}

/** {@link findFrameAtPoint}, but also reporting where the frame actually is. */
export function findFrameHitAtPoint(
	nodes: readonly CanvasNode[],
	world: Point,
	parentMatrix: AffineMatrix = IDENTITY,
): FrameHit | null {
	let hit: FrameHit | null = null;
	for (const node of nodes) {
		if (node.visible === false || node.locked === true) continue;
		if (!isContainerNode(node)) continue;

		const frame = isFrameNode(node) ? node : null;
		const inside = frame ? pointInNode(frame, world, parentMatrix) : true;
		if (frame?.clip && !inside) continue;

		const worldMatrix = multiplyMatrix(
			parentMatrix,
			toAffineMatrix(node.transform),
		);
		const inner = findFrameHitAtPoint(node.children, world, worldMatrix);
		if (inner) {
			hit = inner;
			continue;
		}
		if (frame && inside) hit = { frame, worldMatrix };
	}
	return hit;
}
