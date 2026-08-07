"use client";

import {
	CANVAS_IMAGE_ADJUSTMENT_PRESETS,
	type CanvasAudioNode,
	type CanvasFrameNode,
	type CanvasFrameShape,
	type CanvasImageAdjustmentPresetId,
	type CanvasImageAdjustments,
	type CanvasImageFitMode,
	type CanvasImageNode,
	type CanvasVideoNode,
	resolveFrameClipShape,
} from "@anvilkit/canvas-core";
import { Badge } from "@anvilkit/ui/badge";
import { Button } from "@anvilkit/ui/button";
import { Switch } from "@anvilkit/ui/components/animate-ui/components/base/switch";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@anvilkit/ui/select";
// Required binding: every `.tsx` under this package carries it (see
// `brand-warnings.tsx`) so a classic-JSX build cannot throw "React is not
// defined" from `dist` — typecheck does not catch that.
import * as React from "react";
import type { BrandKit } from "../../brand/brand-kit.js";
import type {
	CanvasStudioContextValue,
	CanvasT,
} from "../../context/canvas-studio-context.js";
import { beginCrop } from "../../selection/crop-actions.js";
import {
	isImageWell,
	pickAndReplaceImage,
	replaceFrameImage,
	resetFrameCrop,
	wellImage,
} from "../../selection/frame-image-actions.js";
import {
	commitFrameShapeChoice,
	FRAME_SHAPE_CHOICES,
	type FrameShapeChoice,
	frameShapeChoice,
} from "../../selection/frame-shape-actions.js";
import {
	type CommitPatchAll,
	FieldRow,
	NumberField,
	Section,
	sharedFieldValue,
	TextField,
} from "../fields.js";
import { FillAndShadowFields } from "../fill-shadow-fields.js";
import { CornerRadiiFields } from "./stroke-section.js";

/**
 * Image / frame / video / audio inspector sections (M0-07 split from
 * `PropertyInspector.tsx`). Dispatch lives in `./type-sections.tsx`.
 *
 * FR-070 (B-12 multi-kind sections): `nodes` is the whole same-kind
 * selection. Continuous fields (crop rect, adjustments, radius) and discrete
 * pickers (fit mode, adjustment preset, well/clip switches, brand logo) patch
 * every node in ONE batch; asset-replace/crop-begin/reset-crop stay
 * single-node interactive workflows (an async picker, an on-stage editing
 * mode) and act on the FIRST selected node, same as `path`'s "Edit points".
 */

/** FR-094 image fit modes (B-02); `stretch` is the schema default. Exported
 * so the FR-180 selection toolbar shares this exact option set instead of
 * keeping its own copy (AC-014: two lists risk drifting apart). */
export const FIT_MODES: readonly CanvasImageFitMode[] = [
	"stretch",
	"fill",
	"fit",
	"original",
	"center",
];

/** AC-014: fit-mode labels are translated, not the raw enum id (same
 * key/fallback-tuple convention as `PageSettingsDialog`'s `MODE_LABELS`). */
export const FIT_MODE_LABELS: Record<CanvasImageFitMode, [string, string]> = {
	stretch: ["canvas.inspector.fitModeStretch", "Stretch"],
	fill: ["canvas.inspector.fitModeFill", "Fill"],
	fit: ["canvas.inspector.fitModeFit", "Fit"],
	original: ["canvas.inspector.fitModeOriginal", "Original"],
	center: ["canvas.inspector.fitModeCenter", "Center"],
};

/** AC-014: adjustment-preset labels are translated, not the raw preset id. */
export const ADJUST_PRESET_LABELS: Record<
	CanvasImageAdjustmentPresetId,
	[string, string]
> = {
	original: ["canvas.inspector.adjustPresetOriginal", "Original"],
	warm: ["canvas.inspector.adjustPresetWarm", "Warm"],
	cool: ["canvas.inspector.adjustPresetCool", "Cool"],
	mono: ["canvas.inspector.adjustPresetMono", "Mono"],
	vintage: ["canvas.inspector.adjustPresetVintage", "Vintage"],
	"high-contrast": [
		"canvas.inspector.adjustPresetHighContrast",
		"High contrast",
	],
};

export function renderImageFields(
	nodes: readonly CanvasImageNode[],
	ctx: CanvasStudioContextValue,
	commitPatchAll: CommitPatchAll,
	t: CanvasT,
): React.JSX.Element {
	const node = nodes[0] as CanvasImageNode;
	const assetId = sharedFieldValue(
		nodes,
		(n) => (n as CanvasImageNode).assetId,
	);
	const fitMode = sharedFieldValue(
		nodes,
		(n) => (n as CanvasImageNode).fitMode ?? "stretch",
	);
	const alt = sharedFieldValue(nodes, (n) => (n as CanvasImageNode).alt ?? "");
	const cropOf = (n: CanvasImageNode) =>
		n.crop ?? { x: 0, y: 0, width: 0, height: 0 };
	const cropX = sharedFieldValue(nodes, (n) => cropOf(n as CanvasImageNode).x);
	const cropY = sharedFieldValue(nodes, (n) => cropOf(n as CanvasImageNode).y);
	const cropW = sharedFieldValue(
		nodes,
		(n) => cropOf(n as CanvasImageNode).width,
	);
	const cropH = sharedFieldValue(
		nodes,
		(n) => cropOf(n as CanvasImageNode).height,
	);
	const anyCrop = nodes.some((n) => (n as CanvasImageNode).crop);
	return (
		<>
			<Section title={t("canvas.inspector.image", "Image")}>
				<FieldRow label={t("canvas.inspector.asset", "Asset")}>
					<span
						data-testid="prop-asset-id"
						className="truncate text-xs text-foreground"
					>
						{assetId.mixed
							? t("canvas.inspector.mixed", "Mixed")
							: assetId.value}
					</span>
				</FieldRow>
				<Button
					type="button"
					variant="outline"
					size="sm"
					className="w-full"
					data-testid="prop-image-replace"
					onClick={() => {
						void pickAndReplaceImage(ctx, node);
					}}
				>
					{t("canvas.inspector.replaceImage", "Replace image")}
				</Button>
				<FieldRow label={t("canvas.inspector.fitMode", "Fit")}>
					<Select
						items={FIT_MODES.map((m) => ({
							value: m,
							label: t(...FIT_MODE_LABELS[m]),
						}))}
						value={fitMode.mixed ? undefined : fitMode.value}
						onValueChange={(next) =>
							next &&
							commitPatchAll(nodes, () => ({
								fitMode:
									next === "stretch" ? undefined : (next as CanvasImageFitMode),
							}))
						}
					>
						<SelectTrigger data-testid="prop-fit-mode" className="h-7.5 flex-1">
							<SelectValue
								placeholder={
									fitMode.mixed
										? t("canvas.inspector.mixed", "Mixed")
										: undefined
								}
							/>
						</SelectTrigger>
						<SelectContent>
							{FIT_MODES.map((m) => (
								<SelectItem key={m} value={m}>
									{t(...FIT_MODE_LABELS[m])}
								</SelectItem>
							))}
						</SelectContent>
					</Select>
				</FieldRow>
			</Section>
			<Section title={t("canvas.inspector.accessibility", "Accessibility")}>
				<TextField
					label={t("canvas.inspector.altText", "Alt text")}
					value={alt.value}
					mixed={alt.mixed}
					dataTestId="prop-image-alt"
					contract={{
						nodes,
						buildPatch: (_n, v) => ({
							alt: v.trim() === "" ? undefined : v,
						}),
					}}
				/>
			</Section>
			<Section title={t("canvas.inspector.crop", "Crop")}>
				<Button
					type="button"
					variant="outline"
					size="sm"
					className="w-full"
					data-testid="prop-crop-begin"
					onClick={() => beginCrop(ctx, node.id)}
				>
					{t("canvas.inspector.cropImage", "Crop image")}
				</Button>
				<NumberField
					label={t("canvas.inspector.cropX", "Crop X")}
					value={cropX.value}
					mixed={cropX.mixed}
					min={0}
					dataTestId="prop-crop-x"
					contract={{
						nodes,
						buildPatch: (n, v) => ({
							crop: { ...cropOf(n as CanvasImageNode), x: v },
						}),
					}}
				/>
				<NumberField
					label={t("canvas.inspector.cropY", "Crop Y")}
					value={cropY.value}
					mixed={cropY.mixed}
					min={0}
					dataTestId="prop-crop-y"
					contract={{
						nodes,
						buildPatch: (n, v) => ({
							crop: { ...cropOf(n as CanvasImageNode), y: v },
						}),
					}}
				/>
				<NumberField
					label={t("canvas.inspector.cropW", "Crop W")}
					value={cropW.value}
					mixed={cropW.mixed}
					min={0}
					dataTestId="prop-crop-width"
					contract={{
						nodes,
						buildPatch: (n, v) => ({
							crop: { ...cropOf(n as CanvasImageNode), width: v },
						}),
					}}
				/>
				<NumberField
					label={t("canvas.inspector.cropH", "Crop H")}
					value={cropH.value}
					mixed={cropH.mixed}
					min={0}
					dataTestId="prop-crop-height"
					contract={{
						nodes,
						buildPatch: (n, v) => ({
							crop: { ...cropOf(n as CanvasImageNode), height: v },
						}),
					}}
				/>
				{anyCrop ? (
					<Button
						type="button"
						variant="ghost"
						size="sm"
						className="w-full"
						data-testid="prop-crop-clear"
						onClick={() => commitPatchAll(nodes, () => ({ crop: undefined }))}
					>
						{t("canvas.inspector.clearCrop", "Clear crop")}
					</Button>
				) : null}
			</Section>
			{renderAdjustmentFields(nodes, commitPatchAll, t)}
		</>
	);
}

/** The 9 FR-100 adjustments, in pipeline order, with their UI ranges. */
const ADJUSTMENT_FIELDS: ReadonlyArray<{
	key: keyof CanvasImageAdjustments;
	labelKey: string;
	fallback: string;
	min: number;
	max: number;
	step: number;
}> = [
	{
		key: "exposure",
		labelKey: "canvas.inspector.adjustExposure",
		fallback: "Exposure",
		min: -1,
		max: 1,
		step: 0.05,
	},
	{
		key: "brightness",
		labelKey: "canvas.inspector.adjustBrightness",
		fallback: "Brightness",
		min: -1,
		max: 1,
		step: 0.05,
	},
	{
		key: "contrast",
		labelKey: "canvas.inspector.adjustContrast",
		fallback: "Contrast",
		min: -1,
		max: 1,
		step: 0.05,
	},
	{
		key: "saturation",
		labelKey: "canvas.inspector.adjustSaturation",
		fallback: "Saturation",
		min: -1,
		max: 1,
		step: 0.05,
	},
	{
		key: "temperature",
		labelKey: "canvas.inspector.adjustTemperature",
		fallback: "Temperature",
		min: -1,
		max: 1,
		step: 0.05,
	},
	{
		key: "tint",
		labelKey: "canvas.inspector.adjustTint",
		fallback: "Tint",
		min: -1,
		max: 1,
		step: 0.05,
	},
	{
		key: "grayscale",
		labelKey: "canvas.inspector.adjustGrayscale",
		fallback: "Grayscale",
		min: 0,
		max: 1,
		step: 0.05,
	},
	{
		key: "sepia",
		labelKey: "canvas.inspector.adjustSepia",
		fallback: "Sepia",
		min: 0,
		max: 1,
		step: 0.05,
	},
	{
		key: "blur",
		labelKey: "canvas.inspector.adjustBlur",
		fallback: "Blur",
		min: 0,
		max: 100,
		step: 1,
	},
];

/** Neutral entries are stripped so "all zeros" round-trips to no field at all. */
function normalizeAdjustments(
	adjustments: CanvasImageAdjustments,
): CanvasImageAdjustments | undefined {
	const entries = Object.entries(adjustments).filter(
		([, v]) => typeof v === "number" && v !== 0,
	);
	return entries.length > 0 ? Object.fromEntries(entries) : undefined;
}

/**
 * FR-100/101 adjustments section (C-04): preset picker (plain adjustment
 * values, replace-on-apply) + one field per adjustment through the §10 field
 * contract. Non-destructive — only `node.adjustments` ever changes. Exported
 * for reuse by the FR-180 selection toolbar's Adjust popover (single source
 * of the adjustment UI for both the inspector and the toolbar).
 */
export function renderAdjustmentFields(
	nodes: readonly CanvasImageNode[],
	commitPatchAll: CommitPatchAll,
	t: CanvasT,
): React.JSX.Element {
	const node = nodes[0] as CanvasImageNode;
	const adjustments = node.adjustments ?? {};
	const presetIds = Object.keys(
		CANVAS_IMAGE_ADJUSTMENT_PRESETS,
	) as CanvasImageAdjustmentPresetId[];
	const activePreset = presetIds.find((id) => {
		const preset = CANVAS_IMAGE_ADJUSTMENT_PRESETS[id];
		const a = normalizeAdjustments(adjustments);
		const p = normalizeAdjustments(preset);
		return JSON.stringify(a ?? {}) === JSON.stringify(p ?? {});
	});
	return (
		<Section title={t("canvas.inspector.adjustments", "Adjustments")}>
			<FieldRow label={t("canvas.inspector.adjustPreset", "Preset")}>
				<Select
					items={presetIds.map((id) => ({
						value: id,
						label: t(...ADJUST_PRESET_LABELS[id]),
					}))}
					value={activePreset ?? ""}
					onValueChange={(next) => {
						if (!next) return;
						const preset =
							CANVAS_IMAGE_ADJUSTMENT_PRESETS[
								next as CanvasImageAdjustmentPresetId
							];
						commitPatchAll(nodes, () => ({
							adjustments: normalizeAdjustments(preset),
						}));
					}}
				>
					<SelectTrigger
						data-testid="prop-adjust-preset"
						className="h-7.5 flex-1"
					>
						<SelectValue
							placeholder={t("canvas.inspector.adjustCustom", "Custom")}
						/>
					</SelectTrigger>
					<SelectContent>
						{presetIds.map((id) => (
							<SelectItem key={id} value={id}>
								{t(...ADJUST_PRESET_LABELS[id])}
							</SelectItem>
						))}
					</SelectContent>
				</Select>
			</FieldRow>
			{ADJUSTMENT_FIELDS.map((field) => {
				const shared = sharedFieldValue(
					nodes,
					(n) => (n as CanvasImageNode).adjustments?.[field.key] ?? 0,
				);
				return (
					<NumberField
						key={field.key}
						label={t(field.labelKey, field.fallback)}
						value={shared.value}
						mixed={shared.mixed}
						min={field.min}
						max={field.max}
						step={field.step}
						dataTestId={`prop-adjust-${field.key}`}
						contract={{
							nodes,
							buildPatch: (n, v) => ({
								adjustments: normalizeAdjustments({
									...(n as CanvasImageNode).adjustments,
									[field.key]: v,
								}),
							}),
						}}
					/>
				);
			})}
		</Section>
	);
}

/** cp4-004: the Shape picker's option labels. Translated, never the raw kind. */
export const FRAME_SHAPE_LABELS: Record<FrameShapeChoice, [string, string]> = {
	none: ["canvas.inspector.frameShapeNone", "None"],
	rect: ["canvas.inspector.frameShapeRect", "Rectangle"],
	ellipse: ["canvas.inspector.frameShapeEllipse", "Ellipse"],
	polygon: ["canvas.inspector.frameShapePolygon", "Polygon"],
	star: ["canvas.inspector.frameShapeStar", "Star"],
	path: ["canvas.inspector.frameShapePath", "Custom path"],
};

/**
 * cp4-004 — the frame's clip GEOMETRY (ADR 0008 decision 2): pick one of the
 * five `CanvasFrameShape` kinds, tune its parameters, or release it back to the
 * rectangle every frame clipped to before shapes existed.
 *
 * Reads core's ONE resolver ({@link resolveFrameClipShape}) rather than
 * re-deriving the rules, so this control, the Konva `clipFunc` (cp4-003) and the
 * SVG `<clipPath>` (cp4-002) can never disagree. That is also why the status
 * note exists: the resolver knows a shape is inert (`clip` off) or degraded
 * (a kind this build cannot draw), and the only way a user finds out is if the
 * inspector says so.
 *
 * Apply/release commit through {@link commitFrameShapeChoice} rather than
 * `commitPatchAll`, because applying is more than one node.update — it turns
 * `clip` on, and can restore a well image that would otherwise not be visible —
 * and all of it must land as ONE undo step.
 */
function renderFrameShapeFields(
	nodes: readonly CanvasFrameNode[],
	ctx: CanvasStudioContextValue,
	t: CanvasT,
): React.JSX.Element {
	const node = nodes[0] as CanvasFrameNode;
	const resolved = resolveFrameClipShape(node);
	const choice = frameShapeChoice(node);
	const shape = node.shape;
	const mixed = nodes.some((n) => frameShapeChoice(n) !== choice);
	const note =
		resolved.source === "degraded"
			? t(
					"canvas.inspector.frameShapeDegraded",
					"This build cannot draw that shape, so the frame clips to its rectangle.",
				)
			: shape !== undefined && !resolved.clipped
				? t(
						"canvas.inspector.frameShapeInert",
						"Turn Clip on for this shape to take effect.",
					)
				: undefined;
	return (
		<>
			<FieldRow label={t("canvas.inspector.frameShape", "Shape")}>
				<Select
					items={FRAME_SHAPE_CHOICES.map((c) => ({
						value: c,
						label: t(...FRAME_SHAPE_LABELS[c]),
					}))}
					value={mixed || choice === undefined ? undefined : choice}
					onValueChange={(next) => {
						if (!next) return;
						commitFrameShapeChoice(ctx, nodes, next as FrameShapeChoice);
					}}
				>
					<SelectTrigger
						data-testid="prop-frame-shape"
						className="h-7.5 flex-1"
					>
						<SelectValue
							placeholder={
								mixed ? t("canvas.inspector.mixed", "Mixed") : undefined
							}
						/>
					</SelectTrigger>
					<SelectContent>
						{FRAME_SHAPE_CHOICES.map((c) => (
							<SelectItem key={c} value={c}>
								{t(...FRAME_SHAPE_LABELS[c])}
							</SelectItem>
						))}
					</SelectContent>
				</Select>
			</FieldRow>
			{renderFrameShapeParams(nodes, shape, t)}
			{shape !== undefined ? (
				<Button
					type="button"
					variant="ghost"
					size="sm"
					className="w-full"
					data-testid="prop-frame-shape-release"
					onClick={() => commitFrameShapeChoice(ctx, nodes, "none")}
				>
					{t("canvas.inspector.frameShapeRelease", "Release shape")}
				</Button>
			) : null}
			{note ? (
				<p
					data-testid="prop-frame-shape-note"
					role="note"
					className="text-[0.7rem] leading-snug text-muted-foreground"
				>
					{note}
				</p>
			) : null}
		</>
	);
}

/**
 * The parameter fields the SELECTED kind owns — nothing for `rect`/`ellipse`,
 * which are fully described by the frame's box (and, for `rect`, by the Radius
 * and per-corner fields already below).
 *
 * Each field patches the whole `shape` object rather than one property, because
 * `CanvasFrameShape` is a closed discriminated union: a patch carrying only
 * `sides` would not type-check and would not survive a schema parse.
 */
function renderFrameShapeParams(
	nodes: readonly CanvasFrameNode[],
	shape: CanvasFrameShape | undefined,
	t: CanvasT,
): React.JSX.Element | null {
	if (shape?.kind === "polygon") {
		return (
			<NumberField
				label={t("canvas.inspector.frameShapeSides", "Sides")}
				value={shape.sides}
				min={3}
				step={1}
				dataTestId="prop-frame-shape-sides"
				contract={{
					nodes,
					buildPatch: (_n, v) => ({
						shape: { kind: "polygon", sides: Math.max(3, Math.round(v)) },
					}),
				}}
			/>
		);
	}
	if (shape?.kind === "star") {
		return (
			<>
				<NumberField
					label={t("canvas.inspector.frameShapePoints", "Points")}
					value={shape.points}
					min={3}
					step={1}
					dataTestId="prop-frame-shape-points"
					contract={{
						nodes,
						buildPatch: (_n, v) => ({
							shape: {
								kind: "star",
								points: Math.max(3, Math.round(v)),
								innerRadiusRatio: shape.innerRadiusRatio,
							},
						}),
					}}
				/>
				<NumberField
					label={t("canvas.inspector.frameShapeInnerRatio", "Inner radius")}
					value={shape.innerRadiusRatio}
					min={0}
					max={1}
					step={0.05}
					dataTestId="prop-frame-shape-inner-ratio"
					contract={{
						nodes,
						buildPatch: (_n, v) => ({
							shape: {
								kind: "star",
								points: shape.points,
								innerRadiusRatio: Math.min(1, Math.max(0, v)),
							},
						}),
					}}
				/>
			</>
		);
	}
	if (shape?.kind === "path") {
		return (
			<TextField
				label={t("canvas.inspector.frameShapePathData", "Path data")}
				value={shape.d}
				dataTestId="prop-frame-shape-path"
				contract={{
					nodes,
					buildPatch: (_n, v) => ({ shape: { kind: "path", d: v } }),
				}}
			/>
		);
	}
	return null;
}

/**
 * A frame's own controls: clip toggle, clip shape, corner radius, and
 * background fill.
 *
 * The background reuses {@link FillAndShadowFields} through its `fillKey` seam —
 * a frame stores its fill under `background`, not `fill`, and has no `shadow`
 * field at all, so the shadow controls are hidden.
 */
export function renderFrameFields(
	nodes: readonly CanvasFrameNode[],
	ctx: CanvasStudioContextValue,
	commitPatchAll: CommitPatchAll,
	brandKit: BrandKit,
	t: CanvasT,
): React.JSX.Element {
	const node = nodes[0] as CanvasFrameNode;
	// Only an image WELL (a frame carrying a placeholder) gets image controls; a
	// plain frame is just a container and has no single image to replace. For a
	// multi-selection, the FIRST node's well status gates the well-only UI —
	// mirrors every other kind-specific section's "representative node" choice.
	const well = isImageWell(node) ? wellImage(node) : undefined;
	const logos = brandKit.logos ?? [];
	const radius = sharedFieldValue(
		nodes,
		(n) => (n as CanvasFrameNode).radius ?? 0,
	);
	const clip = sharedFieldValue(
		nodes,
		(n) => (n as CanvasFrameNode).clip ?? false,
	);
	const children = sharedFieldValue(
		nodes,
		(n) => (n as CanvasFrameNode).children.length,
	);
	return (
		<Section title={t("canvas.inspector.frame", "Frame")}>
			<FieldRow label={t("canvas.inspector.imageWell", "Image well")}>
				<Switch
					checked={isImageWell(node)}
					onCheckedChange={(checked) =>
						// Turning a well off is non-destructive: any image already inside
						// stays as an ordinary child of a now-plain frame.
						commitPatchAll(nodes, () => ({
							placeholder: checked ? { kind: "image" } : undefined,
						}))
					}
					aria-label={t("canvas.inspector.imageWell", "Image well")}
					data-testid="prop-frame-well"
				/>
			</FieldRow>
			{isImageWell(node) ? (
				<>
					<Button
						type="button"
						variant="outline"
						size="sm"
						className="w-full"
						data-testid="prop-frame-replace"
						onClick={() => {
							void replaceFrameImage(ctx, node);
						}}
					>
						{well
							? t("canvas.inspector.replaceImage", "Replace image")
							: t("canvas.inspector.addImage", "Add image")}
					</Button>
					{well ? (
						<Button
							type="button"
							variant="outline"
							size="sm"
							className="w-full"
							data-testid="prop-frame-reposition"
							// cp4-004: the discoverable twin of the double-click gesture.
							// Both go through `beginCrop` — moving a photo inside its
							// frame IS cropping, so there is one implementation.
							onClick={() => beginCrop(ctx, well.id)}
						>
							{t("canvas.inspector.repositionImage", "Reposition image")}
						</Button>
					) : null}
					{well?.crop ? (
						<Button
							type="button"
							variant="ghost"
							size="sm"
							className="w-full"
							data-testid="prop-frame-reset-crop"
							onClick={() => resetFrameCrop(ctx, node)}
						>
							{t("canvas.inspector.resetCrop", "Reset crop")}
						</Button>
					) : null}
					{logos.length > 0 ? (
						<FieldRow label={t("canvas.inspector.brandLogo", "Brand logo")}>
							<Select
								items={logos.map((logo) => ({
									value: logo.id,
									label: logo.name,
								}))}
								value={
									node.placeholder?.assetToken?.tokenType === "logo"
										? node.placeholder.assetToken.id
										: undefined
								}
								onValueChange={(next) => {
									if (!next) return;
									commitPatchAll(nodes, (n) => ({
										placeholder: {
											...(n as CanvasFrameNode).placeholder,
											kind: "logo",
											assetToken: {
												type: "brand-token",
												tokenType: "logo",
												id: next,
											},
										},
									}));
								}}
							>
								<SelectTrigger
									data-testid="prop-frame-logo"
									className="h-7.5 flex-1"
								>
									<SelectValue
										placeholder={t(
											"canvas.inspector.chooseBrandLogo",
											"Choose a brand logo",
										)}
									/>
								</SelectTrigger>
								<SelectContent>
									{logos.map((logo) => (
										<SelectItem key={logo.id} value={logo.id}>
											{logo.name}
										</SelectItem>
									))}
								</SelectContent>
							</Select>
						</FieldRow>
					) : null}
				</>
			) : null}
			<FieldRow label={t("canvas.inspector.clip", "Clip")}>
				<Switch
					checked={clip.value}
					onCheckedChange={(checked) =>
						commitPatchAll(nodes, () => ({ clip: checked }))
					}
					aria-label={t("canvas.inspector.clip", "Clip")}
					data-testid="prop-frame-clip"
				/>
			</FieldRow>
			{renderFrameShapeFields(nodes, ctx, t)}
			<NumberField
				label={t("canvas.inspector.radius", "Radius")}
				value={radius.value}
				mixed={radius.mixed}
				min={0}
				dataTestId="prop-frame-radius"
				contract={{
					nodes,
					buildPatch: (_n, v) => ({ radius: v, cornerRadii: undefined }),
				}}
			/>
			<CornerRadiiFields nodes={nodes} t={t} />
			<FillAndShadowFields
				nodes={nodes}
				fillKey="background"
				showShadow={false}
				commitPatchAll={commitPatchAll}
				t={t}
			/>
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

/**
 * cp0-002 — the honesty badge for `video` / `audio`, stated where a user meets
 * it rather than only in the docs.
 *
 * Both are real built-in kinds, and neither renders what its name promises:
 * `CanvasVideoNodeRenderer` paints the poster asset and nothing else,
 * `CanvasAudioNodeRenderer` paints an editor-only placeholder and returns
 * `null` outside the live editor, and core's emitters agree —
 * `emitVideo` warns `VIDEO_UNSUPPORTED` and emits the poster at most,
 * `emitAudio` warns `AUDIO_UNSUPPORTED` and emits nothing. `CanvasAnimation`
 * is metadata-only by contract: nothing plays it and no exporter reads it.
 *
 * Until this section existed both kinds fell through the `type-sections.tsx`
 * switch to the EXTENSION `kindInspectors` lookup and therefore rendered no
 * kind-specific inspector at all, so the product said nothing about any of it.
 *
 * Deliberately STATIC: a badge and one sentence, no controls and no playback
 * affordance — anything interactive belongs to the deferred motion programme.
 * It renders in the inspector (plain DOM, `@anvilkit/ui` + Tailwind apply
 * normally) rather than as stage chrome, which is Konva shapes and could only
 * carry a hand-rolled badge.
 */
export function renderStaticMediaFields(
	nodes: ReadonlyArray<CanvasVideoNode | CanvasAudioNode>,
	t: CanvasT,
): React.JSX.Element {
	// `sharedKind` gates this branch, so the whole selection is one kind and the
	// first node speaks for all of them — same "representative node" choice the
	// other kind sections make.
	const audio = nodes[0]?.type === "audio";
	return (
		<Section title={t("canvas.inspector.media", "Media")}>
			<div
				data-testid="prop-media-static-badge"
				data-media-kind={audio ? "audio" : "video"}
				role="note"
				className="flex flex-col items-start gap-1.5 rounded-md bg-muted px-2.5 py-2"
			>
				<Badge variant="secondary">
					{t("canvas.inspector.mediaStaticBadge", "Static preview")}
				</Badge>
				<p className="text-[0.7rem] leading-snug text-muted-foreground">
					{audio
						? t(
								"canvas.inspector.mediaStaticAudio",
								"This build renders nothing for audio: the canvas shows an editor-only placeholder and every export omits it. The layer only keeps the asset reference.",
							)
						: t(
								"canvas.inspector.mediaStaticVideo",
								"This build renders the poster image only, on the canvas and in every export. There is no playback, and animation metadata is never played or exported.",
							)}
				</p>
			</div>
		</Section>
	);
}
