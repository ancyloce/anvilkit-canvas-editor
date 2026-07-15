"use client";

import { useSyncExternalStore } from "react";
import {
	useCanvasStudio,
	useCanvasT,
} from "../context/canvas-studio-context.js";
import { NumberField, Section, TextField, useCommitPatch } from "./fields.js";
import { summarizeSelection } from "./inspector/selection-summary.js";
import { renderTypeSpecificFields } from "./inspector/type-sections.js";

export interface PropertyInspectorProps {
	id?: string;
}

/**
 * Right-hand property inspector. M0-07 pre-refactor: this shell owns the
 * selection subscription, the empty state, and the shared Layer/Transform
 * sections; every kind-specific section lives under `./inspector/` and is
 * routed through `renderTypeSpecificFields`. Selection semantics come from
 * `summarizeSelection` — the inspector still edits `summary.primary` (the
 * first selected node); multi-selection rendering arrives with PRD 0012
 * FR-070 (B-12) on top of the summary's already-computed multi facts.
 */
export function PropertyInspector({
	id,
}: PropertyInspectorProps): React.JSX.Element {
	const ctx = useCanvasStudio();
	const selectedIds = useSyncExternalStore(
		ctx.selectionStore.subscribe,
		() => ctx.selectionStore.getState().selectedIds,
		() => ctx.selectionStore.getState().selectedIds,
	);
	const summary = summarizeSelection(ctx.ir, selectedIds);
	const node = summary.primary;

	const commitPatch = useCommitPatch();
	const t = useCanvasT();

	const rootClass =
		"flex h-full min-w-[240px] max-w-[320px] flex-col gap-4 overflow-y-auto bg-card p-4 text-sm text-foreground select-none";

	if (!node) {
		return (
			<section
				data-testid="property-inspector"
				aria-label={t("canvas.inspector.properties", "Properties")}
				className={rootClass}
				{...(id !== undefined ? { id } : {})}
			>
				<div className="text-[13px] font-semibold text-foreground">
					{t("canvas.inspector.title", "Inspector")}
				</div>
				<div
					className="text-xs text-muted-foreground italic"
					data-testid="property-inspector-empty"
				>
					{t(
						"canvas.inspector.empty",
						"Select a layer to edit its properties.",
					)}
				</div>
			</section>
		);
	}

	return (
		<section
			data-testid="property-inspector"
			data-node-id={node.id}
			aria-label={t("canvas.inspector.properties", "Properties")}
			className={rootClass}
			{...(id !== undefined ? { id } : {})}
		>
			<div>
				<div className="text-[13px] font-semibold text-foreground">
					{t("canvas.inspector.title", "Inspector")}
				</div>
				<div className="text-xs text-muted-foreground capitalize">
					{t("canvas.inspector.layerType", "{type} layer").replace(
						"{type}",
						node.type,
					)}
				</div>
			</div>
			<div className="flex flex-col gap-4" key={node.id}>
				<Section title={t("canvas.inspector.layer", "Layer")}>
					<TextField
						label={t("canvas.inspector.name", "Name")}
						value={node.name ?? ""}
						dataTestId="prop-name"
						onCommit={(v) => commitPatch(node, { name: v })}
					/>
					<NumberField
						label={t("canvas.inspector.opacity", "Opacity")}
						value={node.opacity ?? 1}
						step={0.05}
						min={0}
						max={1}
						dataTestId="prop-opacity"
						onCommit={(v) => commitPatch(node, { opacity: v })}
					/>
				</Section>
				<Section title={t("canvas.inspector.transform", "Transform")}>
					<NumberField
						label={t("canvas.inspector.x", "X")}
						value={node.transform.x}
						dataTestId="prop-x"
						onCommit={(v) =>
							commitPatch(node, {
								transform: { ...node.transform, x: v },
							})
						}
					/>
					<NumberField
						label={t("canvas.inspector.y", "Y")}
						value={node.transform.y}
						dataTestId="prop-y"
						onCommit={(v) =>
							commitPatch(node, {
								transform: { ...node.transform, y: v },
							})
						}
					/>
					<NumberField
						label={t("canvas.inspector.width", "Width")}
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
						label={t("canvas.inspector.height", "Height")}
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
						label={t("canvas.inspector.rotation", "Rotation")}
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
				{renderTypeSpecificFields(node, commitPatch, ctx, t)}
			</div>
		</section>
	);
}
