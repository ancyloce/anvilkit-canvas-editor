"use client";

import type {
	CanvasEllipseNode,
	CanvasLineNode,
	CanvasPolygonNode,
	CanvasRectNode,
	CanvasStarNode,
} from "@anvilkit/canvas-core";
import type { CanvasT } from "../../context/canvas-studio-context.js";
import {
	ColorField,
	type CommitPatch,
	NumberField,
	Section,
} from "../fields.js";
import { FillAndShadowFields } from "../fill-shadow-fields.js";

/**
 * Shape-kind inspector sections (M0-07 split from `PropertyInspector.tsx`,
 * verbatim). One exported render function per built-in shape kind; dispatch
 * lives in `./type-sections.tsx`.
 */

export function renderRectFields(
	node: CanvasRectNode,
	commitPatch: CommitPatch,
	t: CanvasT,
): React.JSX.Element {
	return (
		<Section title={t("canvas.inspector.shape", "Shape")}>
			<FillAndShadowFields
				node={node}
				fill={node.fill}
				shadow={node.shadow}
				commitPatch={commitPatch}
				t={t}
			/>
			<ColorField
				label={t("canvas.inspector.stroke", "Stroke")}
				value={node.stroke}
				dataTestId="prop-stroke"
				onCommit={(v) => commitPatch(node, { stroke: v })}
			/>
			<NumberField
				label={t("canvas.inspector.strokeWidth", "Stroke W")}
				value={node.strokeWidth ?? 0}
				min={0}
				dataTestId="prop-stroke-width"
				onCommit={(v) => commitPatch(node, { strokeWidth: v })}
			/>
			<NumberField
				label={t("canvas.inspector.radius", "Radius")}
				value={node.radius ?? 0}
				min={0}
				dataTestId="prop-radius"
				onCommit={(v) => commitPatch(node, { radius: v })}
			/>
		</Section>
	);
}

export function renderEllipseFields(
	node: CanvasEllipseNode,
	commitPatch: CommitPatch,
	t: CanvasT,
): React.JSX.Element {
	return (
		<Section title={t("canvas.inspector.shape", "Shape")}>
			<FillAndShadowFields
				node={node}
				fill={node.fill}
				shadow={node.shadow}
				commitPatch={commitPatch}
				t={t}
			/>
			<ColorField
				label={t("canvas.inspector.stroke", "Stroke")}
				value={node.stroke}
				dataTestId="prop-stroke"
				onCommit={(v) => commitPatch(node, { stroke: v })}
			/>
			<NumberField
				label={t("canvas.inspector.strokeWidth", "Stroke W")}
				value={node.strokeWidth ?? 0}
				min={0}
				dataTestId="prop-stroke-width"
				onCommit={(v) => commitPatch(node, { strokeWidth: v })}
			/>
		</Section>
	);
}

export function renderPolygonFields(
	node: CanvasPolygonNode,
	commitPatch: CommitPatch,
	t: CanvasT,
): React.JSX.Element {
	return (
		<Section title={t("canvas.inspector.shape", "Shape")}>
			<NumberField
				label={t("canvas.inspector.sides", "Sides")}
				value={node.sides}
				min={3}
				step={1}
				dataTestId="prop-polygon-sides"
				onCommit={(v) => commitPatch(node, { sides: Math.round(v) })}
			/>
			<FillAndShadowFields
				node={node}
				fill={node.fill}
				shadow={node.shadow}
				commitPatch={commitPatch}
				t={t}
			/>
			<ColorField
				label={t("canvas.inspector.stroke", "Stroke")}
				value={node.stroke}
				dataTestId="prop-stroke"
				onCommit={(v) => commitPatch(node, { stroke: v })}
			/>
			<NumberField
				label={t("canvas.inspector.strokeWidth", "Stroke W")}
				value={node.strokeWidth ?? 0}
				min={0}
				dataTestId="prop-stroke-width"
				onCommit={(v) => commitPatch(node, { strokeWidth: v })}
			/>
		</Section>
	);
}

export function renderStarFields(
	node: CanvasStarNode,
	commitPatch: CommitPatch,
	t: CanvasT,
): React.JSX.Element {
	return (
		<Section title={t("canvas.inspector.shape", "Shape")}>
			<NumberField
				label={t("canvas.inspector.points", "Points")}
				value={node.points}
				min={3}
				step={1}
				dataTestId="prop-star-points"
				onCommit={(v) => commitPatch(node, { points: Math.round(v) })}
			/>
			<NumberField
				label={t("canvas.inspector.innerRadiusRatio", "Inner radius")}
				value={node.innerRadiusRatio}
				min={0}
				max={1}
				step={0.05}
				dataTestId="prop-star-inner-radius"
				onCommit={(v) => commitPatch(node, { innerRadiusRatio: v })}
			/>
			<FillAndShadowFields
				node={node}
				fill={node.fill}
				shadow={node.shadow}
				commitPatch={commitPatch}
				t={t}
			/>
			<ColorField
				label={t("canvas.inspector.stroke", "Stroke")}
				value={node.stroke}
				dataTestId="prop-stroke"
				onCommit={(v) => commitPatch(node, { stroke: v })}
			/>
			<NumberField
				label={t("canvas.inspector.strokeWidth", "Stroke W")}
				value={node.strokeWidth ?? 0}
				min={0}
				dataTestId="prop-stroke-width"
				onCommit={(v) => commitPatch(node, { strokeWidth: v })}
			/>
		</Section>
	);
}

export function renderLineFields(
	node: CanvasLineNode,
	commitPatch: CommitPatch,
	t: CanvasT,
): React.JSX.Element {
	return (
		<Section title={t("canvas.inspector.line", "Line")}>
			<ColorField
				label={t("canvas.inspector.stroke", "Stroke")}
				value={node.stroke}
				dataTestId="prop-stroke"
				onCommit={(v) => commitPatch(node, { stroke: v })}
			/>
			<NumberField
				label={t("canvas.inspector.strokeWidth", "Stroke W")}
				value={node.strokeWidth ?? 1}
				min={0}
				dataTestId="prop-stroke-width"
				onCommit={(v) => commitPatch(node, { strokeWidth: v })}
			/>
		</Section>
	);
}
