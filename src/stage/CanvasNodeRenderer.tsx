"use client";

import type {
	CanvasAiPlaceholderNode,
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
import { useCanvasAsset } from "./CanvasAssetsContext.js";

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
	// Konva.Ellipse is centered at (x, y). Translate so the bounding box's
	// top-left aligns with the IR transform.
	const radiusX = node.bounds.width / 2;
	const radiusY = node.bounds.height / 2;
	const base = commonProps(node);
	return (
		<Ellipse
			{...base}
			x={base.x + radiusX}
			y={base.y + radiusY}
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
		/>
	);
}

function CanvasAiPlaceholderNodeRenderer({
	node,
}: {
	node: CanvasAiPlaceholderNode;
}) {
	const base = commonProps(node);
	return (
		<Group {...base}>
			<Rect
				width={node.bounds.width}
				height={node.bounds.height}
				stroke="#888"
				strokeWidth={1}
				dash={[6, 4]}
				fill="rgba(136, 136, 136, 0.08)"
			/>
			<Text
				text={`AI ${node.status}…`}
				x={8}
				y={8}
				fontSize={14}
				fontFamily="Inter"
				fill="#666"
				width={node.bounds.width - 16}
			/>
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
