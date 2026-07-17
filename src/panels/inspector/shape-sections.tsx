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
	type CommitPatchAll,
	NumberField,
	Section,
	sharedFieldValue,
} from "../fields.js";
import { FillAndShadowFields } from "../fill-shadow-fields.js";
import { CornerRadiiFields, StrokeFields } from "./stroke-section.js";

/**
 * Shape-kind inspector sections (M0-07 split from `PropertyInspector.tsx`).
 * One exported render function per built-in shape kind; dispatch lives in
 * `./type-sections.tsx`. B-12: stroke controls unified in `StrokeFields`
 * (B-03a), per-corner radii on rect (B-03b), and every continuous field
 * follows the §10 field-input contract via the `contract` prop.
 *
 * FR-070 (B-12 multi-kind sections): every render function takes the WHOLE
 * same-kind selection as `nodes` (a single-node array for single-selection).
 * Fields patch every node in ONE batch — continuous fields via the `contract`
 * prop's `nodes`, discrete ones via `commitPatchAll` — with a differing value
 * across the selection rendered as "Mixed" via `NumberField`'s `mixed` prop.
 */

export function renderRectFields(
	nodes: readonly CanvasRectNode[],
	commitPatchAll: CommitPatchAll,
	t: CanvasT,
): React.JSX.Element {
	const radius = sharedFieldValue(
		nodes,
		(n) => (n as CanvasRectNode).radius ?? 0,
	);
	return (
		<Section title={t("canvas.inspector.shape", "Shape")}>
			<FillAndShadowFields
				nodes={nodes}
				commitPatchAll={commitPatchAll}
				t={t}
			/>
			<StrokeFields nodes={nodes} commitPatchAll={commitPatchAll} t={t} />
			<NumberField
				label={t("canvas.inspector.radius", "Radius")}
				value={radius.value}
				mixed={radius.mixed}
				min={0}
				dataTestId="prop-radius"
				contract={{
					nodes,
					// A uniform radius edit supersedes any per-corner values.
					buildPatch: (_n, v) => ({ radius: v, cornerRadii: undefined }),
				}}
			/>
			<CornerRadiiFields nodes={nodes} t={t} />
		</Section>
	);
}

export function renderEllipseFields(
	nodes: readonly CanvasEllipseNode[],
	commitPatchAll: CommitPatchAll,
	t: CanvasT,
): React.JSX.Element {
	return (
		<Section title={t("canvas.inspector.shape", "Shape")}>
			<FillAndShadowFields
				nodes={nodes}
				commitPatchAll={commitPatchAll}
				t={t}
			/>
			<StrokeFields nodes={nodes} commitPatchAll={commitPatchAll} t={t} />
		</Section>
	);
}

export function renderPolygonFields(
	nodes: readonly CanvasPolygonNode[],
	commitPatchAll: CommitPatchAll,
	t: CanvasT,
): React.JSX.Element {
	const sides = sharedFieldValue(nodes, (n) => (n as CanvasPolygonNode).sides);
	return (
		<Section title={t("canvas.inspector.shape", "Shape")}>
			<NumberField
				label={t("canvas.inspector.sides", "Sides")}
				value={sides.value}
				mixed={sides.mixed}
				min={3}
				step={1}
				dataTestId="prop-polygon-sides"
				contract={{
					nodes,
					buildPatch: (_n, v) => ({ sides: Math.round(v) }),
				}}
			/>
			<FillAndShadowFields
				nodes={nodes}
				commitPatchAll={commitPatchAll}
				t={t}
			/>
			<StrokeFields nodes={nodes} commitPatchAll={commitPatchAll} t={t} />
		</Section>
	);
}

export function renderStarFields(
	nodes: readonly CanvasStarNode[],
	commitPatchAll: CommitPatchAll,
	t: CanvasT,
): React.JSX.Element {
	const points = sharedFieldValue(nodes, (n) => (n as CanvasStarNode).points);
	const innerRadiusRatio = sharedFieldValue(
		nodes,
		(n) => (n as CanvasStarNode).innerRadiusRatio,
	);
	return (
		<Section title={t("canvas.inspector.shape", "Shape")}>
			<NumberField
				label={t("canvas.inspector.points", "Points")}
				value={points.value}
				mixed={points.mixed}
				min={3}
				step={1}
				dataTestId="prop-star-points"
				contract={{
					nodes,
					buildPatch: (_n, v) => ({ points: Math.round(v) }),
				}}
			/>
			<NumberField
				label={t("canvas.inspector.innerRadiusRatio", "Inner radius")}
				value={innerRadiusRatio.value}
				mixed={innerRadiusRatio.mixed}
				min={0}
				max={1}
				step={0.05}
				dataTestId="prop-star-inner-radius"
				contract={{
					nodes,
					buildPatch: (_n, v) => ({ innerRadiusRatio: v }),
				}}
			/>
			<FillAndShadowFields
				nodes={nodes}
				commitPatchAll={commitPatchAll}
				t={t}
			/>
			<StrokeFields nodes={nodes} commitPatchAll={commitPatchAll} t={t} />
		</Section>
	);
}

export function renderLineFields(
	nodes: readonly CanvasLineNode[],
	commitPatchAll: CommitPatchAll,
	t: CanvasT,
): React.JSX.Element {
	return (
		<Section title={t("canvas.inspector.line", "Line")}>
			<StrokeFields
				nodes={nodes}
				commitPatchAll={commitPatchAll}
				t={t}
				arrows
			/>
		</Section>
	);
}
