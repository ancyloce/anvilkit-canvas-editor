"use client";

import type {
	CanvasCommand,
	CanvasNode,
	CanvasPage,
	CanvasPageBackground,
} from "@anvilkit/canvas-core";
import * as React from "react";
import { useSyncExternalStore } from "react";
import {
	useCanvasStudio,
	useCanvasT,
} from "../context/canvas-studio-context.js";
import type { FieldPageContract } from "../context/field-contract.js";
import type { PagePreviewPatch } from "../stores/field-preview-store.js";
import {
	ColorField,
	NumberField,
	Section,
	TextField,
	useCommitPatchAll,
} from "./fields.js";
import { AppearanceSection } from "./inspector/appearance-section.js";
import { AutoLayoutSection } from "./inspector/auto-layout-section.js";
import { BrandComplianceWarnings } from "./inspector/brand-warnings.js";
import { ComponentPropertySection } from "./inspector/component-sections.js";
import { summarizeSelection } from "./inspector/selection-summary.js";
import { TransformSection } from "./inspector/transform-section.js";
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
 *   fanning out as ONE batch (§10 contract via the fields' `contract` prop);
 *   when every selected node also shares one KIND (`summary.sharedKind`),
 *   the kind-specific section (Fill/Stroke/CornerRadius for a shape, the
 *   text fields, the media section, …) renders too, over the whole
 *   selection, via the same mixed-value/one-batch mechanism (FR-070 gap
 *   closure — a mixed-kind selection still only gets the shared sections).
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

	const commitPatchAll = useCommitPatchAll();
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
				<TransformSection nodes={nodes} />
				<AutoLayoutSection nodes={nodes} />
				<AppearanceSection nodes={nodes} t={t} />
				{summary.sharedKind !== null
					? renderTypeSpecificFields(nodes, commitPatchAll, ctx, t)
					: null}
				{/* Plan 0023 M5-04: property authoring for a node inside an open
				    Source. Renders nothing while editing a page, so mounting it
				    unconditionally costs a page-mode user nothing. */}
				<ComponentPropertySection nodes={nodes} ctx={ctx} t={t} />
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
 * Builds a page-level §10 contract whose preview and commit are BOTH derived
 * from ONE `next(value)` function (plan 0024 T-2.7).
 *
 * This shape exists to make divergence structurally impossible. A page's
 * preview patch and its command carry the SAME value in DIFFERENT shapes — the
 * preview shallow-merges a whole `CanvasPageSize` onto the page, while
 * `page.resize` takes a bare `{width, height}` — so writing the two by hand
 * invites them to drift, and a drifted pair makes the artboard render one size
 * during the drag and commit another on release. Here `next` is the single
 * derivation and `toPatch`/`toCommand` are pure adapters over its result.
 */
function pageFieldContract<T, N>(
	page: CanvasPage,
	next: (value: T) => N,
	toPatch: (next: N) => PagePreviewPatch,
	toCommand: (page: CanvasPage, next: N) => CanvasCommand,
): FieldPageContract<T> {
	return {
		page,
		buildPatch: (_p, value) => toPatch(next(value)),
		buildCommand: (p, value) => toCommand(p, next(value)),
	};
}

/**
 * FR-070 page properties — shown when nothing is selected. Size and background
 * edits now PREVIEW live on the artboard and commit once on release (plan 0024
 * Phase 2): `page.resize` in canvas-only mode (the full mode picker lives in
 * the page settings dialog, B-11) and `page.set-background`.
 *
 * The viewport deliberately does NOT re-fit while a size preview is in flight —
 * `zoomToFit` is user-triggered only, and re-framing mid-drag would fight the
 * user (T-2.5).
 */
function PageProperties({ page }: { page: CanvasPage }): React.JSX.Element {
	const ctx = useCanvasStudio();
	const t = useCanvasT();

	/** Resize along one axis, holding the other. */
	const sizeContract = (axis: "width" | "height"): FieldPageContract<number> =>
		pageFieldContract<number, { width: number; height: number }>(
			page,
			(v) => ({
				width: axis === "width" ? Math.round(v) : page.size.width,
				height: axis === "height" ? Math.round(v) : page.size.height,
			}),
			// Spread the page's own size so `unit`/`dpi` survive the preview merge —
			// the command preserves them by only carrying width/height.
			(size) => ({ size: { ...page.size, ...size } }),
			(p, size) => ({
				type: "page.resize",
				pageId: p.id,
				from: { width: p.size.width, height: p.size.height },
				to: size,
			}),
		);

	const backgroundContract = pageFieldContract<string, CanvasPageBackground>(
		page,
		(v) => ({ kind: "solid", value: v }),
		(background) => ({ background }),
		(p, background) => ({
			type: "page.set-background",
			pageId: p.id,
			from: p.background,
			to: background,
		}),
	);

	return (
		<div className="flex flex-col gap-4" data-testid="page-properties">
			<Section title={t("canvas.inspector.page", "Page")}>
				{/* Commit-on-blur by design (plan 0024 T-2.6): a page NAME has no
				    canvas geometry, so there is nothing for a live preview to show. */}
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
					pageContract={sizeContract("width")}
				/>
				<NumberField
					label={t("canvas.inspector.height", "Height")}
					value={page.size.height}
					min={1}
					dataTestId="prop-page-height"
					pageContract={sizeContract("height")}
				/>
				<ColorField
					label={t("canvas.pageSettings.background", "Background")}
					value={
						page.background.kind === "solid" ? page.background.value : undefined
					}
					dataTestId="prop-page-background"
					pageContract={backgroundContract}
				/>
			</Section>
		</div>
	);
}
