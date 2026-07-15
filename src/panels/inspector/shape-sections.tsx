"use client";

import type {
	CanvasEllipseNode,
	CanvasLineNode,
	CanvasPolygonNode,
	CanvasRectNode,
	CanvasStarNode,
} from "@anvilkit/canvas-core";
import type { CanvasT } from "../../context/canvas-studio-context.js";
import { type CommitPatch, NumberField, Section } from "../fields.js";
import { FillAndShadowFields } from "../fill-shadow-fields.js";
import { CornerRadiiFields, StrokeFields } from "./stroke-section.js";

/**
 * Shape-kind inspector sections (M0-07 split from `PropertyInspector.tsx`).
 * One exported render function per built-in shape kind; dispatch lives in
 * `./type-sections.tsx`. B-12: stroke controls unified in `StrokeFields`
 * (B-03a), per-corner radii on rect (B-03b), and every continuous field
 * follows the §10 field-input contract via the `contract` prop.
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
			<StrokeFields node={node} commitPatch={commitPatch} t={t} />
			<NumberField
				label={t("canvas.inspector.radius", "Radius")}
				value={node.radius ?? 0}
				min={0}
				dataTestId="prop-radius"
				contract={{
					nodes: [node],
					// A uniform radius edit supersedes any per-corner values.
					buildPatch: (_n, v) => ({ radius: v, cornerRadii: undefined }),
				}}
			/>
			<CornerRadiiFields node={node} t={t} />
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
			<StrokeFields node={node} commitPatch={commitPatch} t={t} />
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
				contract={{
					nodes: [node],
					buildPatch: (_n, v) => ({ sides: Math.round(v) }),
				}}
			/>
			<FillAndShadowFields
				node={node}
				fill={node.fill}
				shadow={node.shadow}
				commitPatch={commitPatch}
				t={t}
			/>
			<StrokeFields node={node} commitPatch={commitPatch} t={t} />
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
				contract={{
					nodes: [node],
					buildPatch: (_n, v) => ({ points: Math.round(v) }),
				}}
			/>
			<NumberField
				label={t("canvas.inspector.innerRadiusRatio", "Inner radius")}
				value={node.innerRadiusRatio}
				min={0}
				max={1}
				step={0.05}
				dataTestId="prop-star-inner-radius"
				contract={{
					nodes: [node],
					buildPatch: (_n, v) => ({ innerRadiusRatio: v }),
				}}
			/>
			<FillAndShadowFields
				node={node}
				fill={node.fill}
				shadow={node.shadow}
				commitPatch={commitPatch}
				t={t}
			/>
			<StrokeFields node={node} commitPatch={commitPatch} t={t} />
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
			<StrokeFields node={node} commitPatch={commitPatch} t={t} arrows />
		</Section>
	);
}
