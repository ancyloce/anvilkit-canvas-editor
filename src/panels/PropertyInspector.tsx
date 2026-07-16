"use client";

import type { CanvasNode, CanvasPage } from "@anvilkit/canvas-core";
import { useSyncExternalStore } from "react";
import {
	useCanvasStudio,
	useCanvasT,
} from "../context/canvas-studio-context.js";
import {
	ColorField,
	NumberField,
	Section,
	TextField,
	useCommitPatch,
} from "./fields.js";
import { AppearanceSection } from "./inspector/appearance-section.js";
import { BrandComplianceWarnings } from "./inspector/brand-warnings.js";
import { summarizeSelection } from "./inspector/selection-summary.js";
import { renderTypeSpecificFields } from "./inspector/type-sections.js";

export interface PropertyInspectorProps {
	id?: string;
}

/**
 * Right-hand property inspector (M0-07 architecture, completed in B-12):
 * - no selection → the ACTIVE PAGE's properties (FR-070),
 * - single selection → full per-kind sections,
 * - multi selection → the shared Layer/Transform/Appearance sections over
 *   every selected node, with mixed values rendered as "Mixed" and commits
 *   fanning out as ONE batch (§10 contract via the fields' `contract` prop).
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
	const nodes = summary.nodes;
	const node = summary.primary;

	const commitPatch = useCommitPatch();
	const t = useCanvasT();

	const rootClass =
		"flex h-full min-w-[240px] max-w-[320px] flex-col gap-4 overflow-y-auto bg-card p-4 text-sm text-foreground select-none";

	if (!node) {
		const page = ctx.ir.pages.find((p) => p.id === ctx.activePageId);
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
				{page ? (
					<PageProperties page={page} />
				) : (
					<div
						className="text-xs text-muted-foreground italic"
						data-testid="property-inspector-empty"
					>
						{t(
							"canvas.inspector.empty",
							"Select a layer to edit its properties.",
						)}
					</div>
				)}
			</section>
		);
	}

	const multi = summary.mode === "multi";
	const opacity = shared(nodes, (n) => n.opacity ?? 1);
	const x = shared(nodes, (n) => n.transform.x);
	const y = shared(nodes, (n) => n.transform.y);
	const width = shared(nodes, (n) => n.bounds.width);
	const height = shared(nodes, (n) => n.bounds.height);
	const rotation = shared(nodes, (n) => n.transform.rotation);

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
				<div
					className="text-xs text-muted-foreground capitalize"
					data-testid="prop-selection-kind"
				>
					{multi
						? t(
								"canvas.inspector.multiSelection",
								"{n} layers selected",
							).replace("{n}", String(nodes.length))
						: t("canvas.inspector.layerType", "{type} layer").replace(
								"{type}",
								node.type,
							)}
				</div>
			</div>
			<BrandComplianceWarnings nodes={nodes} />
			<div
				className="flex flex-col gap-4"
				key={multi ? selectedIds.join(",") : node.id}
			>
				<Section title={t("canvas.inspector.layer", "Layer")}>
					{multi ? null : (
						<TextField
							label={t("canvas.inspector.name", "Name")}
							value={node.name ?? ""}
							dataTestId="prop-name"
							contract={{ nodes, buildPatch: (_n, v) => ({ name: v }) }}
						/>
					)}
					<NumberField
						label={t("canvas.inspector.opacity", "Opacity")}
						value={opacity.value}
						mixed={opacity.mixed}
						step={0.05}
						min={0}
						max={1}
						dataTestId="prop-opacity"
						contract={{ nodes, buildPatch: (_n, v) => ({ opacity: v }) }}
					/>
				</Section>
				<Section title={t("canvas.inspector.transform", "Transform")}>
					<NumberField
						label={t("canvas.inspector.x", "X")}
						value={x.value}
						mixed={x.mixed}
						dataTestId="prop-x"
						contract={{
							nodes,
							buildPatch: (n, v) => ({ transform: { ...n.transform, x: v } }),
						}}
					/>
					<NumberField
						label={t("canvas.inspector.y", "Y")}
						value={y.value}
						mixed={y.mixed}
						dataTestId="prop-y"
						contract={{
							nodes,
							buildPatch: (n, v) => ({ transform: { ...n.transform, y: v } }),
						}}
					/>
					<NumberField
						label={t("canvas.inspector.width", "Width")}
						value={width.value}
						mixed={width.mixed}
						min={0}
						dataTestId="prop-width"
						contract={{
							nodes,
							buildPatch: (n, v) => ({ bounds: { ...n.bounds, width: v } }),
						}}
					/>
					<NumberField
						label={t("canvas.inspector.height", "Height")}
						value={height.value}
						mixed={height.mixed}
						min={0}
						dataTestId="prop-height"
						contract={{
							nodes,
							buildPatch: (n, v) => ({ bounds: { ...n.bounds, height: v } }),
						}}
					/>
					<NumberField
						label={t("canvas.inspector.rotation", "Rotation")}
						value={rotation.value}
						mixed={rotation.mixed}
						step={1}
						dataTestId="prop-rotation"
						contract={{
							nodes,
							buildPatch: (n, v) => ({
								transform: { ...n.transform, rotation: v },
							}),
						}}
					/>
				</Section>
				<AppearanceSection nodes={nodes} t={t} />
				{multi ? null : renderTypeSpecificFields(node, commitPatch, ctx, t)}
			</div>
		</section>
	);
}

/** Shared-value/mixed reduction over the selection (FR-070 multi-editing). */
function shared(
	nodes: readonly CanvasNode[],
	get: (n: CanvasNode) => number,
): { value: number; mixed: boolean } {
	const first = nodes[0];
	if (!first) return { value: 0, mixed: false };
	const v = get(first);
	return { value: v, mixed: nodes.some((n) => get(n) !== v) };
}

/**
 * FR-070 page properties — shown when nothing is selected. Size edits commit
 * `page.resize` (canvas-only mode; the full mode picker lives in the page
 * settings dialog, B-11) and the background commits `page.set-background`,
 * both coalescing rapid re-commits per §10.
 */
function PageProperties({ page }: { page: CanvasPage }): React.JSX.Element {
	const ctx = useCanvasStudio();
	const t = useCanvasT();
	const resize = (size: { width: number; height: number }): void => {
		const cmd = {
			type: "page.resize" as const,
			pageId: page.id,
			from: { width: page.size.width, height: page.size.height },
			to: size,
		};
		if (ctx.commitCoalesced) ctx.commitCoalesced(cmd, `page-size:${page.id}`);
		else ctx.commit(cmd);
	};
	return (
		<div className="flex flex-col gap-4" data-testid="page-properties">
			<Section title={t("canvas.inspector.page", "Page")}>
				<TextField
					label={t("canvas.inspector.name", "Name")}
					value={page.name ?? ""}
					dataTestId="prop-page-name"
					onCommit={(v) =>
						ctx.commit({
							type: "page.rename",
							pageId: page.id,
							from: page.name,
							to: v.trim() === "" ? undefined : v,
						})
					}
				/>
				<NumberField
					label={t("canvas.inspector.width", "Width")}
					value={page.size.width}
					min={1}
					dataTestId="prop-page-width"
					onCommit={(v) =>
						resize({ width: Math.round(v), height: page.size.height })
					}
				/>
				<NumberField
					label={t("canvas.inspector.height", "Height")}
					value={page.size.height}
					min={1}
					dataTestId="prop-page-height"
					onCommit={(v) =>
						resize({ width: page.size.width, height: Math.round(v) })
					}
				/>
				<ColorField
					label={t("canvas.pageSettings.background", "Background")}
					value={
						page.background.kind === "solid" ? page.background.value : undefined
					}
					dataTestId="prop-page-background"
					onCommit={(v) => {
						const cmd = {
							type: "page.set-background" as const,
							pageId: page.id,
							from: page.background,
							to: { kind: "solid" as const, value: v },
						};
						if (ctx.commitCoalesced)
							ctx.commitCoalesced(cmd, `page-bg:${page.id}`);
						else ctx.commit(cmd);
					}}
				/>
			</Section>
		</div>
	);
}
