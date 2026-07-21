import {
	applyMatrix,
	type CanvasIR,
	findNode,
	multiplyMatrix,
	parentOf,
	toAffineMatrix,
} from "@anvilkit/canvas-core";

/**
 * The world-space (page-relative) position of a node's local origin —
 * composing every ancestor's transform, not just the node's own (E-10). A
 * node's `transform.x/y` is relative to its IMMEDIATE PARENT; for a
 * TOP-LEVEL node (a direct child of the page root) that already equals its
 * page-space position (the existing convention floating overlays rely on:
 * `node.transform.x/y * zoom + panX/Y`), but for a node nested inside a
 * moved/rotated/scaled group or frame, the ancestor chain's contribution
 * must be composed in too, or a floating UI element anchored to it (the
 * text-edit textarea, the rich-text toolbar) lands in the wrong place.
 *
 * Deliberately stops at (excludes) the page root's own transform, matching
 * the pre-existing convention that a top-level node's transform already IS
 * page-space — composing the root in too would double-count it and change
 * behavior for the common case.
 *
 * Returns `null` if the node doesn't exist in `ir`.
 */
export function resolveNodeWorldPosition(
	ir: CanvasIR,
	nodeId: string,
): { x: number; y: number } | null {
	const found = findNode(ir, nodeId);
	if (!found) return null;

	// Ancestor transforms from the node's immediate parent up to (but not
	// including) the page root, closest-to-node first.
	const ancestorTransforms = [];
	let currentId = nodeId;
	for (;;) {
		const parentResult = parentOf(ir, currentId);
		if (!parentResult || parentResult.parent.id === found.page.root.id) break;
		ancestorTransforms.push(parentResult.parent.transform);
		currentId = parentResult.parent.id;
	}

	// Compose outermost-ancestor-first so `multiplyMatrix(outer, inner)`
	// nests each transform inside the one before it, ending with the node's
	// own transform applied innermost.
	let matrix = toAffineMatrix(found.node.transform);
	for (const transform of ancestorTransforms) {
		matrix = multiplyMatrix(toAffineMatrix(transform), matrix);
	}
	const [x, y] = applyMatrix(matrix, 0, 0);
	return { x, y };
}
