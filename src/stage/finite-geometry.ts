import type { CanvasNode, CanvasTransform } from "@anvilkit/canvas-core";
import Konva from "konva";

/**
 * @file Guards that keep geometry Konva cannot measure out of the scene graph.
 *
 * Konva's numeric attribute validators only *warn* on a non-finite value — they
 * store it regardless (`Validators.getNumberValidator` returns `val` after
 * `Util.warn`), so one `NaN` spreads instead of being rejected:
 *
 * 1. the node stops drawing, and its `getClientRect()` becomes all-`NaN`;
 * 2. that rect poisons every ANCESTOR's rect, because a container unions its
 *    children through `Math.min`/`Math.max` (one bad child ⇒ NaN group box);
 * 3. `Konva.Transformer` measures that box on attach and on every transform
 *    frame. Its zero-size guards use `Util._inRange`, which every `NaN`
 *    comparison fails, so the collapsed-box path it exists to prevent runs
 *    anyway: `oldTr.invert()` divides by a zero determinant and `NaN` lands on
 *    the selected nodes' `x`/`y`/`rotation`/`scaleX`/`scaleY`;
 * 4. `Transformer.nodes()` also does `this.rotation(node.getAbsoluteRotation())`,
 *    and `Transform.decompose()` yields `NaN` rotation for a `NaN` matrix — so
 *    merely SELECTING an affected node logs
 *    `Konva warning: NaN is a not valid value for "rotation" attribute`.
 *
 * Core's schemas do pin every geometry number to `FiniteNumber`, but that only
 * runs when a document is parsed. Commands mutate the IR without re-validating,
 * and collab peers, AI output, SVG/template imports, and plugin extensions all
 * dispatch commands — so this seam checks rather than assumes.
 */

/** Replace a non-finite number (`NaN`, `±Infinity`) with `fallback`. */
export function finiteOr(value: number, fallback: number): number {
	return Number.isFinite(value) ? value : fallback;
}

/**
 * True when every number Konva reads off this box is finite. Konva requires
 * `boundBoxFunc` to return a box, so callers fall back to the previous one.
 *
 * `rotation` is optional because callers pass both shapes: Konva types the
 * `boundBoxFunc` box as `IRect & { rotation: number }`, while plain rects
 * (`getClientRect`) carry no rotation. It must be CHECKED wherever it is
 * present — `Transformer._fitNodesInto` feeds it straight into
 * `newTr.rotate(newAttrs.rotation)`, so a `NaN` there makes the whole matrix
 * `NaN` and lands on every selected node exactly like a bad width would. A
 * box-shaped guard that skipped it would let the headline symptom
 * (`NaN is a not valid value for "rotation"`) through the one seam built to
 * stop it.
 */
export function isFiniteBox(box: {
	x: number;
	y: number;
	width: number;
	height: number;
	rotation?: number;
}): boolean {
	return (
		Number.isFinite(box.x) &&
		Number.isFinite(box.y) &&
		Number.isFinite(box.width) &&
		Number.isFinite(box.height) &&
		(box.rotation === undefined || Number.isFinite(box.rotation))
	);
}

/**
 * A box with every non-finite number replaced, for the case where the box a
 * caller wanted to FALL BACK to is itself corrupt.
 *
 * `boundBoxFunc`'s `oldBox` is Konva's own `_getNodeRect()` measurement, so
 * when a node's rect has already gone `NaN` both boxes are bad and returning
 * `oldBox` propagates the corruption it was meant to contain. Collapsing to
 * `minDimension` keeps the Transformer's matrix invertible, which is the
 * property every downstream guard depends on.
 */
export function sanitizeBox<
	T extends {
		x: number;
		y: number;
		width: number;
		height: number;
		rotation?: number;
	},
>(box: T, minDimension: number): T {
	return {
		...box,
		x: finiteOr(box.x, 0),
		y: finiteOr(box.y, 0),
		width: finiteOr(box.width, minDimension),
		height: finiteOr(box.height, minDimension),
		...(box.rotation === undefined
			? {}
			: { rotation: finiteOr(box.rotation, 0) }),
	};
}

/**
 * True when `d` gives Konva at least one point to measure.
 *
 * `Konva.Path.getSelfRect()` seeds its min/max from `points[0]` and returns an
 * all-`NaN` rect when the parsed data contributes no points — which covers far
 * more than the empty string: `"Z"` parses to one command with an empty
 * `points` array, and anything Konva's parser does not recognise (`"M"`,
 * `"garbage"`) parses to nothing at all. The IR only requires `d.length >= 1`
 * (`CanvasPathNodeSchema`), so every one of those can arrive from an import, a
 * template, AI output, or a peer. Konva's own parser is the oracle here — a
 * hand-rolled check would disagree with it on exactly the inputs that matter.
 */
export function hasDrawablePathData(d: string): boolean {
	try {
		return Konva.Path.parsePathData(d).some(
			(command) => command.points.length > 0,
		);
	} catch {
		// Konva's parser is not total over arbitrary strings.
		return false;
	}
}

function isFiniteTransform(t: CanvasTransform): boolean {
	return (
		Number.isFinite(t.x) &&
		Number.isFinite(t.y) &&
		Number.isFinite(t.rotation) &&
		Number.isFinite(t.scaleX) &&
		Number.isFinite(t.scaleY) &&
		(t.skewX === undefined || Number.isFinite(t.skewX)) &&
		(t.skewY === undefined || Number.isFinite(t.skewY))
	);
}

/**
 * Non-finite entries in a `line`/`arrow` coordinate list.
 *
 * `Konva.Line.getSelfRect()` seeds `minX`/`minY` from `points[0]`/`points[1]`
 * and folds the rest through `Math.min`/`Math.max`, so ONE bad entry returns an
 * all-`NaN` self rect — the same ancestor-poisoning failure `d` has, reached by
 * the same routes (SVG import, AI output, templates, collab peers). Guarded by
 * `Array.isArray` because `points` is a COUNT on star nodes, not a list.
 */
function nonFinitePoints(node: CanvasNode): readonly number[] | undefined {
	const points = (node as { points?: unknown }).points;
	if (!Array.isArray(points)) return undefined;
	const list = points as readonly number[];
	return list.every((n) => Number.isFinite(n)) ? undefined : list;
}

/** A non-finite `strokeWidth`, which `getClientRect` folds into every rect. */
function nonFiniteStrokeWidth(node: CanvasNode): boolean {
	const strokeWidth = (node as { strokeWidth?: unknown }).strokeWidth;
	return typeof strokeWidth === "number" && !Number.isFinite(strokeWidth);
}

/**
 * The node as Konva may safely measure it: non-finite transform, bounds,
 * coordinate-list and stroke-width numbers replaced by their identity value.
 *
 * Applied once per node at the top of `CanvasNodeRenderer`, so every kind's
 * props — and everything derived from them (`nodeRenderOffset`,
 * `aspectFitScaleY`, radii, clip rects, gradient stops) — are finite by
 * construction rather than at ~20 individual prop sites.
 *
 * `points` and `strokeWidth` are here rather than at their prop sites for the
 * same reason: both feed `getSelfRect`/`getClientRect`, so sanitising them
 * anywhere later would be after the measurement that matters.
 *
 * Returns the SAME node reference when nothing needs correcting (the
 * overwhelmingly common case), so the memoised render path allocates nothing
 * and re-renders nothing extra.
 */
export function withFiniteGeometry<T extends CanvasNode>(node: T): T {
	const boundsOk =
		Number.isFinite(node.bounds.width) && Number.isFinite(node.bounds.height);
	const badPoints = nonFinitePoints(node);
	const badStroke = nonFiniteStrokeWidth(node);
	if (
		boundsOk &&
		!badPoints &&
		!badStroke &&
		isFiniteTransform(node.transform)
	) {
		return node;
	}
	const t = node.transform;
	return {
		...node,
		transform: {
			...t,
			x: finiteOr(t.x, 0),
			y: finiteOr(t.y, 0),
			rotation: finiteOr(t.rotation, 0),
			scaleX: finiteOr(t.scaleX, 1),
			scaleY: finiteOr(t.scaleY, 1),
			...(t.skewX !== undefined ? { skewX: finiteOr(t.skewX, 0) } : {}),
			...(t.skewY !== undefined ? { skewY: finiteOr(t.skewY, 0) } : {}),
		},
		bounds: {
			...node.bounds,
			width: finiteOr(node.bounds.width, 0),
			height: finiteOr(node.bounds.height, 0),
		},
		// Collapse a bad coordinate to the origin rather than dropping it: the
		// list's LENGTH is what decides whether Konva takes its safe
		// `points.length < 4` branch, so removing entries would change the shape.
		...(badPoints ? { points: badPoints.map((n) => finiteOr(n, 0)) } : {}),
		...(badStroke ? { strokeWidth: 0 } : {}),
	};
}
