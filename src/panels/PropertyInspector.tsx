"use client";

import {
	type CanvasAnyNodeUpdateCommand,
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
import { useCallback, useSyncExternalStore } from "react";
import type { CanvasStudioContextValue } from "../context/canvas-studio-context.js";
import { useCanvasStudio } from "../context/canvas-studio-context.js";
import { beginCrop } from "../selection/crop-actions.js";
import { beginPathEdit } from "../selection/path-edit-actions.js";

const ROW_HEIGHT = 28;
const PADDING_X = 8;

const styles = {
	root: {
		display: "flex",
		flexDirection: "column",
		minWidth: 240,
		maxWidth: 320,
		height: "100%",
		borderLeft: "1px solid #e5e7eb",
		background: "#ffffff",
		fontFamily:
			"ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
		fontSize: 12,
		userSelect: "none",
	} as const,
	header: {
		display: "flex",
		alignItems: "center",
		height: ROW_HEIGHT,
		padding: `0 ${PADDING_X}px`,
		borderBottom: "1px solid #e5e7eb",
		background: "#f9fafb",
		fontWeight: 600,
		color: "#374151",
	} as const,
	body: {
		flex: 1,
		overflowY: "auto",
		padding: PADDING_X,
		display: "flex",
		flexDirection: "column",
		gap: 12,
	} as const,
	group: {
		display: "flex",
		flexDirection: "column",
		gap: 4,
	} as const,
	groupTitle: {
		fontSize: 11,
		fontWeight: 600,
		color: "#6b7280",
		textTransform: "uppercase",
		letterSpacing: 0.5,
	} as const,
	field: {
		display: "grid",
		gridTemplateColumns: "70px 1fr",
		alignItems: "center",
		gap: 6,
	} as const,
	label: {
		color: "#6b7280",
	} as const,
	input: {
		height: 22,
		padding: "0 6px",
		border: "1px solid #d1d5db",
		borderRadius: 3,
		font: "inherit",
		color: "#1f2937",
		background: "#ffffff",
		width: "100%",
		boxSizing: "border-box" as const,
	} as const,
	empty: {
		padding: PADDING_X,
		color: "#9ca3af",
		fontStyle: "italic",
	} as const,
} as const;

interface NumberFieldProps {
	label: string;
	value: number;
	step?: number;
	min?: number;
	max?: number;
	dataTestId: string;
	onCommit: (next: number) => void;
}

function NumberField({
	label,
	value,
	step,
	min,
	max,
	dataTestId,
	onCommit,
}: NumberFieldProps): React.JSX.Element {
	return (
		<label style={styles.field}>
			<span style={styles.label}>{label}</span>
			<input
				type="number"
				aria-label={label}
				defaultValue={value}
				step={step ?? 1}
				{...(min !== undefined ? { min } : {})}
				{...(max !== undefined ? { max } : {})}
				style={styles.input}
				data-testid={dataTestId}
				onBlur={(e) => {
					const parsed = Number.parseFloat(e.currentTarget.value);
					if (!Number.isNaN(parsed) && parsed !== value) onCommit(parsed);
				}}
			/>
		</label>
	);
}

interface TextFieldProps {
	label: string;
	value: string;
	dataTestId: string;
	onCommit: (next: string) => void;
}

function TextField({
	label,
	value,
	dataTestId,
	onCommit,
}: TextFieldProps): React.JSX.Element {
	return (
		<label style={styles.field}>
			<span style={styles.label}>{label}</span>
			<input
				type="text"
				aria-label={label}
				defaultValue={value}
				style={styles.input}
				data-testid={dataTestId}
				onBlur={(e) => {
					if (e.currentTarget.value !== value) onCommit(e.currentTarget.value);
				}}
			/>
		</label>
	);
}

interface ColorFieldProps {
	label: string;
	value: string | undefined;
	dataTestId: string;
	onCommit: (next: string) => void;
}

function ColorField({
	label,
	value,
	dataTestId,
	onCommit,
}: ColorFieldProps): React.JSX.Element {
	return (
		<label style={styles.field}>
			<span style={styles.label}>{label}</span>
			<input
				type="color"
				aria-label={label}
				defaultValue={value ?? "#000000"}
				style={{ ...styles.input, padding: 0, height: 24 }}
				data-testid={dataTestId}
				onBlur={(e) => {
					if (e.currentTarget.value !== value) onCommit(e.currentTarget.value);
				}}
			/>
		</label>
	);
}

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

	const commitPatch = useCallback(
		(targetNode: CanvasNode, patch: Record<string, unknown>) => {
			const cmd = {
				type: "node.update",
				nodeId: targetNode.id,
				kind: targetNode.type,
				patch,
			} as CanvasAnyNodeUpdateCommand;
			ctx.commit(cmd);
		},
		[ctx],
	);

	if (!node) {
		return (
			<div
				data-testid="property-inspector"
				role="region"
				aria-label="Properties"
				style={styles.root}
				{...(id !== undefined ? { id } : {})}
			>
				<div style={styles.header}>Properties</div>
				<div style={styles.empty} data-testid="property-inspector-empty">
					Select a layer to edit its properties.
				</div>
			</div>
		);
	}

	return (
		<div
			data-testid="property-inspector"
			data-node-id={node.id}
			role="region"
			aria-label="Properties"
			style={styles.root}
			{...(id !== undefined ? { id } : {})}
		>
			<div style={styles.header}>Properties · {node.type}</div>
			<div style={styles.body} key={node.id}>
				<div style={styles.group}>
					<div style={styles.groupTitle}>Layer</div>
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
				</div>
				<div style={styles.group}>
					<div style={styles.groupTitle}>Transform</div>
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
				</div>
				{renderTypeSpecificFields(node, commitPatch, ctx)}
			</div>
		</div>
	);
}

function renderTypeSpecificFields(
	node: CanvasNode,
	commitPatch: (n: CanvasNode, patch: Record<string, unknown>) => void,
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
	commitPatch: (n: CanvasNode, patch: Record<string, unknown>) => void,
): React.JSX.Element {
	return (
		<div style={styles.group}>
			<div style={styles.groupTitle}>Shape</div>
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
		</div>
	);
}

function renderEllipseFields(
	node: CanvasEllipseNode,
	commitPatch: (n: CanvasNode, patch: Record<string, unknown>) => void,
): React.JSX.Element {
	return (
		<div style={styles.group}>
			<div style={styles.groupTitle}>Shape</div>
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
		</div>
	);
}

function renderLineFields(
	node: CanvasLineNode,
	commitPatch: (n: CanvasNode, patch: Record<string, unknown>) => void,
): React.JSX.Element {
	return (
		<div style={styles.group}>
			<div style={styles.groupTitle}>Line</div>
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
		</div>
	);
}

function renderTextFields(
	node: CanvasTextNode,
	commitPatch: (n: CanvasNode, patch: Record<string, unknown>) => void,
): React.JSX.Element {
	return (
		<div style={styles.group}>
			<div style={styles.groupTitle}>Text</div>
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
		</div>
	);
}

function renderImageFields(
	node: CanvasImageNode,
	commitPatch: (n: CanvasNode, patch: Record<string, unknown>) => void,
	ctx: CanvasStudioContextValue,
): React.JSX.Element {
	const crop = node.crop;
	const c = crop ?? { x: 0, y: 0, width: 0, height: 0 };
	const setCrop = (patch: Partial<typeof c>) =>
		commitPatch(node, { crop: { ...c, ...patch } });
	return (
		<>
			<div style={styles.group}>
				<div style={styles.groupTitle}>Image</div>
				<div style={styles.field}>
					<span style={styles.label}>Asset</span>
					<span data-testid="prop-asset-id" style={{ color: "#1f2937" }}>
						{node.assetId}
					</span>
				</div>
			</div>
			<div style={styles.group}>
				<div style={styles.groupTitle}>Crop</div>
				<button
					type="button"
					data-testid="prop-crop-begin"
					style={{ ...styles.input, cursor: "pointer", background: "#f9fafb" }}
					onClick={() => beginCrop(ctx, node.id)}
				>
					Crop image
				</button>
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
					<button
						type="button"
						data-testid="prop-crop-clear"
						style={{
							...styles.input,
							cursor: "pointer",
							background: "#f9fafb",
						}}
						onClick={() => commitPatch(node, { crop: undefined })}
					>
						Clear crop
					</button>
				) : null}
			</div>
		</>
	);
}

function renderPathFields(
	node: CanvasPathNode,
	commitPatch: (n: CanvasNode, patch: Record<string, unknown>) => void,
	ctx: CanvasStudioContextValue,
): React.JSX.Element {
	return (
		<div style={styles.group}>
			<div style={styles.groupTitle}>Path</div>
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
			<button
				type="button"
				data-testid="prop-path-edit"
				style={{ ...styles.input, cursor: "pointer", background: "#f9fafb" }}
				onClick={() => beginPathEdit(ctx, node.id)}
			>
				Edit points
			</button>
		</div>
	);
}

function renderGroupFields(node: CanvasGroupNode): React.JSX.Element {
	return (
		<div style={styles.group}>
			<div style={styles.groupTitle}>Group</div>
			<div style={styles.field}>
				<span style={styles.label}>Children</span>
				<span data-testid="prop-children-count" style={{ color: "#1f2937" }}>
					{node.children.length}
				</span>
			</div>
		</div>
	);
}
