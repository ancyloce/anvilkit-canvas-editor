import type { CanvasIR, CanvasNode } from "@anvilkit/canvas-core";
import type { SnapRect } from "./snap-types.js";

/**
 * Approximate world-space rect for a node. Ignores rotation/scale — sufficient
 * for axis-aligned snap and marquee hit-testing in MVP. Iteration polish:
 * compose with `node.transform.{rotation, scaleX, scaleY}` if/when rotated
 * nodes need accurate snap.
 */
export function getNodeWorldRect(node: CanvasNode): SnapRect {
	return {
		x: node.transform.x,
		y: node.transform.y,
		width: node.bounds.width,
		height: node.bounds.height,
	};
}

/**
 * Bounding rects of every direct child of the active page's root,
 * excluding any ids in `excludeIds`. Used as `others` for the snap engine.
 */
export function getOtherNodeRects(
	ir: CanvasIR,
	activePageId: string,
	excludeIds: ReadonlySet<string> = new Set(),
): SnapRect[] {
	const page = ir.pages.find((p) => p.id === activePageId);
	if (!page) return [];
	const rects: SnapRect[] = [];
	for (const child of page.root.children) {
		if (excludeIds.has(child.id)) continue;
		rects.push(getNodeWorldRect(child));
	}
	return rects;
}
