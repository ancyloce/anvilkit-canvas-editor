import type Konva from "konva";

export interface StagePointer {
	/** World-space (post-inverse-transform) coords for IR mutations. */
	world: { x: number; y: number };
	/** Raw screen-space coords as returned by `stage.getPointerPosition()`. */
	screen: { x: number; y: number };
}

/**
 * Resolve the current pointer position into both screen and world coordinates.
 * Returns null when Konva has no pointer position (e.g. before the first
 * pointer event), so callers must guard.
 */
export function getStagePointer(stage: Konva.Stage): StagePointer | null {
	const screen = stage.getPointerPosition();
	if (!screen) return null;
	const inverted = stage.getAbsoluteTransform().copy().invert();
	const world = inverted.point(screen);
	return { screen, world };
}
