import {
	type CanvasBounds,
	type CanvasFill,
	type CanvasNode,
	type CanvasTransform,
	computePolygonVertices,
	computeStarVertices,
	createEllipse,
	createFrame,
	createGroup,
	createLine,
	createPath,
	createPolygon,
	createRect,
	createStar,
} from "@anvilkit/canvas-core";
import type {
	CanvasElementBuildContext,
	CanvasElementCategory,
	CanvasElementEntry,
} from "./element-entry.js";

/**
 * Entry factories for the default catalog (`cp3-002`).
 *
 * WHY FACTORIES RATHER THAN 400 HAND-WRITTEN `build()` CLOSURES.
 *
 * Every entry in the default catalog is one of six shapes: a filled path, a
 * stroked path, one of `canvas-core`'s parametric primitives, a stroked
 * straight line, an image well, or a small group of the above. Writing
 * `build()` out per entry would be four hundred chances to forget
 * `context.newId`, to bake a fill so `cp3-005` half-recolours, or to size the
 * node by `bounds` when the renderer sizes it by scale. Each of those is a real
 * failure `checkElementEntry` reports — so the fix is that there is exactly one
 * place per shape where it can be got right.
 *
 * THE SIZING MODEL, WHICH IS NOT THE OBVIOUS ONE.
 *
 * `path` and `line` are **scale-sized** nodes: the renderer draws `d`/`points`
 * in local units and scales them by `transform.scaleX/scaleY`, and
 * `selection/transformer-helpers.ts:167-173` says so explicitly — "baking it
 * into `bounds` … is ignored by the renderer". So a 24-unit icon asked for at
 * 96 units keeps `bounds: 24×24` and gets `scale: 4`, and both the Konva stage
 * (`stage/CanvasNodeRenderer.tsx:687-693`, `data={node.d}` + `commonProps`'
 * scale) and the SVG serializer (`core/serialize/svg.ts:1011-1030`, raw `d`
 * plus a transform attribute) agree. Every other kind here — `rect`,
 * `ellipse`, `polygon`, `star`, `frame`, `group` — is bounds-sized, so its
 * `bounds` IS the requested size and its scale stays 1.
 *
 * {@link scaleToSize} is the single expression of that rule, including the
 * degenerate axis a zero-height straight line has.
 */

/** Icon geometry is authored in its upstream viewBox and scaled from there. */
export const ICON_DEFAULT_SIZE: CanvasBounds = { width: 96, height: 96 };
/** Shapes, frames and stickers insert at a size a page-sized canvas can hold. */
export const SHAPE_DEFAULT_SIZE: CanvasBounds = { width: 240, height: 240 };
/** Decorative lines are wide and short; the local box doubles as the default. */
export const LINE_DEFAULT_SIZE: CanvasBounds = { width: 240, height: 48 };

/**
 * The neutral ink every entry falls back to when no `context.fill`/`stroke` is
 * supplied. Slate-900 rather than pure black: it is what the editor's own
 * chrome uses, and a pure-black default reads as a placeholder.
 */
export const DEFAULT_INK = "#0f172a";

/** Neutral well fill for an empty `frame`, matching the stage's placeholder. */
export const FRAME_WELL_FILL = "#e2e8f0";

/**
 * Local → requested-size scale for a scale-sized node.
 *
 * A zero-extent axis (a perfectly horizontal `line`, whose `bounds.height` is
 * `0`) scales by 1 rather than by `size / 0`. Without the guard that is
 * `Infinity`, and a non-finite transform poisons every ancestor's measured rect
 * and the selection Transformer's matrix maths — the failure
 * `stage/finite-geometry.ts` exists to contain.
 */
export function scaleToSize(
	size: CanvasBounds,
	local: CanvasBounds,
): Pick<CanvasTransform, "scaleX" | "scaleY"> {
	return {
		scaleX: local.width > 0 ? size.width / local.width : 1,
		scaleY: local.height > 0 ? size.height / local.height : 1,
	};
}

function transformFor(
	context: CanvasElementBuildContext,
	size: CanvasBounds,
	local: CanvasBounds,
): Partial<CanvasTransform> {
	return {
		x: context.at?.x ?? 0,
		y: context.at?.y ?? 0,
		...scaleToSize(size, local),
	};
}

/** `{ id }` when the caller supplied a factory, `{}` otherwise. */
function idOf(context: CanvasElementBuildContext): { id?: string } {
	return context.newId ? { id: context.newId() } : {};
}

// --- preview helpers ---------------------------------------------------------

/**
 * `d` for a rectangle, optionally rounded, in a `0 0 w h` box.
 *
 * Used for BOTH the thumbnail of a `rect`-built entry and the geometry of
 * rectangle-derived path shapes, so a card and the node it inserts can never
 * disagree about what the entry looks like.
 */
export function rectPathD(width: number, height: number, radius = 0): string {
	const r = Math.max(0, Math.min(radius, width / 2, height / 2));
	if (r === 0) return `M0 0H${width}V${height}H0Z`;
	return [
		`M${r} 0H${width - r}`,
		`A${r} ${r} 0 0 1 ${width} ${r}`,
		`V${height - r}`,
		`A${r} ${r} 0 0 1 ${width - r} ${height}`,
		`H${r}`,
		`A${r} ${r} 0 0 1 0 ${height - r}`,
		`V${r}`,
		`A${r} ${r} 0 0 1 ${r} 0`,
		"Z",
	].join("");
}

/** `d` for an axis-aligned ellipse inscribed in a `0 0 w h` box. */
export function ellipsePathD(width: number, height: number): string {
	const rx = width / 2;
	const ry = height / 2;
	return `M0 ${ry}A${rx} ${ry} 0 0 1 ${width} ${ry}A${rx} ${ry} 0 0 1 0 ${ry}Z`;
}

function verticesToPathD(
	vertices: readonly { x: number; y: number }[],
): string {
	const round = (n: number) => Number(n.toFixed(3));
	const [first, ...rest] = vertices;
	if (!first) return "M0 0Z";
	const parts = [`M${round(first.x)} ${round(first.y)}`];
	for (const v of rest) parts.push(`L${round(v.x)} ${round(v.y)}`);
	parts.push("Z");
	return parts.join("");
}

/**
 * `d` for a regular polygon — derived from `canvas-core`'s OWN
 * {@link computePolygonVertices}, the same function `emitPolygon` uses, so the
 * thumbnail is the exported geometry rather than a lookalike traced by hand.
 */
export function polygonPathD(
	width: number,
	height: number,
	sides: number,
): string {
	return verticesToPathD(computePolygonVertices({ width, height }, sides));
}

/** `d` for a star, from `canvas-core`'s {@link computeStarVertices}. */
export function starPathD(
	width: number,
	height: number,
	points: number,
	innerRadiusRatio: number,
): string {
	return verticesToPathD(
		computeStarVertices({ width, height }, points, innerRadiusRatio),
	);
}

// --- entry factories ---------------------------------------------------------

interface EntryCommon {
	readonly id: string;
	readonly name: string;
	readonly category: CanvasElementCategory;
	readonly tags: readonly string[];
	readonly keywords: readonly string[];
	readonly license: string;
	readonly upstreamUrl?: string;
}

/**
 * A single filled `path`, authored in a `viewBox`-sized local box.
 *
 * The shape `cp3-001`'s handoff asks for: `fill: context.fill ?? DEFAULT_INK`
 * on exactly one node, which is what makes `recolor: "fill"` true rather than
 * merely declared — one fill mutation repaints the whole element, and
 * `checkElementEntry`'s probe proves it entry by entry.
 */
export function filledPathEntry(
	common: EntryCommon,
	geometry: { readonly d: string; readonly viewBox: CanvasBounds },
	defaultSize: CanvasBounds,
): CanvasElementEntry {
	return {
		...common,
		defaultSize,
		recolor: "fill",
		preview: {
			kind: "path",
			d: geometry.d,
			viewBox: `0 0 ${geometry.viewBox.width} ${geometry.viewBox.height}`,
		},
		build(context = {}) {
			const size = context.size ?? defaultSize;
			return createPath({
				...idOf(context),
				name: common.name,
				d: geometry.d,
				bounds: geometry.viewBox,
				transform: transformFor(context, size, geometry.viewBox),
				fill: context.fill ?? DEFAULT_INK,
			});
		},
	};
}

/**
 * A single stroked `path` — the outline icon sets, and every decorative line.
 *
 * Carries NO fill on purpose. An outline icon with a fill is a filled blob:
 * both renderers treat an absent fill as `fill="none"`
 * (`core/serialize/svg.ts:582`), which is what the upstream `<svg fill="none">`
 * means. `strokeCap`/`strokeJoin` are `"round"` because every path in the sets
 * this draws from declares `stroke-linejoin="round"` — verified across all 337
 * of them, not assumed from one sample.
 */
export function strokedPathEntry(
	common: EntryCommon,
	geometry: {
		readonly d: string;
		readonly viewBox: CanvasBounds;
		readonly strokeWidth: number;
		readonly strokeDash?: readonly number[];
		readonly arrowStart?: "none" | "arrow";
		readonly arrowEnd?: "none" | "arrow";
	},
	defaultSize: CanvasBounds,
): CanvasElementEntry {
	return {
		...common,
		defaultSize,
		recolor: "stroke",
		preview: {
			kind: "path",
			d: geometry.d,
			viewBox: `0 0 ${geometry.viewBox.width} ${geometry.viewBox.height}`,
		},
		build(context = {}) {
			const size = context.size ?? defaultSize;
			return {
				...createPath({
					...idOf(context),
					name: common.name,
					d: geometry.d,
					bounds: geometry.viewBox,
					transform: transformFor(context, size, geometry.viewBox),
					stroke: context.stroke ?? DEFAULT_INK,
					strokeWidth: geometry.strokeWidth,
				}),
				strokeCap: "round",
				strokeJoin: "round",
				...(geometry.strokeDash
					? { strokeDash: [...geometry.strokeDash] }
					: {}),
				...(geometry.arrowStart ? { arrowStart: geometry.arrowStart } : {}),
				...(geometry.arrowEnd ? { arrowEnd: geometry.arrowEnd } : {}),
			};
		},
	};
}

/** A stroked two-point `line` node, for the plain rules in the `line` tab. */
export function strokedLineEntry(
	common: EntryCommon,
	geometry: {
		readonly points: readonly [number, number, number, number];
		readonly box: CanvasBounds;
		readonly strokeWidth: number;
		readonly strokeDash?: readonly number[];
		readonly arrowStart?: "none" | "arrow";
		readonly arrowEnd?: "none" | "arrow";
	},
	defaultSize: CanvasBounds,
): CanvasElementEntry {
	const [x1, y1, x2, y2] = geometry.points;
	return {
		...common,
		defaultSize,
		recolor: "stroke",
		preview: {
			kind: "path",
			d: `M${x1} ${y1}L${x2} ${y2}`,
			viewBox: `0 0 ${geometry.box.width} ${geometry.box.height}`,
		},
		build(context = {}) {
			const size = context.size ?? defaultSize;
			return {
				...createLine({
					...idOf(context),
					name: common.name,
					points: [x1, y1, x2, y2],
					bounds: geometry.box,
					transform: transformFor(context, size, geometry.box),
					stroke: context.stroke ?? DEFAULT_INK,
					strokeWidth: geometry.strokeWidth,
				}),
				strokeCap: "round",
				...(geometry.strokeDash
					? { strokeDash: [...geometry.strokeDash] }
					: {}),
				...(geometry.arrowStart ? { arrowStart: geometry.arrowStart } : {}),
				...(geometry.arrowEnd ? { arrowEnd: geometry.arrowEnd } : {}),
			};
		},
	};
}

/** A `rect`, optionally rounded — bounds-sized, so no scale is involved. */
export function rectEntry(
	common: EntryCommon,
	geometry: { readonly radius?: number },
	defaultSize: CanvasBounds,
): CanvasElementEntry {
	const radiusFor = (size: CanvasBounds): number | undefined =>
		geometry.radius === undefined
			? undefined
			: // A radius authored against `defaultSize` must stay proportional when
				// the entry is inserted at another size, or a pill becomes a rectangle
				// with rounded corners.
				(geometry.radius / defaultSize.width) *
				Math.min(size.width, size.height);
	return {
		...common,
		defaultSize,
		recolor: "fill",
		preview: {
			kind: "path",
			d: rectPathD(defaultSize.width, defaultSize.height, geometry.radius ?? 0),
			viewBox: `0 0 ${defaultSize.width} ${defaultSize.height}`,
		},
		build(context = {}) {
			const size = context.size ?? defaultSize;
			const radius = radiusFor(size);
			return createRect({
				...idOf(context),
				name: common.name,
				bounds: size,
				transform: { x: context.at?.x ?? 0, y: context.at?.y ?? 0 },
				fill: context.fill ?? DEFAULT_INK,
				...(radius !== undefined ? { radius } : {}),
			});
		},
	};
}

/** An `ellipse` inscribed in the requested box. */
export function ellipseEntry(
	common: EntryCommon,
	defaultSize: CanvasBounds,
): CanvasElementEntry {
	return {
		...common,
		defaultSize,
		recolor: "fill",
		preview: {
			kind: "path",
			d: ellipsePathD(defaultSize.width, defaultSize.height),
			viewBox: `0 0 ${defaultSize.width} ${defaultSize.height}`,
		},
		build(context = {}) {
			const size = context.size ?? defaultSize;
			return createEllipse({
				...idOf(context),
				name: common.name,
				bounds: size,
				transform: { x: context.at?.x ?? 0, y: context.at?.y ?? 0 },
				fill: context.fill ?? DEFAULT_INK,
			});
		},
	};
}

/** A regular `polygon` with `sides` vertices. */
export function polygonEntry(
	common: EntryCommon,
	geometry: { readonly sides: number },
	defaultSize: CanvasBounds,
): CanvasElementEntry {
	return {
		...common,
		defaultSize,
		recolor: "fill",
		preview: {
			kind: "path",
			d: polygonPathD(defaultSize.width, defaultSize.height, geometry.sides),
			viewBox: `0 0 ${defaultSize.width} ${defaultSize.height}`,
		},
		build(context = {}) {
			const size = context.size ?? defaultSize;
			return createPolygon({
				...idOf(context),
				name: common.name,
				bounds: size,
				sides: geometry.sides,
				transform: { x: context.at?.x ?? 0, y: context.at?.y ?? 0 },
				fill: context.fill ?? DEFAULT_INK,
			});
		},
	};
}

/** A `star` with `points` tips at `innerRadiusRatio`. */
export function starEntry(
	common: EntryCommon,
	geometry: {
		readonly points: number;
		readonly innerRadiusRatio: number;
	},
	defaultSize: CanvasBounds,
): CanvasElementEntry {
	return {
		...common,
		defaultSize,
		recolor: "fill",
		preview: {
			kind: "path",
			d: starPathD(
				defaultSize.width,
				defaultSize.height,
				geometry.points,
				geometry.innerRadiusRatio,
			),
			viewBox: `0 0 ${defaultSize.width} ${defaultSize.height}`,
		},
		build(context = {}) {
			const size = context.size ?? defaultSize;
			return createStar({
				...idOf(context),
				name: common.name,
				bounds: size,
				points: geometry.points,
				innerRadiusRatio: geometry.innerRadiusRatio,
				transform: { x: context.at?.x ?? 0, y: context.at?.y ?? 0 },
				fill: context.fill ?? DEFAULT_INK,
			});
		},
	};
}

/**
 * An empty image well.
 *
 * `placeholder: { kind: "image" }` with NO `assetId` — that is precisely what
 * makes a `frame` buildable by an element factory at all: an asset-referencing
 * node needs a matching `ir.assets` record a node factory cannot write, and
 * `validateCanvasIRInvariants` reports `dangling-asset-reference` without one
 * (`core/ir/invariants.ts:66-102`).
 *
 * The clip shape is resolved through the frame's own `shape` field, which the
 * ONE resolver (`resolveFrameClipShape`) then feeds to both the Konva
 * `clipFunc` and the SVG `<clipPath>`. A `path` shape is generated from the
 * requested size rather than stored: a frame is bounds-sized, so a fixed `d`
 * would stop matching its box the moment the frame is resized.
 */
export function frameEntry(
	common: EntryCommon,
	geometry: {
		readonly radius?: number;
		readonly shape?:
			| { readonly kind: "rect" }
			| { readonly kind: "ellipse" }
			| { readonly kind: "polygon"; readonly sides: number }
			| {
					readonly kind: "star";
					readonly points: number;
					readonly innerRadiusRatio: number;
			  }
			| { readonly kind: "path"; readonly d: (size: CanvasBounds) => string };
		readonly previewD?: (size: CanvasBounds) => string;
	},
	defaultSize: CanvasBounds,
): CanvasElementEntry {
	const previewD =
		geometry.previewD?.(defaultSize) ??
		rectPathD(defaultSize.width, defaultSize.height, geometry.radius ?? 0);
	return {
		...common,
		defaultSize,
		recolor: "fill",
		preview: {
			kind: "path",
			d: previewD,
			viewBox: `0 0 ${defaultSize.width} ${defaultSize.height}`,
		},
		build(context = {}) {
			const size = context.size ?? defaultSize;
			const shape = geometry.shape;
			const radius =
				geometry.radius === undefined
					? undefined
					: (geometry.radius / defaultSize.width) *
						Math.min(size.width, size.height);
			return {
				...createFrame({
					...idOf(context),
					name: common.name,
					bounds: size,
					transform: { x: context.at?.x ?? 0, y: context.at?.y ?? 0 },
					clip: true,
					background: context.fill ?? FRAME_WELL_FILL,
					placeholder: { kind: "image" },
					...(radius !== undefined ? { radius } : {}),
				}),
				...(shape
					? {
							shape:
								shape.kind === "path"
									? { kind: "path" as const, d: shape.d(size) }
									: shape,
						}
					: {}),
			};
		},
	};
}

/**
 * One part of a composed sticker: geometry the group positions itself.
 *
 * `fill: "inherit"` is the marker for the ONE part a sticker's colour control
 * drives; every other part keeps its authored colour. That is what
 * `recolor: "multi"` means as a contract — "per-part editing works by selecting
 * the part; a single top-level fill does NOT repaint everything" — and
 * `checkElementEntry` verifies the honest half of it, that `context.fill`
 * reaches at least one node.
 */
export type StickerPart =
	| {
			readonly kind: "rect";
			readonly x: number;
			readonly y: number;
			readonly width: number;
			readonly height: number;
			readonly radius?: number;
			readonly rotation?: number;
			readonly fill: CanvasFill | "inherit";
	  }
	| {
			readonly kind: "ellipse";
			readonly x: number;
			readonly y: number;
			readonly width: number;
			readonly height: number;
			readonly fill: CanvasFill | "inherit";
	  }
	| {
			readonly kind: "star";
			readonly x: number;
			readonly y: number;
			readonly width: number;
			readonly height: number;
			readonly points: number;
			readonly innerRadiusRatio: number;
			readonly rotation?: number;
			readonly fill: CanvasFill | "inherit";
	  }
	| {
			readonly kind: "polygon";
			readonly x: number;
			readonly y: number;
			readonly width: number;
			readonly height: number;
			readonly sides: number;
			readonly rotation?: number;
			readonly fill: CanvasFill | "inherit";
	  }
	| {
			readonly kind: "path";
			readonly x: number;
			readonly y: number;
			readonly width: number;
			readonly height: number;
			readonly d: string;
			readonly viewBox: CanvasBounds;
			readonly fill?: CanvasFill | "inherit";
			readonly stroke?: string;
			readonly strokeWidth?: number;
	  };

function buildPart(
	part: StickerPart,
	fill: CanvasFill,
	newId: (() => string) | undefined,
): CanvasNode {
	const id = newId ? { id: newId() } : {};
	const paint = (value: CanvasFill | "inherit" | undefined): CanvasFill =>
		value === "inherit" || value === undefined ? fill : value;
	const transform = { x: part.x, y: part.y };
	switch (part.kind) {
		case "rect":
			return createRect({
				...id,
				bounds: { width: part.width, height: part.height },
				transform: { ...transform, rotation: part.rotation ?? 0 },
				fill: paint(part.fill),
				...(part.radius !== undefined ? { radius: part.radius } : {}),
			});
		case "ellipse":
			return createEllipse({
				...id,
				bounds: { width: part.width, height: part.height },
				transform,
				fill: paint(part.fill),
			});
		case "star":
			return createStar({
				...id,
				bounds: { width: part.width, height: part.height },
				transform: { ...transform, rotation: part.rotation ?? 0 },
				points: part.points,
				innerRadiusRatio: part.innerRadiusRatio,
				fill: paint(part.fill),
			});
		case "polygon":
			return createPolygon({
				...id,
				bounds: { width: part.width, height: part.height },
				transform: { ...transform, rotation: part.rotation ?? 0 },
				sides: part.sides,
				fill: paint(part.fill),
			});
		case "path":
			return createPath({
				...id,
				d: part.d,
				bounds: part.viewBox,
				transform: {
					...transform,
					...scaleToSize(
						{ width: part.width, height: part.height },
						part.viewBox,
					),
				},
				...(part.fill !== undefined ? { fill: paint(part.fill) } : {}),
				...(part.stroke !== undefined ? { stroke: part.stroke } : {}),
				...(part.strokeWidth !== undefined
					? { strokeWidth: part.strokeWidth }
					: {}),
			});
	}
}

/**
 * A composed sticker: a `group` of parts laid out in a local box.
 *
 * The group keeps the local box as its `bounds` and carries the requested size
 * as a transform scale, exactly as the scale-sized path entries do. That is not
 * an inconsistency with the bounds-sized kinds above: a group's `bounds` is a
 * box the transform is applied TO (`core/geometry/affine.ts`'s
 * `matrixBoundsExtent(m, width, height)`), so `box × scale` is the world extent
 * either way — and Konva applies a Group's scale to its children, so the
 * artwork grows with the box instead of drifting out of it.
 */
export function stickerEntry(
	common: EntryCommon,
	geometry: {
		readonly parts: readonly StickerPart[];
		readonly previewD: string;
		readonly box: CanvasBounds;
	},
	defaultSize: CanvasBounds,
): CanvasElementEntry {
	return {
		...common,
		defaultSize,
		recolor: "multi",
		preview: {
			kind: "path",
			d: geometry.previewD,
			viewBox: `0 0 ${geometry.box.width} ${geometry.box.height}`,
		},
		build(context = {}) {
			const size = context.size ?? defaultSize;
			const fill = context.fill ?? DEFAULT_INK;
			return createGroup({
				...idOf(context),
				name: common.name,
				bounds: geometry.box,
				transform: {
					x: context.at?.x ?? 0,
					y: context.at?.y ?? 0,
					...scaleToSize(size, geometry.box),
				},
				children: geometry.parts.map((part) =>
					buildPart(part, fill, context.newId),
				),
			});
		},
	};
}
