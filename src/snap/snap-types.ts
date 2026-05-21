export interface SnapRect {
	x: number;
	y: number;
	width: number;
	height: number;
}

export type SnapAxis = "x" | "y";

export interface SmartGuide {
	axis: SnapAxis;
	/** Coordinate of the alignment line in world space. */
	position: number;
	/** Endpoints of the visible guide line (covers candidate + target rects). */
	from: { x: number; y: number };
	to: { x: number; y: number };
}

export interface SnapInput {
	/** Rect of the thing being snapped (e.g. a dragging node) in world coords. */
	candidate: SnapRect;
	/** Other (unselected) node bounding rects to snap against. */
	others: readonly SnapRect[];
	/** When > 0 and no edge snap matches, snap the top-left to this grid size. */
	gridSize?: number;
	/** Maximum world-space distance for an edge snap. Default 6. */
	threshold?: number;
}

export interface SnapResult {
	dx: number;
	dy: number;
	guides: SmartGuide[];
}
