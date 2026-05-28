"use client";

import {
	type CanvasEllipseNode,
	type CanvasGroupNode,
	type CanvasImageNode,
	type CanvasLineNode,
	type CanvasNode,
	type CanvasPathNode,
	type CanvasRectNode,
	type CanvasTextNode,
	findNode,
} from "@anvilkit/canvas-core";
import { Button } from "@anvilkit/ui/button";
import { useSyncExternalStore } from "react";
import type { CanvasStudioContextValue } from "../context/canvas-studio-context.js";
import { useCanvasStudio } from "../context/canvas-studio-context.js";
import { beginCrop } from "../selection/crop-actions.js";
import { beginPathEdit } from "../selection/path-edit-actions.js";
import {
	ColorField,
	type CommitPatch,
	FieldRow,
	NumberField,
	Section,
	TextField,
	useCommitPatch,
} from "./fields.js";

export interface PropertyInspectorProps {
	id?: string;
}

export function PropertyInspector({
	id,
}: PropertyInspectorProps): React.JSX.Element {
	const ctx = useCanvasStudio();
	const selectedIds = useSyncExternalStore(
		ctx.selectionStore.subscribe,
		() => ctx.selectionStore.getState().selectedIds,
		() => ctx.selectionStore.getState().selectedIds,
	);
	const firstSelectedId = selectedIds[0];
	const found = firstSelectedId ? findNode(ctx.ir, firstSelectedId) : null;
	const node = found?.node ?? null;

	const commitPatch = useCommitPatch();

	const rootClass =
		"flex h-full min-w-[240px] max-w-[320px] flex-col gap-4 overflow-y-auto bg-card p-4 text-sm text-foreground select-none";

	if (!node) {
		return (
			<section
				data-testid="property-inspector"
				aria-label="Properties"
				className={rootClass}
				{...(id !== undefined ? { id } : {})}
			>
				<div className="text-[13px] font-semibold text-foreground">
					Inspector
				</div>
				<div
					className="text-xs text-muted-foreground italic"
					data-testid="property-inspector-empty"
				>
					Select a layer to edit its properties.
				</div>
			</section>
		);
	}

	return (
		<section
			data-testid="property-inspector"
			data-node-id={node.id}
			aria-label="Properties"
			className={rootClass}
			{...(id !== undefined ? { id } : {})}
		>
			<div>
				<div className="text-[13px] font-semibold text-foreground">
					Inspector
				</div>
				<div className="text-xs text-muted-foreground capitalize">
					{node.type} layer
				</div>
			</div>
			<div className="flex flex-col gap-4" key={node.id}>
				<Section title="Layer">
					<TextField
						label="Name"
						value={node.name ?? ""}
						dataTestId="prop-name"
						onCommit={(v) => commitPatch(node, { name: v })}
					/>
					<NumberField
						label="Opacity"
						value={node.opacity ?? 1}
						step={0.05}
						min={0}
						max={1}
						dataTestId="prop-opacity"
						onCommit={(v) => commitPatch(node, { opacity: v })}
					/>
				</Section>
				<Section title="Transform">
					<NumberField
						label="X"
						value={node.transform.x}
						dataTestId="prop-x"
						onCommit={(v) =>
							commitPatch(node, {
								transform: { ...node.transform, x: v },
							})
						}
					/>
					<NumberField
						label="Y"
						value={node.transform.y}
						dataTestId="prop-y"
						onCommit={(v) =>
							commitPatch(node, {
								transform: { ...node.transform, y: v },
							})
						}
					/>
					<NumberField
						label="Width"
						value={node.bounds.width}
						min={0}
						dataTestId="prop-width"
						onCommit={(v) =>
							commitPatch(node, {
								bounds: { ...node.bounds, width: v },
							})
						}
					/>
					<NumberField
						label="Height"
						value={node.bounds.height}
						min={0}
						dataTestId="prop-height"
						onCommit={(v) =>
							commitPatch(node, {
								bounds: { ...node.bounds, height: v },
							})
						}
					/>
					<NumberField
						label="Rotation"
						value={node.transform.rotation}
						step={1}
						dataTestId="prop-rotation"
						onCommit={(v) =>
							commitPatch(node, {
								transform: { ...node.transform, rotation: v },
							})
						}
					/>
				</Section>
				{renderTypeSpecificFields(node, commitPatch, ctx)}
			</div>
		</section>
	);
}

function renderTypeSpecificFields(
	node: CanvasNode,
	commitPatch: CommitPatch,
	ctx: CanvasStudioContextValue,
): React.JSX.Element | null {
	switch (node.type) {
		case "rect":
			return renderRectFields(node, commitPatch);
		case "ellipse":
			return renderEllipseFields(node, commitPatch);
		case "line":
			return renderLineFields(node, commitPatch);
		case "text":
			return renderTextFields(node, commitPatch);
		case "image":
			return renderImageFields(node, commitPatch, ctx);
		case "path":
			return renderPathFields(node, commitPatch, ctx);
		case "group":
			return renderGroupFields(node);
		case "ai-placeholder":
			return null;
		default:
			return null;
	}
}

function renderRectFields(
	node: CanvasRectNode,
	commitPatch: CommitPatch,
): React.JSX.Element {
	return (
		<Section title="Shape">
			<ColorField
				label="Fill"
				value={node.fill}
				dataTestId="prop-fill"
				onCommit={(v) => commitPatch(node, { fill: v })}
			/>
			<ColorField
				label="Stroke"
				value={node.stroke}
				dataTestId="prop-stroke"
				onCommit={(v) => commitPatch(node, { stroke: v })}
			/>
			<NumberField
				label="Stroke W"
				value={node.strokeWidth ?? 0}
				min={0}
				dataTestId="prop-stroke-width"
				onCommit={(v) => commitPatch(node, { strokeWidth: v })}
			/>
			<NumberField
				label="Radius"
				value={node.radius ?? 0}
				min={0}
				dataTestId="prop-radius"
				onCommit={(v) => commitPatch(node, { radius: v })}
			/>
		</Section>
	);
}

function renderEllipseFields(
	node: CanvasEllipseNode,
	commitPatch: CommitPatch,
): React.JSX.Element {
	return (
		<Section title="Shape">
			<ColorField
				label="Fill"
				value={node.fill}
				dataTestId="prop-fill"
				onCommit={(v) => commitPatch(node, { fill: v })}
			/>
			<ColorField
				label="Stroke"
				value={node.stroke}
				dataTestId="prop-stroke"
				onCommit={(v) => commitPatch(node, { stroke: v })}
			/>
			<NumberField
				label="Stroke W"
				value={node.strokeWidth ?? 0}
				min={0}
				dataTestId="prop-stroke-width"
				onCommit={(v) => commitPatch(node, { strokeWidth: v })}
			/>
		</Section>
	);
}

function renderLineFields(
	node: CanvasLineNode,
	commitPatch: CommitPatch,
): React.JSX.Element {
	return (
		<Section title="Line">
			<ColorField
				label="Stroke"
				value={node.stroke}
				dataTestId="prop-stroke"
				onCommit={(v) => commitPatch(node, { stroke: v })}
			/>
			<NumberField
				label="Stroke W"
				value={node.strokeWidth ?? 1}
				min={0}
				dataTestId="prop-stroke-width"
				onCommit={(v) => commitPatch(node, { strokeWidth: v })}
			/>
		</Section>
	);
}

function renderTextFields(
	node: CanvasTextNode,
	commitPatch: CommitPatch,
): React.JSX.Element {
	return (
		<Section title="Text">
			<TextField
				label="Content"
				value={node.text}
				dataTestId="prop-text"
				onCommit={(v) => commitPatch(node, { text: v })}
			/>
			<TextField
				label="Font"
				value={node.fontFamily}
				dataTestId="prop-font-family"
				onCommit={(v) => commitPatch(node, { fontFamily: v })}
			/>
			<NumberField
				label="Size"
				value={node.fontSize}
				min={1}
				dataTestId="prop-font-size"
				onCommit={(v) => commitPatch(node, { fontSize: v })}
			/>
			<ColorField
				label="Color"
				value={node.fill}
				dataTestId="prop-text-fill"
				onCommit={(v) => commitPatch(node, { fill: v })}
			/>
		</Section>
	);
}

function renderImageFields(
	node: CanvasImageNode,
	commitPatch: CommitPatch,
	ctx: CanvasStudioContextValue,
): React.JSX.Element {
	const crop = node.crop;
	const c = crop ?? { x: 0, y: 0, width: 0, height: 0 };
	const setCrop = (patch: Partial<typeof c>) =>
		commitPatch(node, { crop: { ...c, ...patch } });
	return (
		<>
			<Section title="Image">
				<FieldRow label="Asset">
					<span
						data-testid="prop-asset-id"
						className="truncate text-xs text-foreground"
					>
						{node.assetId}
					</span>
				</FieldRow>
			</Section>
			<Section title="Crop">
				<Button
					type="button"
					variant="outline"
					size="sm"
					className="w-full"
					data-testid="prop-crop-begin"
					onClick={() => beginCrop(ctx, node.id)}
				>
					Crop image
				</Button>
				<NumberField
					label="Crop X"
					value={c.x}
					min={0}
					dataTestId="prop-crop-x"
					onCommit={(v) => setCrop({ x: v })}
				/>
				<NumberField
					label="Crop Y"
					value={c.y}
					min={0}
					dataTestId="prop-crop-y"
					onCommit={(v) => setCrop({ y: v })}
				/>
				<NumberField
					label="Crop W"
					value={c.width}
					min={0}
					dataTestId="prop-crop-width"
					onCommit={(v) => setCrop({ width: v })}
				/>
				<NumberField
					label="Crop H"
					value={c.height}
					min={0}
					dataTestId="prop-crop-height"
					onCommit={(v) => setCrop({ height: v })}
				/>
				{crop ? (
					<Button
						type="button"
						variant="ghost"
						size="sm"
						className="w-full"
						data-testid="prop-crop-clear"
						onClick={() => commitPatch(node, { crop: undefined })}
					>
						Clear crop
					</Button>
				) : null}
			</Section>
		</>
	);
}

function renderPathFields(
	node: CanvasPathNode,
	commitPatch: CommitPatch,
	ctx: CanvasStudioContextValue,
): React.JSX.Element {
	return (
		<Section title="Path">
			<ColorField
				label="Fill"
				value={node.fill}
				dataTestId="prop-fill"
				onCommit={(v) => commitPatch(node, { fill: v })}
			/>
			<ColorField
				label="Stroke"
				value={node.stroke}
				dataTestId="prop-stroke"
				onCommit={(v) => commitPatch(node, { stroke: v })}
			/>
			<NumberField
				label="Stroke W"
				value={node.strokeWidth ?? 1}
				min={0}
				dataTestId="prop-stroke-width"
				onCommit={(v) => commitPatch(node, { strokeWidth: v })}
			/>
			<TextField
				label="Path d"
				value={node.d}
				dataTestId="prop-path-d"
				onCommit={(v) => commitPatch(node, { d: v })}
			/>
			<Button
				type="button"
				variant="outline"
				size="sm"
				className="w-full"
				data-testid="prop-path-edit"
				onClick={() => beginPathEdit(ctx, node.id)}
			>
				Edit points
			</Button>
		</Section>
	);
}

function renderGroupFields(node: CanvasGroupNode): React.JSX.Element {
	return (
		<Section title="Group">
			<FieldRow label="Children">
				<span
					data-testid="prop-children-count"
					className="text-xs text-foreground"
				>
					{node.children.length}
				</span>
			</FieldRow>
		</Section>
	);
}
