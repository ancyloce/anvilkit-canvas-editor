"use client";

import type { CanvasGroupNode, CanvasPathNode } from "@anvilkit/canvas-core";
import { Button } from "@anvilkit/ui/button";
import type {
	CanvasStudioContextValue,
	CanvasT,
} from "../../context/canvas-studio-context.js";
import { beginPathEdit } from "../../selection/path-edit-actions.js";
import {
	type CommitPatchAll,
	FieldRow,
	Section,
	sharedFieldValue,
	TextField,
} from "../fields.js";
import { FillAndShadowFields } from "../fill-shadow-fields.js";
import { StrokeFields } from "./stroke-section.js";

/**
 * Path / group inspector sections (M0-07 split from `PropertyInspector.tsx`,
 * verbatim). Dispatch lives in `./type-sections.tsx`.
 *
 * FR-070 (B-12 multi-kind sections): `nodes` is the whole same-kind
 * selection; fields patch every node in ONE batch (see `shape-sections.tsx`
 * for the general pattern). "Edit points" is inherently single-node
 * interactive path editing — it acts on the FIRST selected node.
 */

export function renderPathFields(
	nodes: readonly CanvasPathNode[],
	commitPatchAll: CommitPatchAll,
	ctx: CanvasStudioContextValue,
	t: CanvasT,
): React.JSX.Element {
	const node = nodes[0] as CanvasPathNode;
	const d = sharedFieldValue(nodes, (n) => (n as CanvasPathNode).d);
	return (
		<Section title={t("canvas.inspector.path", "Path")}>
			<FillAndShadowFields
				nodes={nodes}
				commitPatchAll={commitPatchAll}
				t={t}
			/>
			<StrokeFields
				nodes={nodes}
				commitPatchAll={commitPatchAll}
				t={t}
				arrows
			/>
			<TextField
				label={t("canvas.inspector.pathD", "Path d")}
				value={d.value}
				mixed={d.mixed}
				dataTestId="prop-path-d"
				contract={{ nodes, buildPatch: (_n, v) => ({ d: v }) }}
			/>
			<Button
				type="button"
				variant="outline"
				size="sm"
				className="w-full"
				data-testid="prop-path-edit"
				onClick={() => beginPathEdit(ctx, node.id)}
			>
				{t("canvas.inspector.editPoints", "Edit points")}
			</Button>
		</Section>
	);
}

export function renderGroupFields(
	nodes: readonly CanvasGroupNode[],
	t: CanvasT,
): React.JSX.Element {
	const children = sharedFieldValue(
		nodes,
		(n) => (n as CanvasGroupNode).children.length,
	);
	return (
		<Section title={t("canvas.inspector.group", "Group")}>
			<FieldRow label={t("canvas.inspector.children", "Children")}>
				<span
					data-testid="prop-children-count"
					className="text-xs text-foreground"
				>
					{children.mixed
						? t("canvas.inspector.mixed", "Mixed")
						: children.value}
				</span>
			</FieldRow>
		</Section>
	);
}
