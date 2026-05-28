"use client";

import type {
	CanvasAiPlaceholderNode,
	CanvasAiPlaceholderStatus,
	CanvasEllipseNode,
	CanvasGroupNode,
	CanvasImageNode,
	CanvasLineNode,
	CanvasNode,
	CanvasNodeBase,
	CanvasPathNode,
	CanvasRectNode,
	CanvasTextNode,
} from "@anvilkit/canvas-core";
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
import { CanvasStudioContext } from "../context/canvas-studio-context.js";
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

function CanvasGroupNodeRenderer({ node }: { node: CanvasGroupNode }) {
	return (
		<Group {...commonProps(node)}>
			{node.children.map((child) => (
				<CanvasNodeRenderer key={child.id} node={child} />
			))}
		</Group>
	);
}

function CanvasRectNodeRenderer({ node }: { node: CanvasRectNode }) {
	return (
		<Rect
			{...commonProps(node)}
			width={node.bounds.width}
			height={node.bounds.height}
			fill={node.fill}
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
			fill={node.fill}
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
			fill={node.fill}
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
			fill={node.fill}
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
		label: "Generating…",
	},
	complete: {
		stroke: "#888",
		fill: "rgba(136, 136, 136, 0.08)",
		color: "#666",
		label: "AI ready",
	},
	error: {
		stroke: "#dc2626",
		fill: "rgba(220, 38, 38, 0.08)",
		color: "#b91c1c",
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
				text={style.label}
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
						text="Cancel"
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

export function CanvasNodeRenderer({
	node,
}: CanvasNodeRendererProps): React.JSX.Element | null {
	switch (node.type) {
		case "group":
			return <CanvasGroupNodeRenderer node={node} />;
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
	}
}
