import type {
	SmartGuide,
	SnapAxis,
	SnapInput,
	SnapRect,
	SnapResult,
} from "./snap-types.js";

export const DEFAULT_SNAP_THRESHOLD = 6;

function edges(rect: SnapRect, axis: SnapAxis): [number, number, number] {
	if (axis === "x") {
		return [rect.x, rect.x + rect.width / 2, rect.x + rect.width];
	}
	return [rect.y, rect.y + rect.height / 2, rect.y + rect.height];
}

interface EdgeMatch {
	delta: number;
	position: number;
	target: SnapRect;
}

/**
 * Figma-style edge pairs: like-edges align (start↔start, end↔end),
 * cross-edges align (start↔end, end↔start) for adjacency, and centers align
 * with each other only — never start↔center or end↔center.
 *
 * Index legend: 0 = start (left/top), 1 = center, 2 = end (right/bottom).
 */
const SNAP_PAIRS: ReadonlyArray<readonly [number, number]> = [
	[0, 0],
	[0, 2],
	[2, 0],
	[2, 2],
	[1, 1],
];

function edgeSnap(
	candidate: SnapRect,
	others: readonly SnapRect[],
	threshold: number,
	axis: SnapAxis,
): EdgeMatch | null {
	let best: EdgeMatch | null = null;
	const candidateEdges = edges(candidate, axis);
	for (const other of others) {
		const otherEdges = edges(other, axis);
		for (const [ci, oi] of SNAP_PAIRS) {
			const cEdge = candidateEdges[ci]!;
			const oEdge = otherEdges[oi]!;
			const d = cEdge - oEdge;
			if (Math.abs(d) <= threshold) {
				if (!best || Math.abs(d) < Math.abs(best.delta)) {
					best = { delta: -d, position: oEdge, target: other };
				}
			}
		}
	}
	return best;
}

function gridSnap(value: number, gridSize: number): number {
	return Math.round(value / gridSize) * gridSize - value;
}

/**
 * Compute snap deltas + smart-guide overlays for a candidate rect.
 *
 * Edge-snap-to-other-nodes beats grid snap when both match within threshold;
 * grid only applies when no edge snap is available on that axis. Guides are
 * only emitted for edge snaps, never for grid snaps.
 */
export function computeSnap(input: SnapInput): SnapResult {
	const threshold = input.threshold ?? DEFAULT_SNAP_THRESHOLD;
	const guides: SmartGuide[] = [];

	const edgeX = edgeSnap(input.candidate, input.others, threshold, "x");
	const edgeY = edgeSnap(input.candidate, input.others, threshold, "y");

	let dx = 0;
	let dy = 0;

	if (edgeX) {
		dx = edgeX.delta;
		const yMin = Math.min(input.candidate.y, edgeX.target.y);
		const yMax = Math.max(
			input.candidate.y + input.candidate.height,
			edgeX.target.y + edgeX.target.height,
		);
		guides.push({
			axis: "x",
			position: edgeX.position,
			from: { x: edgeX.position, y: yMin },
			to: { x: edgeX.position, y: yMax },
		});
	} else if (input.gridSize && input.gridSize > 0) {
		dx = gridSnap(input.candidate.x, input.gridSize);
	}

	if (edgeY) {
		dy = edgeY.delta;
		const xMin = Math.min(input.candidate.x, edgeY.target.x);
		const xMax = Math.max(
			input.candidate.x + input.candidate.width,
			edgeY.target.x + edgeY.target.width,
		);
		guides.push({
			axis: "y",
			position: edgeY.position,
			from: { x: xMin, y: edgeY.position },
			to: { x: xMax, y: edgeY.position },
		});
	} else if (input.gridSize && input.gridSize > 0) {
		dy = gridSnap(input.candidate.y, input.gridSize);
	}

	// Normalize -0 → +0 so callers using Object.is for equality don't trip.
	return { dx: dx || 0, dy: dy || 0, guides };
}
