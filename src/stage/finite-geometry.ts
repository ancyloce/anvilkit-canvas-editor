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
 */
export function isFiniteBox(box: {
	x: number;
	y: number;
	width: number;
	height: number;
}): boolean {
	return (
		Number.isFinite(box.x) &&
		Number.isFinite(box.y) &&
		Number.isFinite(box.width) &&
		Number.isFinite(box.height)
	);
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
 * The node as Konva may safely measure it: non-finite transform/bounds numbers
 * replaced by their identity value.
 *
 * Applied once per node at the top of `CanvasNodeRenderer`, so every kind's
 * props — and everything derived from them (`nodeRenderOffset`,
 * `aspectFitScaleY`, radii, clip rects, gradient stops) — are finite by
 * construction rather than at ~20 individual prop sites.
 *
 * Returns the SAME node reference when nothing needs correcting (the
 * overwhelmingly common case), so the memoised render path allocates nothing
 * and re-renders nothing extra.
 */
export function withFiniteGeometry<T extends CanvasNode>(node: T): T {
	const boundsOk =
		Number.isFinite(node.bounds.width) && Number.isFinite(node.bounds.height);
	if (boundsOk && isFiniteTransform(node.transform)) return node;
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
	};
}
