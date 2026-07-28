"use client";

import type {
	CanvasAutoLayout,
	CanvasCommand,
	CanvasFrameNode,
	CanvasLayoutAlign,
	CanvasLayoutPositioning,
	CanvasLayoutSizing,
	CanvasNode,
} from "@anvilkit/canvas-core";
import { parentOf } from "@anvilkit/canvas-core";
import { Button } from "@anvilkit/ui/button";
import { Link2, Unlink } from "lucide-react";
import * as React from "react";
import { useState } from "react";
import {
	canEnableAutoLayout,
	canRemoveAutoLayout,
	canWrapSelectionInAutoLayout,
	enableAutoLayoutOnSelectionImpl,
	removeAutoLayoutFromSelectionImpl,
	wrapSelectionInAutoLayoutImpl,
} from "../../actions/auto-layout-actions.js";
import {
	type CanvasT,
	useCanvasStudio,
	useCanvasT,
} from "../../context/canvas-studio-context.js";
import {
	FieldRow,
	NumberField,
	Section,
	sharedFieldValue,
	useFieldContract,
} from "../fields.js";

/**
 * @file T-M4-03/T-M4-04 — Inspector Auto Layout section.
 *
 * Frame-level fields (direction, padding, gap, alignment) render only when
 * EVERY selected node is a frame that already carries `autoLayout` — they are
 * hidden, not disabled, for mixed selections. Item-level fields (positioning,
 * sizing) render when every selected node's parent is an Auto Layout frame;
 * the Flow/Absolute toggle additionally requires one shared parent.
 *
 * Every value is read from the authoritative IR nodes (plus the transient
 * field preview the inputs themselves hold) — never from materialized
 * geometry. Continuous fields commit `frame.set-layout` through the §10
 * field-contract `buildCommand` seam (T-M4-02); discrete frame controls batch
 * `frame.set-layout` per frame as ONE history entry; item fields are plain
 * `layoutItem` patches, so they use the stock `node.update` engine.
 */

const ALIGNS: readonly CanvasLayoutAlign[] = ["start", "center", "end"];

function isLayoutFrame(node: CanvasNode): node is CanvasFrameNode {
	return node.type === "frame" && node.autoLayout != null;
}

function layoutOf(node: CanvasNode): CanvasAutoLayout {
	const layout = (node as CanvasFrameNode).autoLayout;
	if (!layout) {
		throw new Error(`node ${node.id} has no autoLayout`);
	}
	return layout;
}

/** TD-004: free primary-axis space is zero whenever any Flow child Fills the main axis. */
function hasMainAxisFillChild(frame: CanvasFrameNode): boolean {
	const layout = layoutOf(frame);
	const sizingKey =
		layout.direction === "horizontal" ? "widthSizing" : "heightSizing";
	return frame.children.some(
		(child) =>
			(child.layoutItem?.positioning ?? "flow") === "flow" &&
			child.layoutItem?.[sizingKey] === "fill",
	);
}

function alignLabel(t: CanvasT, align: CanvasLayoutAlign): string {
	switch (align) {
		case "start":
			return t("canvas.inspector.layoutAlignStart", "Start");
		case "center":
			return t("canvas.inspector.layoutAlignCenter", "Center");
		case "end":
			return t("canvas.inspector.layoutAlignEnd", "End");
	}
}

function SizingField({
	nodes,
	axis,
	includeFill,
	t,
}: {
	nodes: readonly CanvasNode[];
	axis: "width" | "height";
	includeFill: boolean;
	t: CanvasT;
}): React.JSX.Element {
	const sizingKey = axis === "width" ? "widthSizing" : "heightSizing";
	const shared = sharedFieldValue<CanvasLayoutSizing>(
		nodes,
		(n) => n.layoutItem?.[sizingKey] ?? "fixed",
	);
	const field = useFieldContract<CanvasLayoutSizing>(
		{
			nodes,
			buildPatch: (n, v) => ({
				layoutItem: { ...n.layoutItem, [sizingKey]: v },
			}),
		},
		`prop-layout-${axis}-sizing`,
	);
	const label =
		axis === "width"
			? t("canvas.inspector.layoutWidthSizing", "Width")
			: t("canvas.inspector.layoutHeightSizing", "Height");
	return (
		<FieldRow label={label}>
			<select
				aria-label={label}
				data-testid={`prop-layout-${axis}-sizing`}
				className="h-7.5 rounded-md border border-input bg-transparent px-2 text-xs"
				value={shared.mixed ? "" : shared.value}
				onChange={(e) =>
					field.commit(e.currentTarget.value as CanvasLayoutSizing)
				}
			>
				{shared.mixed ? (
					<option value="" disabled>
						{t("canvas.inspector.mixed", "Mixed")}
					</option>
				) : null}
				<option value="fixed">
					{t("canvas.inspector.layoutSizingFixed", "Fixed")}
				</option>
				<option value="hug">
					{t("canvas.inspector.layoutSizingHug", "Hug contents")}
				</option>
				{includeFill ? (
					<option value="fill">
						{t("canvas.inspector.layoutSizingFill", "Fill container")}
					</option>
				) : null}
			</select>
		</FieldRow>
	);
}

export function AutoLayoutSection({
	nodes,
}: {
	nodes: readonly CanvasNode[];
}): React.JSX.Element | null {
	const ctx = useCanvasStudio();
	const t = useCanvasT();

	const frames = nodes.length > 0 && nodes.every(isLayoutFrame) ? nodes : null;
	const parents = nodes.map((n) => parentOf(ctx.ir, n.id)?.parent);
	const itemEligible =
		nodes.length > 0 &&
		parents.every((p): p is CanvasFrameNode => p != null && isLayoutFrame(p));
	const sameParent =
		itemEligible && new Set(parents.map((p) => p?.id)).size === 1;

	// Padding link state: default linked when every frame's four sides agree.
	const [paddingLinked, setPaddingLinked] = useState<boolean>(() =>
		(frames ?? []).every((f) => {
			const p = layoutOf(f).padding;
			return p.top === p.right && p.top === p.bottom && p.top === p.left;
		}),
	);

	// T-M4-10: creation/conversion affordances exist ONLY behind the opt-in
	// flag; with the flag off (the default) no creation UI appears anywhere,
	// while editing existing intent below stays available.
	const creationEnabled = ctx.autoLayoutCreationEnabled === true;
	const ids = nodes.map((n) => n.id);
	const showAdd = creationEnabled && canEnableAutoLayout(ctx.ir, ids);
	const showWrap = creationEnabled && canWrapSelectionInAutoLayout(ctx.ir, ids);
	const showRemove = creationEnabled && canRemoveAutoLayout(ctx.ir, ids);

	if (!frames && !itemEligible && !showAdd && !showWrap) return null;

	/** Discrete frame controls: one `frame.set-layout` per frame, ONE undo entry. */
	const commitLayoutAll = (
		build: (frame: CanvasFrameNode) => CanvasAutoLayout,
	): void => {
		if (!frames) return;
		const cmds: CanvasCommand[] = frames.map((f) => ({
			type: "frame.set-layout",
			nodeId: f.id,
			layout: build(f as CanvasFrameNode),
		}));
		const first = cmds[0];
		if (!first) return;
		if (cmds.length === 1) ctx.commit(first);
		else ctx.commitBatch(cmds, "Auto layout");
	};

	const direction = frames
		? sharedFieldValue(frames, (n) => layoutOf(n).direction)
		: null;
	const gap = frames ? sharedFieldValue(frames, (n) => layoutOf(n).gap) : null;
	const primaryAlign = frames
		? sharedFieldValue(frames, (n) => layoutOf(n).primaryAlign)
		: null;
	const crossAlign = frames
		? sharedFieldValue(frames, (n) => layoutOf(n).crossAlign)
		: null;
	const primaryDisabled = frames
		? frames.some((f) => hasMainAxisFillChild(f as CanvasFrameNode))
		: false;

	const positioning = sharedFieldValue<CanvasLayoutPositioning>(
		nodes,
		(n) => n.layoutItem?.positioning ?? "flow",
	);

	const commitPositioningAll = (value: CanvasLayoutPositioning): void => {
		const cmds: CanvasCommand[] = nodes.map((n) => ({
			type: "node.update",
			nodeId: n.id,
			kind: n.type,
			patch: { layoutItem: { ...n.layoutItem, positioning: value } },
		}));
		const first = cmds[0];
		if (!first) return;
		if (cmds.length === 1) ctx.commit(first);
		else ctx.commitBatch(cmds, "Auto layout");
	};

	const primaryDisabledTitle = t(
		"canvas.inspector.layoutPrimaryAlignDisabled",
		"Main-axis alignment has no effect while a child fills the main axis",
	);

	return (
		<Section title={t("canvas.inspector.autoLayout", "Auto layout")}>
			{showAdd ? (
				<Button
					type="button"
					variant="outline"
					size="sm"
					data-testid="prop-layout-add"
					onClick={() => enableAutoLayoutOnSelectionImpl(ctx)}
				>
					{t("canvas.inspector.layoutAdd", "Add auto layout")}
				</Button>
			) : null}
			{showWrap ? (
				<Button
					type="button"
					variant="outline"
					size="sm"
					data-testid="prop-layout-wrap"
					onClick={() => wrapSelectionInAutoLayoutImpl(ctx)}
				>
					{t("canvas.inspector.layoutWrap", "Wrap in auto layout")}
				</Button>
			) : null}
			{frames && direction && gap && primaryAlign && crossAlign ? (
				<>
					<FieldRow label={t("canvas.inspector.layoutDirection", "Direction")}>
						<div className="flex gap-1">
							{(["horizontal", "vertical"] as const).map((dir) => {
								const label =
									dir === "horizontal"
										? t("canvas.inspector.layoutHorizontal", "Horizontal")
										: t("canvas.inspector.layoutVertical", "Vertical");
								const active = !direction.mixed && direction.value === dir;
								return (
									<Button
										key={dir}
										type="button"
										variant={active ? "default" : "outline"}
										size="sm"
										aria-pressed={active}
										aria-label={label}
										title={label}
										data-testid={`prop-layout-direction-${dir}`}
										onClick={() =>
											commitLayoutAll((f) => ({
												...layoutOf(f),
												direction: dir,
											}))
										}
									>
										{label}
									</Button>
								);
							})}
						</div>
					</FieldRow>
					<NumberField
						label={t("canvas.inspector.layoutGap", "Gap")}
						value={gap.value ?? 0}
						mixed={gap.mixed}
						min={0}
						dataTestId="prop-layout-gap"
						contract={{
							nodes: frames,
							buildPatch: (n, v) => ({
								autoLayout: { ...layoutOf(n), gap: v },
							}),
							buildCommand: (n, v) => ({
								type: "frame.set-layout",
								nodeId: n.id,
								layout: { ...layoutOf(n), gap: v },
							}),
						}}
					/>
					<FieldRow label={t("canvas.inspector.layoutPadding", "Padding")}>
						<Button
							type="button"
							variant="outline"
							size="icon-sm"
							aria-pressed={paddingLinked}
							aria-label={t(
								"canvas.inspector.layoutPaddingLinked",
								"Link padding sides",
							)}
							title={t(
								"canvas.inspector.layoutPaddingLinked",
								"Link padding sides",
							)}
							data-testid="prop-layout-padding-link"
							onClick={() => setPaddingLinked((v) => !v)}
						>
							{paddingLinked ? (
								<Link2 aria-hidden className="size-3.5" />
							) : (
								<Unlink aria-hidden className="size-3.5" />
							)}
						</Button>
					</FieldRow>
					{paddingLinked ? (
						<NumberField
							label={t("canvas.inspector.layoutPadding", "Padding")}
							value={
								sharedFieldValue(frames, (n) => layoutOf(n).padding.top)
									.value ?? 0
							}
							mixed={
								sharedFieldValue(frames, (n) => {
									const p = layoutOf(n).padding;
									return p.top === p.right &&
										p.top === p.bottom &&
										p.top === p.left
										? p.top
										: Number.NaN;
								}).mixed
							}
							min={0}
							dataTestId="prop-layout-padding"
							contract={{
								nodes: frames,
								buildPatch: (n, v) => ({
									autoLayout: {
										...layoutOf(n),
										padding: { top: v, right: v, bottom: v, left: v },
									},
								}),
								buildCommand: (n, v) => ({
									type: "frame.set-layout",
									nodeId: n.id,
									layout: {
										...layoutOf(n),
										padding: { top: v, right: v, bottom: v, left: v },
									},
								}),
							}}
						/>
					) : (
						(["top", "right", "bottom", "left"] as const).map((side) => {
							const sideLabel = {
								top: t("canvas.inspector.layoutPaddingTop", "Top"),
								right: t("canvas.inspector.layoutPaddingRight", "Right"),
								bottom: t("canvas.inspector.layoutPaddingBottom", "Bottom"),
								left: t("canvas.inspector.layoutPaddingLeft", "Left"),
							}[side];
							const sideValue = sharedFieldValue(
								frames,
								(n) => layoutOf(n).padding[side],
							);
							return (
								<NumberField
									key={side}
									label={sideLabel}
									value={sideValue.value ?? 0}
									mixed={sideValue.mixed}
									min={0}
									dataTestId={`prop-layout-padding-${side}`}
									contract={{
										nodes: frames,
										buildPatch: (n, v) => ({
											autoLayout: {
												...layoutOf(n),
												padding: { ...layoutOf(n).padding, [side]: v },
											},
										}),
										buildCommand: (n, v) => ({
											type: "frame.set-layout",
											nodeId: n.id,
											layout: {
												...layoutOf(n),
												padding: { ...layoutOf(n).padding, [side]: v },
											},
										}),
									}}
								/>
							);
						})
					)}
					<FieldRow label={t("canvas.inspector.layoutAlign", "Align")}>
						<div
							className="grid w-fit grid-cols-3 gap-1"
							role="group"
							aria-label={t("canvas.inspector.layoutAlign", "Align")}
						>
							{ALIGNS.map((cross) =>
								ALIGNS.map((primary) => {
									const active =
										!primaryAlign.mixed &&
										!crossAlign.mixed &&
										primaryAlign.value === primary &&
										crossAlign.value === cross;
									const cellDisabled =
										primaryDisabled &&
										!primaryAlign.mixed &&
										primary !== primaryAlign.value;
									const label = `${alignLabel(t, primary)} / ${alignLabel(t, cross)}`;
									return (
										<Button
											key={`${primary}-${cross}`}
											type="button"
											variant={active ? "default" : "outline"}
											size="icon-sm"
											aria-pressed={active}
											aria-label={label}
											title={cellDisabled ? primaryDisabledTitle : label}
											disabled={cellDisabled}
											data-testid={`prop-layout-align-${primary}-${cross}`}
											onClick={() =>
												commitLayoutAll((f) => ({
													...layoutOf(f),
													...(primaryDisabled ? {} : { primaryAlign: primary }),
													crossAlign: cross,
												}))
											}
										>
											<span
												aria-hidden
												className="block size-1.5 rounded-full bg-current"
											/>
										</Button>
									);
								}),
							)}
						</div>
					</FieldRow>
				</>
			) : null}
			{itemEligible ? (
				<>
					{sameParent ? (
						<FieldRow
							label={t("canvas.inspector.layoutPositioning", "Position")}
						>
							<div className="flex gap-1">
								{(["flow", "absolute"] as const).map((mode) => {
									const label =
										mode === "flow"
											? t("canvas.inspector.layoutFlow", "In flow")
											: t("canvas.inspector.layoutAbsolute", "Absolute");
									const active =
										!positioning.mixed && positioning.value === mode;
									return (
										<Button
											key={mode}
											type="button"
											variant={active ? "default" : "outline"}
											size="sm"
											aria-pressed={active}
											aria-label={label}
											title={label}
											data-testid={`prop-layout-positioning-${mode}`}
											onClick={() => commitPositioningAll(mode)}
										>
											{label}
										</Button>
									);
								})}
							</div>
						</FieldRow>
					) : null}
					<SizingField nodes={nodes} axis="width" includeFill t={t} />
					<SizingField nodes={nodes} axis="height" includeFill t={t} />
				</>
			) : frames ? (
				<>
					<SizingField nodes={nodes} axis="width" includeFill={false} t={t} />
					<SizingField nodes={nodes} axis="height" includeFill={false} t={t} />
				</>
			) : null}
			{showRemove ? (
				<Button
					type="button"
					variant="outline"
					size="sm"
					data-testid="prop-layout-remove"
					onClick={() => removeAutoLayoutFromSelectionImpl(ctx)}
				>
					{t("canvas.inspector.layoutRemove", "Remove auto layout")}
				</Button>
			) : null}
		</Section>
	);
}
