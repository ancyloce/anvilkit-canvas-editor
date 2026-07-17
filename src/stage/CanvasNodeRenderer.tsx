"use client";

import {
	adjustmentBlurRadius,
	applyColorMatrixToPixels,
	type CanvasAiPlaceholderNode,
	type CanvasAiPlaceholderStatus,
	type CanvasAudioNode,
	type CanvasEffect,
	type CanvasEllipseNode,
	type CanvasFill,
	type CanvasFrameNode,
	type CanvasGroupNode,
	type CanvasImageAdjustments,
	type CanvasImageNode,
	type CanvasLineNode,
	type CanvasNode,
	type CanvasNodeBase,
	type CanvasPathNode,
	type CanvasPolygonNode,
	type CanvasRectNode,
	type CanvasRichTextNode,
	type CanvasShadow,
	type CanvasStarNode,
	type CanvasStrokeStyle,
	type CanvasSvgNode,
	type CanvasTextNode,
	type CanvasVideoNode,
	computeAdjustmentColorMatrix,
	type FramePlaceholderKind,
	firstDropShadow,
	resolveNodeEffects,
	resolveSpanStyle,
} from "@anvilkit/canvas-core";
import Konva from "konva";
import { use, useEffect, useMemo, useRef, useSyncExternalStore } from "react";
import {
	Arrow,
	Ellipse,
	Group,
	Image as KonvaImage,
	Line,
	Path,
	Rect,
	RegularPolygon,
	Star,
	Text,
} from "react-konva";
import useImage from "use-image";
import type { BrandKit } from "../brand/brand-kit.js";
import {
	resolveFillForDisplay,
	resolveFontFamilyForDisplay,
} from "../brand/resolve-brand-token.js";
import {
	CanvasStudioContext,
	useCanvasT,
} from "../context/canvas-studio-context.js";
import {
	type CanvasToaster,
	useCanvasToaster,
} from "../context/toast-context.js";
import { measureGlyphWidth } from "../text/canvas-glyph-measurer.js";
import { useFontStatus } from "../text/font-status.js";
import { getCachedLayout } from "../text/layout-cache.js";
import { layoutRichText } from "../text/rich-text-layout.js";
import {
	applyRichTextTransform,
	DEFAULT_RICH_TEXT_STYLE,
} from "../text/rich-text-style.js";
import { useCanvasAsset } from "./CanvasAssetsContext.js";
import { useCanvasBrandKit } from "./CanvasBrandKitContext.js";
import {
	ISOLATION_DIM_OPACITY,
	IsolationRenderContext,
} from "./isolation-render-context.js";
import { nodeRenderOffset } from "./node-render-offset.js";

export interface CanvasNodeRendererProps {
	node: CanvasNode;
}

interface CommonProps {
	id: string;
	name: string;
	x: number;
	y: number;
	rotation: number;
	scaleX: number;
	scaleY: number;
	opacity: number;
	visible: boolean;
	/** FR-073 blend mode (B-12) — IR `blendMode` maps straight onto the
	 * canvas compositing op; absent = source-over. */
	globalCompositeOperation?: GlobalCompositeOperation;
}

function commonProps(node: CanvasNodeBase & { id: string }): CommonProps {
	return {
		id: node.id,
		name: node.id,
		x: node.transform.x,
		y: node.transform.y,
		rotation: node.transform.rotation,
		scaleX: node.transform.scaleX,
		scaleY: node.transform.scaleY,
		opacity: node.opacity ?? 1,
		visible: node.visible ?? true,
		...(node.blendMode
			? {
					globalCompositeOperation: node.blendMode as GlobalCompositeOperation,
				}
			: {}),
	};
}

/**
 * Map a node fill (string, gradient, or brand-token ref) to Konva fill props.
 * A token resolves against `brandKit`; unresolved (no match) degrades to no
 * fill — the same neutral fallback core's SVG serializer uses — rather than
 * throwing on the missing `.stops`/`.from`/`.to` a `BrandTokenRef` has none of.
 */
function fillProps(
	fill: CanvasFill | undefined,
	bounds: { width: number; height: number },
	brandKit: BrandKit,
): Konva.ShapeConfig {
	const resolved = resolveFillForDisplay(fill, brandKit).value;
	if (resolved === undefined) return {};
	if (typeof resolved === "string") return { fill: resolved };
	const gradient = resolved;
	const stops = gradient.stops.flatMap((s) => [s.offset, s.color]);
	const start = {
		x: gradient.from.x * bounds.width,
		y: gradient.from.y * bounds.height,
	};
	const end = {
		x: gradient.to.x * bounds.width,
		y: gradient.to.y * bounds.height,
	};
	if (gradient.kind === "radial") {
		return {
			fillRadialGradientStartPoint: start,
			fillRadialGradientEndPoint: end,
			fillRadialGradientStartRadius: 0,
			fillRadialGradientEndRadius: Math.max(bounds.width, bounds.height) / 2,
			fillRadialGradientColorStops: stops,
		};
	}
	return {
		fillLinearGradientStartPoint: start,
		fillLinearGradientEndPoint: end,
		fillLinearGradientColorStops: stops,
	};
}

/**
 * B-03a stroke style → Konva props (B-12). `strokeOpacity` has no Konva
 * counterpart, so it is baked into the stroke color's alpha — hex colors
 * only; other syntaxes render at full opacity (the SVG export is exact).
 */
function strokeAlphaColor(
	color: string | undefined,
	opacity: number | undefined,
): string | undefined {
	if (!color || opacity === undefined || opacity >= 1) return color;
	const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(color)?.[1];
	if (!hex) return color;
	const full =
		hex.length === 3
			? hex
					.split("")
					.map((c) => c + c)
					.join("")
			: hex;
	const n = Number.parseInt(full, 16);
	const a = Math.max(0, opacity);
	return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
}

function strokeStyleProps(
	node: CanvasStrokeStyle & { stroke?: string; strokeWidth?: number },
): Konva.ShapeConfig {
	return {
		stroke: strokeAlphaColor(node.stroke, node.strokeOpacity),
		strokeWidth: node.strokeWidth,
		...(node.strokeDash && node.strokeDash.length > 0
			? { dash: [...node.strokeDash] }
			: {}),
		...(node.strokeCap ? { lineCap: node.strokeCap } : {}),
		...(node.strokeJoin ? { lineJoin: node.strokeJoin } : {}),
	};
}

/**
 * Map a node's resolved effects (C-03 — `effects` wins over legacy `shadow`,
 * via core's ONE resolver) to Konva shadow props. Konva renders a single
 * shadow with no spread primitive, so the live canvas shows the FIRST drop
 * shadow and approximates `spread` by widening the blur; SVG/PDF exports
 * render spread and shadow stacks exactly.
 */
function shadowProps(node: {
	effects?: CanvasEffect[];
	shadow?: CanvasShadow;
}): Konva.ShapeConfig {
	const shadow = firstDropShadow(resolveNodeEffects(node));
	if (!shadow) return {};
	return {
		shadowColor: shadow.color,
		shadowBlur: shadow.blur + (shadow.spread ?? 0),
		shadowOffsetX: shadow.offsetX,
		shadowOffsetY: shadow.offsetY,
		...(shadow.opacity !== undefined ? { shadowOpacity: shadow.opacity } : {}),
	};
}

function CanvasGroupNodeRenderer({ node }: { node: CanvasGroupNode }) {
	return (
		<Group {...commonProps(node)}>
			{node.children.map((child) => (
				<CanvasNodeRenderer key={child.id} node={child} />
			))}
		</Group>
	);
}

/**
 * Konva clip props for a frame. Konva applies the clip in the container's LOCAL
 * space (it runs `clipFunc` after the group's absolute transform is pushed), so
 * the clip box is simply `(0, 0, width, height)` regardless of the frame's own
 * position, rotation, or scale.
 *
 * A square clip rides the declarative `clipX/Y/Width/Height` props. A rounded one
 * has to go through `clipFunc` — Konva has no `clipRadius`. Konva calls
 * `beginPath()` before the callback and `clip()` after it, so the callback only
 * draws the path; it must not call `clip()` itself.
 */
function frameClipProps(node: CanvasFrameNode): Konva.ContainerConfig {
	if (!node.clip) return {};
	const { width, height } = node.bounds;
	const radius = node.radius ?? 0;
	const radii = node.cornerRadii;
	if (radii) {
		return {
			clipFunc: (ctx) => {
				ctx.roundRect(0, 0, width, height, [
					radii.topLeft,
					radii.topRight,
					radii.bottomRight,
					radii.bottomLeft,
				]);
			},
		};
	}
	if (radius > 0) {
		return {
			clipFunc: (ctx) => {
				ctx.roundRect(0, 0, width, height, radius);
			},
		};
	}
	return { clipX: 0, clipY: 0, clipWidth: width, clipHeight: height };
}

/**
 * Neutral fill painted behind an unresolved image well. Must stay byte-identical
 * to core's `FRAME_PLACEHOLDER_FALLBACK_FILL` (`serialize/svg.ts`) — the stage,
 * the PNG rasterizer and the SVG exporter all have to agree on it, and the SVG
 * golden snapshots pin the value.
 */
const FRAME_PLACEHOLDER_FALLBACK_FILL = "#e2e8f0";

/** Stage-only chrome for an empty well. Never document content — see below. */
const PLACEHOLDER_OUTLINE = "#94a3b8";
const PLACEHOLDER_LABEL_COLOR = "#64748b";

/**
 * A frame is a container that owns its bounds: unlike a group it can paint a
 * background and clip its children to that box.
 *
 * A frame carrying a `placeholder` is an image *well*. While that well is empty
 * it paints a fallback background, mirroring core's `resolveFrameBackground` so
 * an export and the stage look the same, and — on the stage only — an "add an
 * image" affordance so an empty well reads differently from an empty group.
 *
 * That affordance is EDITOR CHROME, not document content, so it is gated on the
 * studio context: `rasterizePage` renders this same component with no provider,
 * which is exactly what keeps the dashed outline and label out of exported PNGs.
 * The fallback FILL is deliberately outside that gate — core's SVG serializer
 * paints it, so the rasterizer must too.
 *
 * Double-click-to-enter-frame (isolation mode) is deliberately NOT implemented —
 * explicitly deferred past canvas-m1-004. Selecting a frame selects the frame
 * itself; its children stay reachable via the LayerPanel and the a11y scene tree.
 */
function CanvasFrameNodeRenderer({ node }: { node: CanvasFrameNode }) {
	const { width, height } = node.bounds;
	const t = useCanvasT();
	const brandKit = useCanvasBrandKit();
	const isInteractive = use(CanvasStudioContext) !== null;
	// Hooks cannot be conditional, so probe the asset map unconditionally: a
	// placeholder is "filled" only once its asset actually exists in the document.
	const placeholderAsset = useCanvasAsset(node.placeholder?.assetId ?? "");
	const emptyWell = node.placeholder !== undefined && !placeholderAsset;
	const fill = emptyWell
		? (node.background ?? FRAME_PLACEHOLDER_FALLBACK_FILL)
		: node.background;

	return (
		<Group {...commonProps(node)} {...frameClipProps(node)}>
			{fill !== undefined ? (
				<Rect
					// Deliberately carries NO id/name. `findHitNodeId` resolves a click by
					// walking UP the Konva tree to the first node whose name matches a
					// top-level IR id, so an anonymous backdrop makes a click on the
					// frame's background select the FRAME. An id here would instead
					// collide with the Group's, and `listening={false}` would make the
					// background unclickable entirely.
					x={0}
					y={0}
					width={width}
					height={height}
					cornerRadius={
						node.cornerRadii
							? [
									node.cornerRadii.topLeft,
									node.cornerRadii.topRight,
									node.cornerRadii.bottomRight,
									node.cornerRadii.bottomLeft,
								]
							: node.radius
					}
					{...fillProps(fill, node.bounds, brandKit)}
				/>
			) : null}
			{emptyWell && isInteractive ? (
				<Group listening={false}>
					<Rect
						x={0}
						y={0}
						width={width}
						height={height}
						cornerRadius={
							node.cornerRadii
								? [
										node.cornerRadii.topLeft,
										node.cornerRadii.topRight,
										node.cornerRadii.bottomRight,
										node.cornerRadii.bottomLeft,
									]
								: node.radius
						}
						stroke={PLACEHOLDER_OUTLINE}
						strokeWidth={1}
						dash={[6, 4]}
					/>
					<Text
						x={0}
						y={0}
						width={width}
						height={height}
						align="center"
						verticalAlign="middle"
						fontSize={12}
						fontFamily="Inter"
						fill={PLACEHOLDER_LABEL_COLOR}
						text={placeholderLabel(node.placeholder?.kind, t)}
					/>
				</Group>
			) : null}
			{node.children.map((child) => (
				<CanvasNodeRenderer key={child.id} node={child} />
			))}
		</Group>
	);
}

function placeholderLabel(
	kind: FramePlaceholderKind | undefined,
	t: ReturnType<typeof useCanvasT>,
): string {
	return kind === "logo"
		? t("canvas.frame.placeholderLogo", "Add a logo")
		: t("canvas.frame.placeholderImage", "Add an image");
}

function CanvasRectNodeRenderer({ node }: { node: CanvasRectNode }) {
	const brandKit = useCanvasBrandKit();
	return (
		<Rect
			{...commonProps(node)}
			width={node.bounds.width}
			height={node.bounds.height}
			{...fillProps(node.fill, node.bounds, brandKit)}
			{...shadowProps(node)}
			{...strokeStyleProps(node)}
			cornerRadius={
				node.cornerRadii
					? [
							node.cornerRadii.topLeft,
							node.cornerRadii.topRight,
							node.cornerRadii.bottomRight,
							node.cornerRadii.bottomLeft,
						]
					: node.radius
			}
		/>
	);
}

function CanvasEllipseNodeRenderer({ node }: { node: CanvasEllipseNode }) {
	// Konva.Ellipse is centered at (x, y). Translate by the shared render offset
	// (= half-bounds) so the bounding box's top-left aligns with the IR transform.
	// The same offset is applied by the drag preview — see `nodeRenderOffset`.
	const radiusX = node.bounds.width / 2;
	const radiusY = node.bounds.height / 2;
	const base = commonProps(node);
	const offset = nodeRenderOffset(node);
	const brandKit = useCanvasBrandKit();
	return (
		<Ellipse
			{...base}
			x={base.x + offset.x}
			y={base.y + offset.y}
			radiusX={radiusX}
			radiusY={radiusY}
			{...fillProps(node.fill, node.bounds, brandKit)}
			{...shadowProps(node)}
			{...strokeStyleProps(node)}
		/>
	);
}

/**
 * `Konva.RegularPolygon` and `Konva.Star` (used below) are both centered at
 * `(x, y)` like `Konva.Ellipse`, but unlike Ellipse they take a single
 * `radius` — no separate radiusX/radiusY for a non-square bounding box. A
 * uniform `radius = bounds.width / 2` plus this aspect-fit `scaleY`
 * (layered on TOP of the node's own `transform.scaleY`, matching how bounds
 * and transform.scale already compose for every other kind) stretches the
 * shape to fill a non-square box the same way core's SVG vertex helper does
 * (`computePolygonVertices`/`computeStarVertices` support independent
 * rx/ry), so the stage and an export agree.
 */
function aspectFitScaleY(bounds: { width: number; height: number }): number {
	return bounds.width > 0 ? bounds.height / bounds.width : 1;
}

function CanvasPolygonNodeRenderer({ node }: { node: CanvasPolygonNode }) {
	const base = commonProps(node);
	const offset = nodeRenderOffset(node);
	const brandKit = useCanvasBrandKit();
	return (
		<RegularPolygon
			{...base}
			x={base.x + offset.x}
			y={base.y + offset.y}
			scaleY={base.scaleY * aspectFitScaleY(node.bounds)}
			sides={node.sides}
			radius={node.bounds.width / 2}
			{...fillProps(node.fill, node.bounds, brandKit)}
			{...shadowProps(node)}
			{...strokeStyleProps(node)}
		/>
	);
}

function CanvasStarNodeRenderer({ node }: { node: CanvasStarNode }) {
	const base = commonProps(node);
	const offset = nodeRenderOffset(node);
	const outerRadius = node.bounds.width / 2;
	const brandKit = useCanvasBrandKit();
	return (
		<Star
			{...base}
			x={base.x + offset.x}
			y={base.y + offset.y}
			scaleY={base.scaleY * aspectFitScaleY(node.bounds)}
			numPoints={node.points}
			innerRadius={outerRadius * node.innerRadiusRatio}
			outerRadius={outerRadius}
			{...fillProps(node.fill, node.bounds, brandKit)}
			{...shadowProps(node)}
			{...strokeStyleProps(node)}
		/>
	);
}

function CanvasLineNodeRenderer({ node }: { node: CanvasLineNode }) {
	// FR-075 arrowheads (B-03a): Konva's Arrow draws triangle pointers; the SVG
	// exporter's <marker> path is the exact form. Plain lines stay Konva.Line.
	const arrowStart = (node.arrowStart ?? "none") !== "none";
	const arrowEnd = (node.arrowEnd ?? "none") !== "none";
	if (arrowStart || arrowEnd) {
		return (
			<Arrow
				{...commonProps(node)}
				points={node.points}
				{...strokeStyleProps(node)}
				fill={node.stroke}
				pointerAtBeginning={arrowStart}
				pointerAtEnding={arrowEnd}
			/>
		);
	}
	return (
		<Line
			{...commonProps(node)}
			points={node.points}
			{...strokeStyleProps(node)}
		/>
	);
}

function CanvasPathNodeRenderer({ node }: { node: CanvasPathNode }) {
	const brandKit = useCanvasBrandKit();
	return (
		<Path
			{...commonProps(node)}
			data={node.d}
			{...fillProps(node.fill, node.bounds, brandKit)}
			{...shadowProps(node)}
			{...strokeStyleProps(node)}
		/>
	);
}

function CanvasTextNodeRenderer({ node }: { node: CanvasTextNode }) {
	const brandKit = useCanvasBrandKit();
	const fontFamily = resolveFontFamilyForDisplay(
		node.fontFamily,
		brandKit,
	).value;
	// FR-083 (C-11): re-render when the family finishes loading so Konva
	// re-draws with the real font instead of staying on fallback metrics.
	useFontStatus(fontFamily);
	return (
		<Text
			{...commonProps(node)}
			text={node.text}
			{...(fontFamily !== undefined ? { fontFamily } : {})}
			fontSize={node.fontSize}
			fontStyle={node.fontWeight}
			{...fillProps(node.fill, node.bounds, brandKit)}
			{...shadowProps(node)}
			align={node.align}
			width={node.bounds.width}
			height={node.bounds.height}
		/>
	);
}

/**
 * Konva clip props for a rich-text block's `overflow`. Mirrors core's SVG
 * `richTextClip` (`serialize/svg.ts`): `"clip"` and `"ellipsis"` clip to the
 * box (best effort — no ellipsis glyph is drawn, matching the SVG path's own
 * documented limitation); `"visible"` and `"auto-height"` clip nothing.
 */
function richTextClipProps(
	node: CanvasRichTextNode,
	measuredHeight: number,
	clipWidth: number,
): Konva.ContainerConfig {
	const overflow = node.overflow ?? "visible";
	if (overflow !== "clip" && overflow !== "ellipsis") return {};
	return {
		clipX: 0,
		clipY: 0,
		clipWidth,
		clipHeight: node.height ?? measuredHeight,
	};
}

/**
 * Multi-span, multi-paragraph text with real wrapping.
 *
 * Konva.Text has exactly one font/fill for its whole string, so mixed inline
 * styling needs one `Konva.Text` per RUN (a contiguous slice of one span that
 * landed on one line) rather than a single wrapping Text node — the same
 * reason the SVG serializer emits one `<tspan>` per run. Line breaks come
 * from `layoutRichText`, the exact function the exported `CanvasTextMeasurer`
 * adapter also wraps (`text/canvas-text-measurer.ts`), so the stage and an
 * SVG export using that adapter always agree on where a line breaks.
 *
 * The layout is memoized per `node.paragraphs` reference (`text/layout-cache.ts`)
 * so a drag/transform frame — which never touches `paragraphs` — does not
 * re-measure.
 */
/** Width sentinel wide enough that no natural line ever reaches it. */
const AUTO_WIDTH_SENTINEL = 1e6;

/**
 * FR-081 auto-width layout: two passes. Pass 1 lays the text out unwrapped at a
 * huge width to discover the natural content width; pass 2 re-lays it at that
 * width so paragraph alignment (which offsets against the box) is correct.
 */
function measureAutoWidthRichText(node: CanvasRichTextNode) {
	const natural = layoutRichText(
		{
			paragraphs: node.paragraphs,
			width: AUTO_WIDTH_SENTINEL,
			wrap: "none",
			defaults: DEFAULT_RICH_TEXT_STYLE,
		},
		measureGlyphWidth,
	);
	return layoutRichText(
		{
			paragraphs: node.paragraphs,
			width: natural.width,
			wrap: "none",
			defaults: DEFAULT_RICH_TEXT_STYLE,
		},
		measureGlyphWidth,
	);
}

function CanvasRichTextNodeRenderer({ node }: { node: CanvasRichTextNode }) {
	// FR-081 auto-width (B-03c): the box width follows the content, so the text
	// must NOT wrap — lay it out at its natural width. `fixed`/absent keeps the
	// authored wrap width authoritative.
	const autoWidth = node.sizing === "auto-width";
	const wrap = autoWidth ? "none" : (node.wrap ?? "word");
	const ctx = use(CanvasStudioContext);
	const brandKit = useCanvasBrandKit();
	// FR-083 (C-11): track the block's leading family so a late-loading font
	// re-renders the block. Per-span families ride along on the same signal.
	useFontStatus(
		resolveFontFamilyForDisplay(
			resolveSpanStyle(
				node.paragraphs[0]?.spans[0] ?? { text: "" },
				DEFAULT_RICH_TEXT_STYLE,
			).fontFamily,
			brandKit,
		).value,
	);
	// Fixed width: the cached single-pass layout. Auto-width: a two-pass measure
	// — first at a large sentinel width (no wrap) to find the natural content
	// width, then re-laid-out at that width so paragraph alignment (which offsets
	// against the box) is correct once the box hugs the content.
	const measured = autoWidth
		? measureAutoWidthRichText(node)
		: getCachedLayout(node.paragraphs, node.width, wrap, () =>
				layoutRichText(
					{
						paragraphs: node.paragraphs,
						width: node.width,
						wrap,
						defaults: DEFAULT_RICH_TEXT_STYLE,
					},
					measureGlyphWidth,
				),
			);

	// FR-081 auto-width reconciliation: keep `width`/`bounds.width` synced to the
	// measured natural width (the editor's promise in the IR contract). Only in
	// an interactive editor (never during export rasterization), coalesced so a
	// burst of typing is one undo entry.
	const measuredWidth = Math.ceil(measured.width);
	useEffect(() => {
		if (!autoWidth || !ctx) return;
		if (Math.abs(node.bounds.width - measuredWidth) < 0.5) return;
		ctx.commitCoalesced?.(
			{
				type: "node.update",
				nodeId: node.id,
				kind: "rich-text",
				patch: {
					width: measuredWidth,
					bounds: { ...node.bounds, width: measuredWidth },
				},
			},
			`auto-width:${node.id}`,
		);
	}, [autoWidth, ctx, node.id, node.bounds, measuredWidth]);

	// FR-081 vertical alignment: offset the whole block within its box height.
	const verticalAlign = node.verticalAlign ?? "top";
	const boxHeight = node.height ?? node.bounds.height;
	const verticalOffset =
		verticalAlign !== "top" && boxHeight > measured.height
			? verticalAlign === "middle"
				? (boxHeight - measured.height) / 2
				: boxHeight - measured.height
			: 0;

	const effectiveWidth = autoWidth ? measuredWidth : node.width;

	return (
		<Group
			{...commonProps(node)}
			{...richTextClipProps(node, measured.height, effectiveWidth)}
		>
			{measured.lines.flatMap((line) =>
				line.runs.map((run) => {
					const paragraph = node.paragraphs[line.paragraphIndex];
					const span = paragraph?.spans[run.spanIndex];
					if (!span) return null;
					const style = resolveSpanStyle(span, DEFAULT_RICH_TEXT_STYLE);
					const fontFamily = resolveFontFamilyForDisplay(
						style.fontFamily,
						brandKit,
					).value;
					return (
						<Text
							key={`${line.paragraphIndex}-${run.spanIndex}-${run.start}`}
							x={line.x + run.x}
							y={line.y + verticalOffset}
							text={applyRichTextTransform(run.text, style.textTransform)}
							{...(fontFamily !== undefined ? { fontFamily } : {})}
							fontSize={style.fontSize}
							fontStyle={`${style.italic ? "italic " : ""}${style.fontWeight}`}
							letterSpacing={style.letterSpacing}
							textDecoration={[
								style.underline ? "underline" : "",
								style.strikethrough ? "line-through" : "",
							]
								.filter(Boolean)
								.join(" ")}
							{...fillProps(
								style.fill,
								{
									width: run.width,
									height: line.height,
								},
								brandKit,
							)}
						/>
					);
				}),
			)}
		</Group>
	);
}

/**
 * C-04 (FR-100): `<KonvaImage>` plus non-destructive adjustments. The color
 * math delegates to core's `applyColorMatrixToPixels` — the EXACT matrix the
 * SVG export embeds — and blur rides Konva's built-in filter (radius ≈ the
 * export's 2·stdDeviation convention). Konva filters require a node cache;
 * it is (re)built only while adjustments are active and cleared otherwise,
 * so unadjusted images keep the uncached fast path.
 */
function AdjustedKonvaImage({
	adjustments,
	image,
	...imageProps
}: {
	adjustments: CanvasImageAdjustments | undefined;
	image: HTMLImageElement;
} & Konva.ImageConfig): React.JSX.Element {
	const ref = useRef<Konva.Image>(null);
	const matrix = adjustments ? computeAdjustmentColorMatrix(adjustments) : null;
	const blurRadius = adjustments ? adjustmentBlurRadius(adjustments) : 0;
	const matrixKey = matrix ? matrix.join(",") : "";
	const colorFilter = useMemo(() => {
		if (!matrixKey) return null;
		const m = matrixKey.split(",").map(Number);
		return (imageData: ImageData): void => {
			applyColorMatrixToPixels(imageData.data, m);
		};
	}, [matrixKey]);
	const filters = [
		...(colorFilter ? [colorFilter] : []),
		...(blurRadius > 0 ? [Konva.Filters.Blur] : []),
	];
	const active = filters.length > 0;
	const { width, height } = imageProps;
	useEffect(() => {
		const node = ref.current;
		if (!node) return;
		if (active) {
			node.cache();
		} else {
			node.clearCache();
		}
		node.getLayer()?.batchDraw();
	}, [active, matrixKey, blurRadius, image, width, height]);
	return (
		<KonvaImage
			ref={ref}
			image={image}
			{...imageProps}
			{...(active ? { filters } : {})}
			{...(blurRadius > 0 ? { blurRadius } : {})}
		/>
	);
}

function CanvasImageNodeRenderer({ node }: { node: CanvasImageNode }) {
	const isInteractive = use(CanvasStudioContext) !== null;
	const t = useCanvasT();
	const asset = useCanvasAsset(node.assetId);
	const [image, status] = useImage(asset?.uri ?? "");
	// FR-170: a toast for the "unresolvable asset reference" case specifically
	// — NOT the `status === "failed"` (load error) case below, which is a
	// different, already-visible failure mode.
	useMissingAssetToast(node.id, !asset, isInteractive);
	// FR-095: a missing asset or failed load must never disappear silently.
	// The live editor shows selectable placeholder chrome; export/rasterize
	// passes (isInteractive false) still emit nothing, matching core's SVG
	// serializer (ASSET_UNRESOLVED warning + skip).
	if (!asset || status === "failed") {
		if (!isInteractive) return null;
		// Distinct "unsupported format" state (vs. the generic "load error"):
		// a browser's <img> onerror carries no reason code, so a genuinely
		// unsupported MIME type can only be classified PROACTIVELY from
		// `asset.mimeType`, not inferred from the failure itself.
		const unsupported = asset ? isUnsupportedImageMime(asset.mimeType) : false;
		return (
			<AssetPlaceholder
				node={node}
				state={!asset ? "missing" : unsupported ? "unsupported" : "error"}
				label={
					!asset
						? t("canvas.image.missingAsset", "Missing image")
						: unsupported
							? t("canvas.image.unsupportedFormat", "Unsupported image format")
							: t("canvas.image.loadError", "Image failed to load")
				}
			/>
		);
	}
	if (status !== "loaded" || !image) {
		if (!isInteractive) return null;
		return (
			<AssetPlaceholder
				node={node}
				state="loading"
				label={t("canvas.image.loading", "Loading image…")}
			/>
		);
	}
	const { width, height } = node.bounds;
	// FR-094 fit modes (B-02/B-12). `stretch` (default/absent) keeps the
	// legacy single-Image path: `node.crop` (a source-pixel sub-rect, see
	// `crop-actions.ts`) feeds Konva's native `crop` + destination
	// width/height directly — Konva does the (possibly non-uniform) scale.
	const fitMode = node.fitMode ?? "stretch";
	if (fitMode === "stretch") {
		return (
			<AdjustedKonvaImage
				{...commonProps(node)}
				adjustments={node.adjustments}
				image={image}
				width={width}
				height={height}
				{...(node.crop ? { crop: node.crop } : {})}
			/>
		);
	}
	// `fill` WITHOUT a crop keeps its own dedicated path: the desired "cover"
	// framing is achieved by asking Konva to crop straight to the covering
	// source rect, so the image already draws at exactly width×height with no
	// clip wrapper needed.
	if (fitMode === "fill" && !node.crop) {
		const crop = centerCoverCrop(image.width, image.height, width, height);
		return (
			<AdjustedKonvaImage
				{...commonProps(node)}
				adjustments={node.adjustments}
				image={image}
				width={width}
				height={height}
				crop={crop}
			/>
		);
	}
	// fit / original / center, and fill+crop (FR-094): compute the fit mode's
	// own uniform placement scale for the WHOLE image first — exactly as the
	// no-crop case above — then, when `node.crop` is also present, project
	// that source-pixel sub-rect through the SAME scale so it composes within
	// the fitted image space (matching core's SVG serializer, which layers a
	// crop clip-path on top of the fit-mode placement; see
	// `serialize/svg.ts`). The crop rectangle itself is never recomputed —
	// only how it combines with the fit-mode scale/offset. Always clipped to
	// bounds since a crop or an aspect-preserving/covering placement can
	// extend past the frame edges.
	let scale = 1;
	if (fitMode === "fit") {
		scale = Math.min(width / image.width, height / image.height);
	} else if (fitMode === "fill") {
		scale = Math.max(width / image.width, height / image.height);
	}
	const dw = image.width * scale;
	const dh = image.height * scale;
	const dx = fitMode === "original" ? 0 : (width - dw) / 2;
	const dy = fitMode === "original" ? 0 : (height - dh) / 2;
	const crop = node.crop;
	return (
		<Group
			{...commonProps(node)}
			clipX={0}
			clipY={0}
			clipWidth={width}
			clipHeight={height}
		>
			<AdjustedKonvaImage
				adjustments={node.adjustments}
				image={image}
				x={crop ? dx + crop.x * scale : dx}
				y={crop ? dy + crop.y * scale : dy}
				width={crop ? crop.width * scale : dw}
				height={crop ? crop.height * scale : dh}
				{...(crop ? { crop } : {})}
			/>
		</Group>
	);
}

/** Source crop that covers `dw`x`dh` from the image center (fit mode "fill"). */
function centerCoverCrop(
	iw: number,
	ih: number,
	dw: number,
	dh: number,
): { x: number; y: number; width: number; height: number } {
	const scale = Math.max(dw / iw, dh / ih);
	const cw = dw / scale;
	const ch = dh / scale;
	return { x: (iw - cw) / 2, y: (ih - ch) / 2, width: cw, height: ch };
}

function CanvasSvgNodeRenderer({ node }: { node: CanvasSvgNode }) {
	const isInteractive = use(CanvasStudioContext) !== null;
	const t = useCanvasT();
	const asset = useCanvasAsset(node.assetId);
	const [image, status] = useImage(asset?.uri ?? "");
	// FR-170: same "unresolvable asset reference" toast the image renderer
	// fires — shares the module-level batch so a mixed image+svg document
	// still coalesces into one toast.
	useMissingAssetToast(node.id, !asset, isInteractive);
	// FR-095: same missing/error/loading treatment as image nodes — editor-only
	// chrome, never emitted by export/rasterize passes.
	if (!asset || status === "failed") {
		if (!isInteractive) return null;
		return (
			<AssetPlaceholder
				node={node}
				state={asset ? "error" : "missing"}
				label={
					asset
						? t("canvas.svg.loadError", "Graphic failed to load")
						: t("canvas.svg.missingAsset", "Missing graphic")
				}
			/>
		);
	}
	if (status !== "loaded" || !image) {
		if (!isInteractive) return null;
		return (
			<AssetPlaceholder
				node={node}
				state="loading"
				label={t("canvas.svg.loading", "Loading graphic…")}
			/>
		);
	}
	return (
		<KonvaImage
			{...commonProps(node)}
			image={image}
			width={node.bounds.width}
			height={node.bounds.height}
		/>
	);
}

/**
 * P1-1: `video`/`audio` are built-in kinds, not extensions — before this,
 * both fell through `CanvasNodeRenderer`'s switch to `CanvasCustomNodeRenderer`
 * (the EXTENSION fallback), which looks up `kindRenderers[type]`. Nothing
 * registers a built-in kind there, so both rendered nothing at all: a video/
 * audio node was present in the IR, selectable in the LayerPanel, but
 * invisible and unclickable on the canvas. Mirrors core's SVG serializer
 * (`serialize/svg.ts` `emitVideo`/`emitAudio`): a video's `poster` asset (a
 * still frame) renders as real content when present, exactly like an `image`
 * node; failing that — and for audio, which has no visual representation at
 * all — an EDITOR-CHROME-ONLY placeholder box makes the node visible and
 * selectable while editing, without ever appearing in an export/rasterize
 * pass (gated on `isInteractive`, the same seam `CanvasFrameNodeRenderer`'s
 * empty-well affordance uses).
 */
const MEDIA_PLACEHOLDER_LABEL_COLOR = "#0f766e";
const MEDIA_PLACEHOLDER_FILL = "rgba(20, 184, 166, 0.08)";
const MEDIA_PLACEHOLDER_STROKE = "#14b8a6";

function MediaPlaceholderChrome({
	width,
	height,
	label,
	fill = MEDIA_PLACEHOLDER_FILL,
	stroke = MEDIA_PLACEHOLDER_STROKE,
	labelColor = MEDIA_PLACEHOLDER_LABEL_COLOR,
}: {
	width: number;
	height: number;
	label: string;
	fill?: string;
	stroke?: string;
	labelColor?: string;
}) {
	return (
		<Group listening={false}>
			<Rect
				x={0}
				y={0}
				width={width}
				height={height}
				fill={fill}
				stroke={stroke}
				strokeWidth={1}
				dash={[6, 4]}
			/>
			<Text
				x={0}
				y={0}
				width={width}
				height={height}
				align="center"
				verticalAlign="middle"
				fontSize={12}
				fontFamily="Inter"
				fill={labelColor}
				text={label}
			/>
		</Group>
	);
}

/**
 * FR-095 image/svg asset states. `missing`/`error` use a destructive tint so
 * a broken reference reads as a problem, not content; `unsupported` uses an
 * amber warning tint — a known, expected limitation, not a broken reference;
 * `loading` is a quiet neutral shimmer-less box (it usually lives for a
 * frame or two).
 */
const ASSET_PLACEHOLDER_STYLE = {
	missing: {
		fill: "rgba(220, 38, 38, 0.06)",
		stroke: "#dc2626",
		labelColor: "#b91c1c",
	},
	error: {
		fill: "rgba(220, 38, 38, 0.06)",
		stroke: "#dc2626",
		labelColor: "#b91c1c",
	},
	unsupported: {
		fill: "rgba(217, 119, 6, 0.06)",
		stroke: "#d97706",
		labelColor: "#b45309",
	},
	loading: {
		fill: "rgba(120, 120, 120, 0.06)",
		stroke: "#9ca3af",
		labelColor: "#6b7280",
	},
} as const;

/**
 * FR-095: MIME types every target browser can decode as an `<img>`. Absent
 * from this set (and present on the asset) proactively classifies a load
 * failure as "unsupported format" rather than the generic "load error" —
 * the DOM's `<img onerror>` carries no reason code, so this is the only way
 * to distinguish the two. `asset.mimeType` unset (unknown) never classifies
 * as unsupported — only a load failure with a KNOWN-bad type does.
 */
const SUPPORTED_IMAGE_MIME_TYPES: ReadonlySet<string> = new Set([
	"image/png",
	"image/jpeg",
	"image/gif",
	"image/webp",
	"image/svg+xml",
	"image/avif",
	"image/bmp",
	"image/x-icon",
]);

function isUnsupportedImageMime(mimeType: string | undefined): boolean {
	return mimeType !== undefined && !SUPPORTED_IMAGE_MIME_TYPES.has(mimeType);
}

/**
 * FR-170 "asset missing" toast. Firing a toast directly inside a render
 * function is a side-effect-in-render anti-pattern, so the actual
 * `toaster.add` call is driven by {@link useMissingAssetToast} below — a
 * `useEffect` that watches the "missing" transition, not the render path.
 *
 * A document that loads with many broken references (e.g. 20 images) would
 * otherwise fire 20 near-simultaneous toasts, so pending node ids collect in
 * a module-level batch — shared by every `CanvasImageNodeRenderer`/
 * `CanvasSvgNodeRenderer` instance in the same tab, mirroring the
 * module-singleton posture `text/font-status.ts`'s registry already uses —
 * and flush as ONE toast (singular or "{n} assets are missing") after a
 * short window. The window is short enough that it never delays a genuinely
 * isolated single-asset case by more than a beat.
 */
const MISSING_ASSET_BATCH_WINDOW_MS = 50;
let missingAssetBatchIds = new Set<string>();
let missingAssetBatchTimer: ReturnType<typeof setTimeout> | null = null;
let missingAssetBatchToaster: CanvasToaster | null = null;
let missingAssetBatchT: ((key: string, fallback?: string) => string) | null =
	null;

function flushMissingAssetBatch(): void {
	const ids = missingAssetBatchIds;
	missingAssetBatchIds = new Set();
	missingAssetBatchTimer = null;
	const toaster = missingAssetBatchToaster;
	const t =
		missingAssetBatchT ?? ((_key: string, fallback?: string) => fallback ?? "");
	if (!toaster || ids.size === 0) return;
	if (ids.size === 1) {
		toaster.add({
			type: "warning",
			title: t("canvas.toast.assetMissing", "An asset is missing"),
		});
		return;
	}
	toaster.add({
		type: "warning",
		title: t("canvas.toast.assetsMissing", "{n} assets are missing").replace(
			"{n}",
			String(ids.size),
		),
	});
}

function queueMissingAssetToast(
	nodeId: string,
	toaster: CanvasToaster,
	t: (key: string, fallback?: string) => string,
): void {
	missingAssetBatchIds.add(nodeId);
	missingAssetBatchToaster = toaster;
	missingAssetBatchT = t;
	if (missingAssetBatchTimer !== null) return;
	missingAssetBatchTimer = setTimeout(
		flushMissingAssetBatch,
		MISSING_ASSET_BATCH_WINDOW_MS,
	);
}

/** Test seam: reset the module batch state between cases. */
export function resetMissingAssetToastForTests(): void {
	if (missingAssetBatchTimer !== null) clearTimeout(missingAssetBatchTimer);
	missingAssetBatchTimer = null;
	missingAssetBatchIds = new Set();
	missingAssetBatchToaster = null;
	missingAssetBatchT = null;
}

/**
 * Fire the batched "asset missing" toast exactly once per node-becomes-
 * missing EVENT — not on every render while a node stays missing, and not
 * again when a later re-render finds the same still-missing state. The dedup
 * ref is scoped to this component instance (one per node), reset as soon as
 * the asset resolves so a later, genuinely NEW missing episode still toasts.
 */
function useMissingAssetToast(
	nodeId: string,
	missing: boolean,
	isInteractive: boolean,
): void {
	const toaster = useCanvasToaster();
	const t = useCanvasT();
	const toastedRef = useRef(false);
	useEffect(() => {
		if (!isInteractive || !missing) {
			toastedRef.current = false;
			return;
		}
		if (toastedRef.current) return;
		toastedRef.current = true;
		queueMissingAssetToast(nodeId, toaster, t);
	}, [isInteractive, missing, nodeId, toaster, t]);
}

/**
 * Selectable editor-chrome placeholder for an image/svg node whose asset is
 * missing, failed to load, or is still loading (FR-095). Rendered ONLY on the
 * live editor stage (`isInteractive`); export/rasterize passes emit nothing,
 * matching core's SVG serializer (`ASSET_UNRESOLVED` warning + skip). The
 * invisible hit `Rect` keeps the node selectable while the chrome itself
 * stays `listening={false}`.
 */
function AssetPlaceholder({
	node,
	state,
	label,
}: {
	node: CanvasNodeBase & {
		id: string;
		bounds: { width: number; height: number };
	};
	state: keyof typeof ASSET_PLACEHOLDER_STYLE;
	label: string;
}) {
	const style = ASSET_PLACEHOLDER_STYLE[state];
	const { width, height } = node.bounds;
	return (
		<Group {...commonProps(node)}>
			<Rect x={0} y={0} width={width} height={height} fill="transparent" />
			<MediaPlaceholderChrome
				width={width}
				height={height}
				label={label}
				fill={style.fill}
				stroke={style.stroke}
				labelColor={style.labelColor}
			/>
		</Group>
	);
}

function CanvasVideoNodeRenderer({ node }: { node: CanvasVideoNode }) {
	const isInteractive = use(CanvasStudioContext) !== null;
	const t = useCanvasT();
	// Hooks cannot be conditional, so probe unconditionally like the frame
	// placeholder does — an empty assetId resolves to `undefined`.
	const posterAsset = useCanvasAsset(node.poster ?? "");
	const [image, status] = useImage(posterAsset?.uri ?? "");
	const hasPoster = node.poster !== undefined && status === "loaded" && !!image;

	if (!hasPoster && !isInteractive) {
		// No poster to show and this isn't the live editor (e.g. `rasterizePage`)
		// — matches core's `emitVideo`, which also emits nothing in this case.
		return null;
	}
	return (
		<Group {...commonProps(node)}>
			{hasPoster && image ? (
				<KonvaImage
					width={node.bounds.width}
					height={node.bounds.height}
					image={image}
				/>
			) : null}
			{isInteractive && !hasPoster ? (
				<MediaPlaceholderChrome
					width={node.bounds.width}
					height={node.bounds.height}
					label={t("canvas.video.placeholder", "Video")}
				/>
			) : null}
		</Group>
	);
}

function CanvasAudioNodeRenderer({ node }: { node: CanvasAudioNode }) {
	const isInteractive = use(CanvasStudioContext) !== null;
	const t = useCanvasT();
	if (!isInteractive) {
		// Audio has no visual representation at all, even in the editor's own
		// exports — matches core's `emitAudio`, which always emits nothing.
		return null;
	}
	return (
		<Group {...commonProps(node)}>
			<MediaPlaceholderChrome
				width={node.bounds.width}
				height={node.bounds.height}
				label={t("canvas.audio.placeholder", "Audio")}
			/>
		</Group>
	);
}

interface PlaceholderStatusStyle {
	stroke: string;
	fill: string;
	color: string;
	/** i18n key for the status label; `label` is the English fallback. */
	labelKey: string;
	label: string;
}

/** Per-status visual treatment — `pending` reads as an active loading state. */
const PLACEHOLDER_STATUS_STYLE: Record<
	CanvasAiPlaceholderStatus,
	PlaceholderStatusStyle
> = {
	pending: {
		stroke: "#6366f1",
		fill: "rgba(99, 102, 241, 0.08)",
		color: "#4f46e5",
		labelKey: "canvas.placeholder.generating",
		label: "Generating…",
	},
	complete: {
		stroke: "#888",
		fill: "rgba(136, 136, 136, 0.08)",
		color: "#666",
		labelKey: "canvas.placeholder.ready",
		label: "AI ready",
	},
	error: {
		stroke: "#dc2626",
		fill: "rgba(220, 38, 38, 0.08)",
		color: "#b91c1c",
		labelKey: "canvas.placeholder.failed",
		label: "AI failed",
	},
};

function CanvasAiPlaceholderNodeRenderer({
	node,
}: {
	node: CanvasAiPlaceholderNode;
}) {
	// Null-safe: this renderer is also exercised outside a <CanvasStudio> tree
	// (e.g. unit tests render the node directly), where there is no AI job
	// registry — and a non-pending placeholder has no job to cancel.
	const studio = use(CanvasStudioContext);
	const t = useCanvasT();
	const base = commonProps(node);
	const style = PLACEHOLDER_STATUS_STYLE[node.status];
	const width = node.bounds.width;
	const height = node.bounds.height;

	const isPending = node.status === "pending";
	const hasCancelableJob =
		isPending && studio?.aiJobStore?.getState().get(node.jobId) !== undefined;

	// Static indeterminate progress bar (no Konva animation — keeps the loading
	// affordance deterministic for tests; animation is a follow-up).
	const barY = height - 10;
	const barWidth = Math.max(0, width - 16);

	const cancelW = 54;
	const cancelH = 18;
	const cancelX = Math.max(8, width - cancelW - 8);

	const onCancel = (e: { cancelBubble: boolean }): void => {
		// Don't let the click also select/drag the placeholder node.
		e.cancelBubble = true;
		studio?.aiJobStore?.getState().cancel(node.jobId);
	};

	return (
		<Group {...base}>
			<Rect
				width={width}
				height={height}
				stroke={style.stroke}
				strokeWidth={1}
				dash={[6, 4]}
				fill={style.fill}
			/>
			<Text
				text={t(style.labelKey, style.label)}
				x={8}
				y={8}
				fontSize={14}
				fontFamily="Inter"
				fill={style.color}
				width={width - 16}
			/>
			{isPending ? (
				<>
					<Rect
						x={8}
						y={barY}
						width={barWidth}
						height={4}
						cornerRadius={2}
						fill="rgba(99, 102, 241, 0.2)"
						listening={false}
					/>
					<Rect
						x={8}
						y={barY}
						width={barWidth * 0.4}
						height={4}
						cornerRadius={2}
						fill={style.stroke}
						listening={false}
					/>
				</>
			) : null}
			{hasCancelableJob ? (
				<Group x={cancelX} y={8} onClick={onCancel} onTap={onCancel}>
					<Rect
						width={cancelW}
						height={cancelH}
						cornerRadius={3}
						fill="#ffffff"
						stroke={style.stroke}
						strokeWidth={1}
					/>
					<Text
						text={t("canvas.placeholder.cancel", "Cancel")}
						width={cancelW}
						y={4}
						align="center"
						fontSize={11}
						fontFamily="Inter"
						fill={style.color}
					/>
				</Group>
			) : null}
		</Group>
	);
}

function CanvasCustomNodeRenderer({ node }: { node: CanvasNode }) {
	// Custom (extension) node kind: render via the registered renderer from
	// context, else nothing. Built-in kinds never reach here.
	const studio = use(CanvasStudioContext);
	const renderer = studio?.kindRenderers?.[(node as { type: string }).type];
	if (!renderer) return null;
	const Render = renderer.render;
	return <Render node={node} />;
}

const NOOP_SUBSCRIBE = () => () => undefined;

/**
 * §10 field-input contract preview merge (B-12): a mid-edit inspector field
 * publishes a transient node patch to `fieldPreviewStore`; it is shallow-merged
 * over the IR node here — the same merge `node.update` applies on commit — so
 * the canvas previews the pending value without a history entry. Nodes without
 * a preview snapshot `undefined` and never re-render on preview changes.
 * `rasterizePage` renders with no provider, so exports never see previews.
 */
function useFieldPreviewMerge(node: CanvasNode): CanvasNode {
	const store = use(CanvasStudioContext)?.fieldPreviewStore;
	const patch = useSyncExternalStore(
		store ? store.subscribe : NOOP_SUBSCRIBE,
		() => store?.getState().previews[node.id],
		() => undefined,
	);
	return patch ? ({ ...node, ...patch } as CanvasNode) : node;
}

export function CanvasNodeRenderer({
	node: irNode,
}: CanvasNodeRendererProps): React.JSX.Element | null {
	const node = useFieldPreviewMerge(irNode);
	// C-09 (FR-055): exterior content dims and stops hit-testing while a
	// container is isolated. Opacity/listening cascade through the wrapper
	// Group, so a dimmed container dims its whole subtree.
	const dimmedIds = use(IsolationRenderContext);
	if (dimmedIds?.has(node.id)) {
		return (
			<Group
				name={`isolation-dim-${node.id}`}
				opacity={ISOLATION_DIM_OPACITY}
				listening={false}
			>
				{renderNodeByKind(node)}
			</Group>
		);
	}
	return renderNodeByKind(node);
}

function renderNodeByKind(node: CanvasNode): React.JSX.Element | null {
	switch (node.type) {
		case "group":
			return <CanvasGroupNodeRenderer node={node} />;
		case "frame":
			return <CanvasFrameNodeRenderer node={node} />;
		case "rect":
			return <CanvasRectNodeRenderer node={node} />;
		case "ellipse":
			return <CanvasEllipseNodeRenderer node={node} />;
		case "polygon":
			return <CanvasPolygonNodeRenderer node={node} />;
		case "star":
			return <CanvasStarNodeRenderer node={node} />;
		case "line":
			return <CanvasLineNodeRenderer node={node} />;
		case "path":
			return <CanvasPathNodeRenderer node={node} />;
		case "text":
			return <CanvasTextNodeRenderer node={node} />;
		case "rich-text":
			return <CanvasRichTextNodeRenderer node={node} />;
		case "image":
			return <CanvasImageNodeRenderer node={node} />;
		case "svg":
			return <CanvasSvgNodeRenderer node={node} />;
		case "ai-placeholder":
			return <CanvasAiPlaceholderNodeRenderer node={node} />;
		case "video":
			return <CanvasVideoNodeRenderer node={node} />;
		case "audio":
			return <CanvasAudioNodeRenderer node={node} />;
		default:
			return <CanvasCustomNodeRenderer node={node} />;
	}
}
