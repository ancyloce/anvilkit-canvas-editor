"use client";

import type {
	CanvasArrowHead,
	CanvasCornerRadii,
	CanvasNode,
	CanvasStrokeCap,
	CanvasStrokeJoin,
	CanvasStrokeStyle,
} from "@anvilkit/canvas-core";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@anvilkit/ui/select";
import type { CanvasT } from "../../context/canvas-studio-context.js";
import {
	ColorField,
	type CommitPatch,
	FieldRow,
	NumberField,
	TextField,
} from "../fields.js";

/**
 * B-03a stroke-style fields (B-12, FR-074/075): color, width, opacity, dash,
 * cap, join — shared by every stroke-bearing shape section — plus arrowhead
 * pickers for line/path kinds. Continuous fields follow the §10 field-input
 * contract (`contract` prop); discrete pickers commit directly.
 */

/** A stroke-bearing node: rect/ellipse/polygon/star/line/path. */
export type StrokeStyledNode = CanvasNode &
	CanvasStrokeStyle & { stroke?: string; strokeWidth?: number };

/** Parse a dash pattern typed as "4 2" / "4,2" → `[4, 2]`; blank → undefined. */
export function parseDashPattern(raw: string): number[] | undefined {
	const parts = raw
		.split(/[\s,]+/)
		.filter((p) => p.length > 0)
		.map((p) => Number.parseFloat(p));
	if (parts.length === 0) return undefined;
	if (parts.some((p) => Number.isNaN(p) || p < 0)) return undefined;
	return parts;
}

export function formatDashPattern(dash: readonly number[] | undefined): string {
	return dash?.join(" ") ?? "";
}

const CAPS: readonly CanvasStrokeCap[] = ["butt", "round", "square"];
const JOINS: readonly CanvasStrokeJoin[] = ["miter", "round", "bevel"];
const ARROWS: readonly CanvasArrowHead[] = ["none", "arrow"];

function EnumSelect<T extends string>({
	label,
	value,
	options,
	dataTestId,
	onChange,
}: {
	label: string;
	value: T;
	options: readonly T[];
	dataTestId: string;
	onChange: (next: T) => void;
}): React.JSX.Element {
	return (
		<FieldRow label={label}>
			<Select
				items={options.map((o) => ({ value: o, label: o }))}
				value={value}
				onValueChange={(next) => next && onChange(next as T)}
			>
				<SelectTrigger data-testid={dataTestId} className="h-7.5 flex-1">
					<SelectValue />
				</SelectTrigger>
				<SelectContent>
					{options.map((o) => (
						<SelectItem key={o} value={o}>
							{o}
						</SelectItem>
					))}
				</SelectContent>
			</Select>
		</FieldRow>
	);
}

export function StrokeFields({
	node,
	commitPatch,
	t,
	arrows = false,
}: {
	node: StrokeStyledNode;
	commitPatch: CommitPatch;
	t: CanvasT;
	/** Show arrowhead pickers (line/path kinds, FR-075). */
	arrows?: boolean;
}): React.JSX.Element {
	const arrowNode = node as StrokeStyledNode & {
		arrowStart?: CanvasArrowHead;
		arrowEnd?: CanvasArrowHead;
	};
	return (
		<>
			<ColorField
				label={t("canvas.inspector.stroke", "Stroke")}
				value={node.stroke}
				dataTestId="prop-stroke"
				contract={{ nodes: [node], buildPatch: (_n, v) => ({ stroke: v }) }}
			/>
			<NumberField
				label={t("canvas.inspector.strokeWidth", "Stroke W")}
				value={node.strokeWidth ?? 0}
				min={0}
				dataTestId="prop-stroke-width"
				contract={{
					nodes: [node],
					buildPatch: (_n, v) => ({ strokeWidth: v }),
				}}
			/>
			<NumberField
				label={t("canvas.inspector.strokeOpacity", "Stroke opacity")}
				value={node.strokeOpacity ?? 1}
				min={0}
				max={1}
				step={0.05}
				dataTestId="prop-stroke-opacity"
				contract={{
					nodes: [node],
					buildPatch: (_n, v) => ({ strokeOpacity: v }),
				}}
			/>
			<TextField
				label={t("canvas.inspector.strokeDash", "Dash")}
				value={formatDashPattern(node.strokeDash)}
				dataTestId="prop-stroke-dash"
				contract={{
					nodes: [node],
					buildPatch: (_n, v) => ({ strokeDash: parseDashPattern(v) }),
				}}
			/>
			<EnumSelect
				label={t("canvas.inspector.strokeCap", "Cap")}
				value={node.strokeCap ?? "butt"}
				options={CAPS}
				dataTestId="prop-stroke-cap"
				onChange={(v) => commitPatch(node, { strokeCap: v })}
			/>
			<EnumSelect
				label={t("canvas.inspector.strokeJoin", "Join")}
				value={node.strokeJoin ?? "miter"}
				options={JOINS}
				dataTestId="prop-stroke-join"
				onChange={(v) => commitPatch(node, { strokeJoin: v })}
			/>
			{arrows ? (
				<>
					<EnumSelect
						label={t("canvas.inspector.arrowStart", "Arrow start")}
						value={arrowNode.arrowStart ?? "none"}
						options={ARROWS}
						dataTestId="prop-arrow-start"
						onChange={(v) => commitPatch(node, { arrowStart: v })}
					/>
					<EnumSelect
						label={t("canvas.inspector.arrowEnd", "Arrow end")}
						value={arrowNode.arrowEnd ?? "none"}
						options={ARROWS}
						dataTestId="prop-arrow-end"
						onChange={(v) => commitPatch(node, { arrowEnd: v })}
					/>
				</>
			) : null}
		</>
	);
}

/**
 * B-03b per-corner radius fields (rect/frame). Each corner writes the full
 * `cornerRadii` object, seeded from the current radii (or the uniform
 * `radius`) so a single-corner edit never zeroes the others.
 */
export function CornerRadiiFields({
	node,
	t,
}: {
	node: CanvasNode & {
		radius?: number;
		cornerRadii?: CanvasCornerRadii;
	};
	t: CanvasT;
}): React.JSX.Element {
	const uniform = node.radius ?? 0;
	const radii = node.cornerRadii ?? {
		topLeft: uniform,
		topRight: uniform,
		bottomRight: uniform,
		bottomLeft: uniform,
	};
	const corner = (
		key: keyof typeof radii,
		label: string,
		testId: string,
	): React.JSX.Element => (
		<NumberField
			label={label}
			value={radii[key]}
			min={0}
			dataTestId={testId}
			contract={{
				nodes: [node],
				buildPatch: (_n, v) => ({ cornerRadii: { ...radii, [key]: v } }),
			}}
		/>
	);
	return (
		<>
			{corner(
				"topLeft",
				t("canvas.inspector.radiusTopLeft", "Radius TL"),
				"prop-radius-tl",
			)}
			{corner(
				"topRight",
				t("canvas.inspector.radiusTopRight", "Radius TR"),
				"prop-radius-tr",
			)}
			{corner(
				"bottomRight",
				t("canvas.inspector.radiusBottomRight", "Radius BR"),
				"prop-radius-br",
			)}
			{corner(
				"bottomLeft",
				t("canvas.inspector.radiusBottomLeft", "Radius BL"),
				"prop-radius-bl",
			)}
		</>
	);
}
