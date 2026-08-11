"use client";

import type { CanvasGroupNode, CanvasPathNode } from "@anvilkit/canvas-core";
import { Button } from "@anvilkit/ui/button";
import * as React from "react";
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

/**
 * A group carries no paint of its own, and that is a fact of the IR rather
 * than a gap in this section: `CanvasGroupNode` is `{ type; children }`
 * (`core/src/ir/types.ts:484-487`) — no `fill`, no `background`, no `stroke`.
 *
 * `cp3-005`: that is exactly what makes the 22 multi-colour catalog stickers
 * safe. Each builds a `group` of independently-painted parts, so there is no
 * single control here that COULD repaint "some" of one — the half-recolour
 * this task forbids is structurally impossible rather than merely avoided.
 * What was missing is that the product never said so, leaving a user who
 * selects a sticker looking at a colourless section with no idea that
 * recolouring is per part. Hence the note: it names the mechanism (select the
 * part, in the Layer panel or on the canvas) instead of leaving the absence of
 * a fill control to be read as a bug.
 */
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
			<p
				data-testid="prop-group-part-colors"
				role="note"
				className="rounded-md bg-muted px-2.5 py-2 text-[0.7rem] leading-snug text-muted-foreground"
			>
				{t(
					"canvas.inspector.groupPartColors",
					"A group has no color of its own. Select a part to recolor it.",
				)}
			</p>
		</Section>
	);
}
