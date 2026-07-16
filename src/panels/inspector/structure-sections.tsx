"use client";

import type { CanvasGroupNode, CanvasPathNode } from "@anvilkit/canvas-core";
import { Button } from "@anvilkit/ui/button";
import type {
	CanvasStudioContextValue,
	CanvasT,
} from "../../context/canvas-studio-context.js";
import { beginPathEdit } from "../../selection/path-edit-actions.js";
import { type CommitPatch, FieldRow, Section, TextField } from "../fields.js";
import { FillAndShadowFields } from "../fill-shadow-fields.js";
import { StrokeFields } from "./stroke-section.js";

/**
 * Path / group inspector sections (M0-07 split from `PropertyInspector.tsx`,
 * verbatim). Dispatch lives in `./type-sections.tsx`.
 */

export function renderPathFields(
	node: CanvasPathNode,
	commitPatch: CommitPatch,
	ctx: CanvasStudioContextValue,
	t: CanvasT,
): React.JSX.Element {
	return (
		<Section title={t("canvas.inspector.path", "Path")}>
			<FillAndShadowFields
				node={node}
				fill={node.fill}
				commitPatch={commitPatch}
				t={t}
			/>
			<StrokeFields node={node} commitPatch={commitPatch} t={t} arrows />
			<TextField
				label={t("canvas.inspector.pathD", "Path d")}
				value={node.d}
				dataTestId="prop-path-d"
				contract={{ nodes: [node], buildPatch: (_n, v) => ({ d: v }) }}
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
	node: CanvasGroupNode,
	t: CanvasT,
): React.JSX.Element {
	return (
		<Section title={t("canvas.inspector.group", "Group")}>
			<FieldRow label={t("canvas.inspector.children", "Children")}>
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
