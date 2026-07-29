import type {
	Aabb,
	CanvasCommand,
	CanvasLayoutDirection,
} from "@anvilkit/canvas-core";

/**
 * A flow child's footprint in its parent frame's local space, as reported by
 * the resolver (`CanvasResolvedGeometry.layoutFootprint`). Pure input shape —
 * callers adapt resolved records; this module never reads stores or context.
 */
export interface FlowChildRect {
	id: string;
	footprint: Aabb;
}

function primaryCoordinate(
	direction: CanvasLayoutDirection,
	point: { x: number; y: number },
): number {
	return direction === "horizontal" ? point.x : point.y;
}

function primaryMidpoint(direction: CanvasLayoutDirection, rect: Aabb): number {
	return direction === "horizontal"
		? (rect.minX + rect.maxX) / 2
		: (rect.minY + rect.maxY) / 2;
}

/**
 * Insertion index for a pointer inside an Auto Layout frame: the number of
 * remaining (non-dragged) flow children whose primary-axis midpoint lies
 * strictly before the pointer. A pointer exactly on a midpoint inserts
 * before that child. The result indexes the children array *after* the
 * dragged children are removed, which is exactly the `toIndex` a
 * `node.reorder` (remove-then-insert) expects.
 */
/** Endpoints of the drop indicator, in the same (frame-local) space as the inputs. */
export interface InsertionIndicator {
	x1: number;
	y1: number;
	x2: number;
	y2: number;
}

const INDICATOR_END_OFFSET = 4;

/**
 * Drop-indicator segment for an insertion slot: a line across the cross axis
 * at the gap the child would land in — midway between the two neighbouring
 * footprints, or just outside the first/last child at the ends. `fallbackBox`
 * (normally the frame's local content box) supplies the geometry when there
 * are no remaining children. Pure; same input space as
 * {@link computeInsertionIndex}.
 */
export function computeInsertionIndicator(
	children: readonly FlowChildRect[],
	direction: CanvasLayoutDirection,
	index: number,
	fallbackBox: Aabb,
): InsertionIndicator {
	const horizontal = direction === "horizontal";
	const min = (r: Aabb) => (horizontal ? r.minX : r.minY);
	const max = (r: Aabb) => (horizontal ? r.maxX : r.maxY);
	const before = children[index - 1];
	const after = children[index];
	let at: number;
	if (before && after) {
		at = (max(before.footprint) + min(after.footprint)) / 2;
	} else if (after) {
		at = min(after.footprint) - INDICATOR_END_OFFSET;
	} else if (before) {
		at = max(before.footprint) + INDICATOR_END_OFFSET;
	} else {
		at =
			(horizontal ? fallbackBox.minX : fallbackBox.minY) + INDICATOR_END_OFFSET;
	}
	let crossMin = horizontal ? fallbackBox.minY : fallbackBox.minX;
	let crossMax = horizontal ? fallbackBox.maxY : fallbackBox.maxX;
	if (children.length > 0) {
		crossMin = Math.min(
			...children.map((c) =>
				horizontal ? c.footprint.minY : c.footprint.minX,
			),
		);
		crossMax = Math.max(
			...children.map((c) =>
				horizontal ? c.footprint.maxY : c.footprint.maxX,
			),
		);
	}
	return horizontal
		? { x1: at, y1: crossMin, x2: at, y2: crossMax }
		: { x1: crossMin, y1: at, x2: crossMax, y2: at };
}

export function computeInsertionIndex(
	children: readonly FlowChildRect[],
	direction: CanvasLayoutDirection,
	pointer: { x: number; y: number },
	excludeIds?: ReadonlySet<string>,
): number {
	const coordinate = primaryCoordinate(direction, pointer);
	let index = 0;
	for (const child of children) {
		if (excludeIds?.has(child.id)) {
			continue;
		}
		if (primaryMidpoint(direction, child.footprint) < coordinate) {
			index += 1;
		}
	}
	return index;
}

/**
 * `node.reorder` commands that transform `current` into `target`, emitted in
 * target-index order and mirrored against a working copy so each command's
 * remove-then-insert semantics are accounted for.
 */
export function reorderCommandsTo(
	current: readonly string[],
	target: readonly string[],
): CanvasCommand[] {
	const work = [...current];
	const cmds: CanvasCommand[] = [];
	for (let i = 0; i < target.length; i += 1) {
		const id = target[i];
		if (id === undefined || work[i] === id) continue;
		const from = work.indexOf(id);
		if (from < 0) continue;
		work.splice(from, 1);
		work.splice(i, 0, id);
		cmds.push({ type: "node.reorder", nodeId: id, toIndex: i });
	}
	return cmds;
}
