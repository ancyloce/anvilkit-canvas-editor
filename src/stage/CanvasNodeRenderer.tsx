"use client";

import type {
	CanvasAiPlaceholderNode,
	CanvasAiPlaceholderStatus,
	CanvasEllipseNode,
	CanvasFill,
	CanvasFrameNode,
	CanvasGroupNode,
	CanvasImageNode,
	CanvasLineNode,
	CanvasNode,
	CanvasNodeBase,
	CanvasPathNode,
	CanvasRectNode,
	CanvasShadow,
	CanvasTextNode,
	FramePlaceholderKind,
} from "@anvilkit/canvas-core";
import type Konva from "konva";
import { use } from "react";
import {
	Ellipse,
	Group,
	Image as KonvaImage,
	Line,
	Path,
	Rect,
	Text,
} from "react-konva";
import useImage from "use-image";
import {
	CanvasStudioContext,
	useCanvasT,
} from "../context/canvas-studio-context.js";
import { useCanvasAsset } from "./CanvasAssetsContext.js";
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
	};
}

/** Map a node fill (string or gradient) to Konva fill props. */
function fillProps(
	fill: CanvasFill | undefined,
	bounds: { width: number; height: number },
): Konva.ShapeConfig {
	if (fill === undefined) return {};
	if (typeof fill === "string") return { fill };
	const stops = fill.stops.flatMap((s) => [s.offset, s.color]);
	const start = {
		x: fill.from.x * bounds.width,
		y: fill.from.y * bounds.height,
	};
	const end = { x: fill.to.x * bounds.width, y: fill.to.y * bounds.height };
	if (fill.kind === "radial") {
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

/** Map an optional node shadow to Konva shadow props. */
function shadowProps(shadow: CanvasShadow | undefined): Konva.ShapeConfig {
	if (!shadow) return {};
	return {
		shadowColor: shadow.color,
		shadowBlur: shadow.blur,
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
					cornerRadius={node.radius}
					{...fillProps(fill, node.bounds)}
				/>
			) : null}
			{emptyWell && isInteractive ? (
				<Group listening={false}>
					<Rect
						x={0}
						y={0}
						width={width}
						height={height}
						cornerRadius={node.radius}
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
	return (
		<Rect
			{...commonProps(node)}
			width={node.bounds.width}
			height={node.bounds.height}
			{...fillProps(node.fill, node.bounds)}
			{...shadowProps(node.shadow)}
			stroke={node.stroke}
			strokeWidth={node.strokeWidth}
			cornerRadius={node.radius}
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
	return (
		<Ellipse
			{...base}
			x={base.x + offset.x}
			y={base.y + offset.y}
			radiusX={radiusX}
			radiusY={radiusY}
			{...fillProps(node.fill, node.bounds)}
			{...shadowProps(node.shadow)}
			stroke={node.stroke}
			strokeWidth={node.strokeWidth}
		/>
	);
}

function CanvasLineNodeRenderer({ node }: { node: CanvasLineNode }) {
	return (
		<Line
			{...commonProps(node)}
			points={node.points}
			stroke={node.stroke}
			strokeWidth={node.strokeWidth}
		/>
	);
}

function CanvasPathNodeRenderer({ node }: { node: CanvasPathNode }) {
	return (
		<Path
			{...commonProps(node)}
			data={node.d}
			{...fillProps(node.fill, node.bounds)}
			{...shadowProps(node.shadow)}
			stroke={node.stroke}
			strokeWidth={node.strokeWidth}
		/>
	);
}

function CanvasTextNodeRenderer({ node }: { node: CanvasTextNode }) {
	return (
		<Text
			{...commonProps(node)}
			text={node.text}
			fontFamily={node.fontFamily}
			fontSize={node.fontSize}
			fontStyle={node.fontWeight}
			{...fillProps(node.fill, node.bounds)}
			{...shadowProps(node.shadow)}
			align={node.align}
			width={node.bounds.width}
			height={node.bounds.height}
		/>
	);
}

function CanvasImageNodeRenderer({ node }: { node: CanvasImageNode }) {
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
			{...(node.crop ? { crop: node.crop } : {})}
		/>
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

export function CanvasNodeRenderer({
	node,
}: CanvasNodeRendererProps): React.JSX.Element | null {
	switch (node.type) {
		case "group":
			return <CanvasGroupNodeRenderer node={node} />;
		case "frame":
			return <CanvasFrameNodeRenderer node={node} />;
		case "rect":
			return <CanvasRectNodeRenderer node={node} />;
		case "ellipse":
			return <CanvasEllipseNodeRenderer node={node} />;
		case "line":
			return <CanvasLineNodeRenderer node={node} />;
		case "path":
			return <CanvasPathNodeRenderer node={node} />;
		case "text":
			return <CanvasTextNodeRenderer node={node} />;
		case "image":
			return <CanvasImageNodeRenderer node={node} />;
		case "ai-placeholder":
			return <CanvasAiPlaceholderNodeRenderer node={node} />;
		default:
			return <CanvasCustomNodeRenderer node={node} />;
	}
}
