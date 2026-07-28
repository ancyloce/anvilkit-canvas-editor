import {
	type CanvasIR,
	type CanvasNode,
	nodeWorldAabb,
	snapRectFromExtent,
} from "@anvilkit/canvas-core";
import type { ResolvedPageSpace } from "../stage/resolved-page-space.js";
import type { SnapRect } from "./snap-types.js";

/**
 * World-space rect for a node. With a {@link ResolvedPageSpace} (T-M3-07) the
 * rect comes from the node's RESOLVED page-space AABB — ancestor-composed and
 * Auto-Layout-corrected. Without one (lightweight tool tests, partial
 * contexts) it falls back to `nodeWorldAabb` on stored geometry, which is
 * rotation/scale-aware but composes no ancestors — world-correct only for a
 * direct child of the page root (the M0 coordinate suite pins that
 * limitation on this fallback path).
 */
export function getNodeWorldRect(
	node: CanvasNode,
	space?: ResolvedPageSpace | null,
): SnapRect {
	const extent = space?.aabbOf(node.id);
	if (extent) return snapRectFromExtent(extent);
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
	space?: ResolvedPageSpace | null,
): SnapRect[] {
	const page = ir.pages.find((p) => p.id === activePageId);
	if (!page) return [];
	const rects: SnapRect[] = [];
	for (const child of page.root.children) {
		if (excludeIds.has(child.id)) continue;
		rects.push(getNodeWorldRect(child, space));
	}
	return rects;
}
