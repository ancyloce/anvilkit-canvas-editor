import {
	type CanvasIR,
	type CanvasNode,
	nodeWorldAabb,
} from "@anvilkit/canvas-core";
import type { SnapRect } from "./snap-types.js";

/**
 * World-space rect for a node — the rotation/scale-aware axis-aligned bounding
 * box from `@anvilkit/canvas-core` (`nodeWorldAabb`). For an unrotated, unscaled
 * node this equals `{x, y, width, height}`; rotated/scaled nodes now report
 * their true visual bounds (the earlier approximation ignored rotation/scale).
 */
export function getNodeWorldRect(node: CanvasNode): SnapRect {
	const { minX, minY, maxX, maxY } = nodeWorldAabb(node);
	return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
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
