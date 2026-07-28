import type {
	CanvasLayoutItem,
	CanvasLayoutSizing,
} from "@anvilkit/canvas-core";

/**
 * Matches the transformer's gesture epsilon (`selection/transformer-helpers.ts`):
 * deltas at or below this are treated as "the axis was not resized".
 */
const DEFAULT_RESIZE_EPSILON = 0.5;

export interface PlannedResize {
	/** Final size to persist for the gesture, per axis. */
	width: number;
	height: number;
	/**
	 * Replacement `layoutItem` when a Hug/Fill axis converted to Fixed.
	 * `undefined` means the stored item must be left untouched.
	 */
	layoutItem?: CanvasLayoutItem;
	widthConverted: boolean;
	heightConverted: boolean;
}

function sizingOf(value: CanvasLayoutSizing | undefined): CanvasLayoutSizing {
	return value ?? "fixed";
}

/**
 * Resize semantics for a node governed by Auto Layout (PRD §9.6):
 *
 * - a Fixed axis simply takes the gesture's size;
 * - a Hug/Fill axis that actually changed captures the resolved size the
 *   gesture started from and converts that axis to Fixed at the new size;
 * - a Hug/Fill axis that did NOT change keeps its mode and its resolved
 *   size — resizing one axis never silently changes the other's mode.
 *
 * Pure: callers supply the resolved (on-screen) size from the resolved
 * document and the gesture's committed size.
 */
export function planResize(
	layoutItem: CanvasLayoutItem | undefined,
	resolvedSize: { width: number; height: number },
	nextSize: { width: number; height: number },
	epsilon: number = DEFAULT_RESIZE_EPSILON,
): PlannedResize {
	const widthSizing = sizingOf(layoutItem?.widthSizing);
	const heightSizing = sizingOf(layoutItem?.heightSizing);
	const widthChanged = Math.abs(nextSize.width - resolvedSize.width) > epsilon;
	const heightChanged =
		Math.abs(nextSize.height - resolvedSize.height) > epsilon;

	const widthConverted = widthSizing !== "fixed" && widthChanged;
	const heightConverted = heightSizing !== "fixed" && heightChanged;

	const width =
		widthSizing === "fixed" || widthChanged
			? nextSize.width
			: resolvedSize.width;
	const height =
		heightSizing === "fixed" || heightChanged
			? nextSize.height
			: resolvedSize.height;

	let nextItem: CanvasLayoutItem | undefined;
	if (widthConverted || heightConverted) {
		nextItem = {
			...layoutItem,
			...(widthConverted ? { widthSizing: "fixed" as const } : {}),
			...(heightConverted ? { heightSizing: "fixed" as const } : {}),
		};
	}

	return {
		width,
		height,
		layoutItem: nextItem,
		widthConverted,
		heightConverted,
	};
}
