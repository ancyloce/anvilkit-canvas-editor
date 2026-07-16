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
import { measureGlyphWidth } from "../text/canvas-glyph-measurer.js";
import { getCachedLayout } from "../text/layout-cache.js";
import { layoutRichText } from "../text/rich-text-layout.js";
import {
	applyRichTextTransform,
	DEFAULT_RICH_TEXT_STYLE,
} from "../text/rich-text-style.js";
import { useCanvasAsset } from "./CanvasAssetsContext.js";
import { useCanvasBrandKit } from "./CanvasBrandKitContext.js";
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
): Konva.ContainerConfig {
	const overflow = node.overflow ?? "visible";
	if (overflow !== "clip" && overflow !== "ellipsis") return {};
	return {
		clipX: 0,
		clipY: 0,
		clipWidth: node.width,
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
function CanvasRichTextNodeRenderer({ node }: { node: CanvasRichTextNode }) {
	const wrap = node.wrap ?? "word";
	const brandKit = useCanvasBrandKit();
	const measured = getCachedLayout(node.paragraphs, node.width, wrap, () =>
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

	return (
		<Group {...commonProps(node)} {...richTextClipProps(node, measured.height)}>
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
							y={line.y}
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
	const asset = useCanvasAsset(node.assetId);
	const [image, status] = useImage(asset?.uri ?? "");
	if (!asset) return null;
	if (status !== "loaded" || !image) return null;
	const { width, height } = node.bounds;
	// FR-094 fit modes (B-02/B-12). An explicit `crop` keeps the legacy
	// stretch+crop path (the editor does not compose crop with fit modes —
	// the SVG exporter is the exact form; see core `serialize/svg.ts`).
	const fitMode = node.crop ? "stretch" : (node.fitMode ?? "stretch");
	if (fitMode === "stretch" || fitMode === "fill") {
		const crop =
			fitMode === "fill"
				? centerCoverCrop(image.width, image.height, width, height)
				: node.crop;
		return (
			<AdjustedKonvaImage
				{...commonProps(node)}
				adjustments={node.adjustments}
				image={image}
				width={width}
				height={height}
				{...(crop ? { crop } : {})}
			/>
		);
	}
	// fit / original / center: natural-ratio draw inside a bounds clip.
	let dw = image.width;
	let dh = image.height;
	let dx = 0;
	let dy = 0;
	if (fitMode === "fit") {
		const scale = Math.min(width / image.width, height / image.height);
		dw = image.width * scale;
		dh = image.height * scale;
		dx = (width - dw) / 2;
		dy = (height - dh) / 2;
	} else if (fitMode === "center") {
		dx = (width - dw) / 2;
		dy = (height - dh) / 2;
	}
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
				x={dx}
				y={dy}
				width={dw}
				height={dh}
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
	const asset = useCanvasAsset(node.assetId);
	const [image, status] = useImage(asset?.uri ?? "");
	if (!asset) return null;
	if (status !== "loaded" || !image) return null;
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
}: {
	width: number;
	height: number;
	label: string;
}) {
	return (
		<Group listening={false}>
			<Rect
				x={0}
				y={0}
				width={width}
				height={height}
				fill={MEDIA_PLACEHOLDER_FILL}
				stroke={MEDIA_PLACEHOLDER_STROKE}
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
				fill={MEDIA_PLACEHOLDER_LABEL_COLOR}
				text={label}
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
