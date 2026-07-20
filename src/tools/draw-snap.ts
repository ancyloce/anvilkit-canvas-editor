import { getOtherNodeRects } from "../snap/get-node-rect.js";
import { computeSnap } from "../snap/snap-engine.js";
import type { SmartGuide } from "../snap/snap-types.js";
import type { ToolContext } from "./tool-types.js";

export interface PointSnapResult {
	x: number;
	y: number;
	guides: SmartGuide[];
}

/**
 * Snap a single point (used by draw tools — width/height = 0 collapses every
 * candidate edge to the same coord). Honors viewportStore's snap-to-grid +
 * object-snap toggles and its snap threshold; grid snap is INDEPENDENT of
 * grid visibility (`gridEnabled`) per FR-112. Pass `excludeIds` to ignore
 * specific nodes (e.g. the node being dragged in select mode).
 */
export function snapPoint(
	ctx: ToolContext,
	point: { x: number; y: number },
	excludeIds: ReadonlySet<string> = new Set(),
): PointSnapResult {
	const vs = ctx.viewportStore.getState();
	const others = getOtherNodeRects(ctx.getIR(), ctx.activePageId, excludeIds);
	const result = computeSnap({
		candidate: { x: point.x, y: point.y, width: 0, height: 0 },
		others: vs.snapToObjectsEnabled ? others : [],
		gridSize: vs.snapToGridEnabled ? vs.gridSize : 0,
		threshold: vs.snapThreshold,
	});
	return {
		x: point.x + result.dx,
		y: point.y + result.dy,
		guides: result.guides,
	};
}
