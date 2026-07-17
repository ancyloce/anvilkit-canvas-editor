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
	type CommitPatchAll,
	FieldRow,
	NumberField,
	sharedFieldValue,
	TextField,
} from "../fields.js";

/**
 * B-03a stroke-style fields (B-12, FR-074/075): color, width, opacity, dash,
 * cap, join — shared by every stroke-bearing shape section — plus arrowhead
 * pickers for line/path kinds. Continuous fields follow the §10 field-input
 * contract (`contract` prop); discrete pickers commit via `commitPatchAll`
 * (a `commitBatch` for a multi-node selection, a plain `commit` for one).
 *
 * FR-070 (B-12 multi-kind sections): `nodes` is the whole same-kind selection.
 * Display values read from the FIRST node; a differing value across the
 * selection renders "Mixed" — `NumberField`/`TextField` via their `mixed`
 * prop, the cap/join/arrow pickers via `EnumSelect`'s own `mixed` prop
 * (mirrors `AppearanceSection`'s blend-mode picker).
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
	mixed = false,
	options,
	dataTestId,
	onChange,
	t,
}: {
	label: string;
	value: T;
	/** FR-070: renders no selection + a "Mixed" placeholder, like the
	 * Appearance section's blend-mode picker. */
	mixed?: boolean;
	options: readonly T[];
	dataTestId: string;
	onChange: (next: T) => void;
	t: CanvasT;
}): React.JSX.Element {
	return (
		<FieldRow label={label}>
			<Select
				items={options.map((o) => ({ value: o, label: o }))}
				value={mixed ? undefined : value}
				onValueChange={(next) => next && onChange(next as T)}
			>
				<SelectTrigger data-testid={dataTestId} className="h-7.5 flex-1">
					<SelectValue
						placeholder={
							mixed ? t("canvas.inspector.mixed", "Mixed") : undefined
						}
					/>
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
	nodes,
	commitPatchAll,
	t,
	arrows = false,
}: {
	nodes: readonly StrokeStyledNode[];
	commitPatchAll: CommitPatchAll;
	t: CanvasT;
	/** Show arrowhead pickers (line/path kinds, FR-075). */
	arrows?: boolean;
}): React.JSX.Element {
	const arrowNodes = nodes as ReadonlyArray<
		StrokeStyledNode & {
			arrowStart?: CanvasArrowHead;
			arrowEnd?: CanvasArrowHead;
		}
	>;
	const stroke = sharedFieldValue(nodes, (n) => (n as StrokeStyledNode).stroke);
	const strokeWidth = sharedFieldValue(
		nodes,
		(n) => (n as StrokeStyledNode).strokeWidth ?? 0,
	);
	const strokeOpacity = sharedFieldValue(
		nodes,
		(n) => (n as StrokeStyledNode).strokeOpacity ?? 1,
	);
	const strokeDash = sharedFieldValue(nodes, (n) =>
		formatDashPattern((n as StrokeStyledNode).strokeDash),
	);
	const strokeCap = sharedFieldValue(
		nodes,
		(n) => (n as StrokeStyledNode).strokeCap ?? "butt",
	);
	const strokeJoin = sharedFieldValue(
		nodes,
		(n) => (n as StrokeStyledNode).strokeJoin ?? "miter",
	);
	const arrowStart = sharedFieldValue(
		arrowNodes,
		(n) => (n as (typeof arrowNodes)[number]).arrowStart ?? "none",
	);
	const arrowEnd = sharedFieldValue(
		arrowNodes,
		(n) => (n as (typeof arrowNodes)[number]).arrowEnd ?? "none",
	);
	return (
		<>
			<ColorField
				label={t("canvas.inspector.stroke", "Stroke")}
				value={stroke.value}
				dataTestId="prop-stroke"
				contract={{ nodes, buildPatch: (_n, v) => ({ stroke: v }) }}
			/>
			<NumberField
				label={t("canvas.inspector.strokeWidth", "Stroke W")}
				value={strokeWidth.value}
				mixed={strokeWidth.mixed}
				min={0}
				dataTestId="prop-stroke-width"
				contract={{
					nodes,
					buildPatch: (_n, v) => ({ strokeWidth: v }),
				}}
			/>
			<NumberField
				label={t("canvas.inspector.strokeOpacity", "Stroke opacity")}
				value={strokeOpacity.value}
				mixed={strokeOpacity.mixed}
				min={0}
				max={1}
				step={0.05}
				dataTestId="prop-stroke-opacity"
				contract={{
					nodes,
					buildPatch: (_n, v) => ({ strokeOpacity: v }),
				}}
			/>
			<TextField
				label={t("canvas.inspector.strokeDash", "Dash")}
				value={strokeDash.value}
				mixed={strokeDash.mixed}
				dataTestId="prop-stroke-dash"
				contract={{
					nodes,
					buildPatch: (_n, v) => ({ strokeDash: parseDashPattern(v) }),
				}}
			/>
			<EnumSelect
				label={t("canvas.inspector.strokeCap", "Cap")}
				value={strokeCap.value}
				mixed={strokeCap.mixed}
				options={CAPS}
				dataTestId="prop-stroke-cap"
				onChange={(v) => commitPatchAll(nodes, () => ({ strokeCap: v }))}
				t={t}
			/>
			<EnumSelect
				label={t("canvas.inspector.strokeJoin", "Join")}
				value={strokeJoin.value}
				mixed={strokeJoin.mixed}
				options={JOINS}
				dataTestId="prop-stroke-join"
				onChange={(v) => commitPatchAll(nodes, () => ({ strokeJoin: v }))}
				t={t}
			/>
			{arrows ? (
				<>
					<EnumSelect
						label={t("canvas.inspector.arrowStart", "Arrow start")}
						value={arrowStart.value}
						mixed={arrowStart.mixed}
						options={ARROWS}
						dataTestId="prop-arrow-start"
						onChange={(v) =>
							commitPatchAll(arrowNodes, () => ({ arrowStart: v }))
						}
						t={t}
					/>
					<EnumSelect
						label={t("canvas.inspector.arrowEnd", "Arrow end")}
						value={arrowEnd.value}
						mixed={arrowEnd.mixed}
						options={ARROWS}
						dataTestId="prop-arrow-end"
						onChange={(v) =>
							commitPatchAll(arrowNodes, () => ({ arrowEnd: v }))
						}
						t={t}
					/>
				</>
			) : null}
		</>
	);
}

/**
 * B-03b per-corner radius fields (rect/frame). Each corner writes the full
 * `cornerRadii` object, seeded from that NODE's OWN current radii (or its own
 * uniform `radius`) — a batch edit of one corner across a multi-selection
 * never zeroes another selected node's OTHER corners.
 */
export function CornerRadiiFields({
	nodes,
	t,
}: {
	nodes: ReadonlyArray<
		CanvasNode & { radius?: number; cornerRadii?: CanvasCornerRadii }
	>;
	t: CanvasT;
}): React.JSX.Element {
	type RadiiNode = CanvasNode & {
		radius?: number;
		cornerRadii?: CanvasCornerRadii;
	};
	const radiiOf = (n: RadiiNode): CanvasCornerRadii => {
		const uniform = n.radius ?? 0;
		return (
			n.cornerRadii ?? {
				topLeft: uniform,
				topRight: uniform,
				bottomRight: uniform,
				bottomLeft: uniform,
			}
		);
	};
	const corner = (
		key: keyof CanvasCornerRadii,
		label: string,
		testId: string,
	): React.JSX.Element => {
		const shared = sharedFieldValue(nodes, (n) => radiiOf(n as RadiiNode)[key]);
		return (
			<NumberField
				label={label}
				value={shared.value}
				mixed={shared.mixed}
				min={0}
				dataTestId={testId}
				contract={{
					nodes,
					buildPatch: (n, v) => ({
						cornerRadii: { ...radiiOf(n as RadiiNode), [key]: v },
					}),
				}}
			/>
		);
	};
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
