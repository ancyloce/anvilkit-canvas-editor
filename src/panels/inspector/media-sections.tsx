"use client";

import {
	CANVAS_IMAGE_ADJUSTMENT_PRESETS,
	type CanvasFrameNode,
	type CanvasImageAdjustmentPresetId,
	type CanvasImageAdjustments,
	type CanvasImageFitMode,
	type CanvasImageNode,
} from "@anvilkit/canvas-core";
import { Button } from "@anvilkit/ui/button";
import { Switch } from "@anvilkit/ui/components/animate-ui/components/base/switch";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@anvilkit/ui/select";
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
import { type CommitPatch, FieldRow, NumberField, Section } from "../fields.js";
import { FillAndShadowFields } from "../fill-shadow-fields.js";
import { CornerRadiiFields } from "./stroke-section.js";

/**
 * Image / frame inspector sections (M0-07 split from `PropertyInspector.tsx`).
 * Dispatch lives in `./type-sections.tsx`.
 */

/** FR-094 image fit modes (B-02); `stretch` is the schema default. */
const FIT_MODES: readonly CanvasImageFitMode[] = [
	"stretch",
	"fill",
	"fit",
	"original",
	"center",
];

export function renderImageFields(
	node: CanvasImageNode,
	commitPatch: CommitPatch,
	ctx: CanvasStudioContextValue,
	t: CanvasT,
): React.JSX.Element {
	const crop = node.crop;
	const c = crop ?? { x: 0, y: 0, width: 0, height: 0 };
	const cropPatch = (patch: Partial<typeof c>) => ({
		crop: { ...c, ...patch },
	});
	return (
		<>
			<Section title={t("canvas.inspector.image", "Image")}>
				<FieldRow label={t("canvas.inspector.asset", "Asset")}>
					<span
						data-testid="prop-asset-id"
						className="truncate text-xs text-foreground"
					>
						{node.assetId}
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
						items={FIT_MODES.map((m) => ({ value: m, label: m }))}
						value={node.fitMode ?? "stretch"}
						onValueChange={(next) =>
							next &&
							commitPatch(node, {
								fitMode:
									next === "stretch" ? undefined : (next as CanvasImageFitMode),
							})
						}
					>
						<SelectTrigger data-testid="prop-fit-mode" className="h-7.5 flex-1">
							<SelectValue />
						</SelectTrigger>
						<SelectContent>
							{FIT_MODES.map((m) => (
								<SelectItem key={m} value={m}>
									{m}
								</SelectItem>
							))}
						</SelectContent>
					</Select>
				</FieldRow>
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
					value={c.x}
					min={0}
					dataTestId="prop-crop-x"
					contract={{
						nodes: [node],
						buildPatch: (_n, v) => cropPatch({ x: v }),
					}}
				/>
				<NumberField
					label={t("canvas.inspector.cropY", "Crop Y")}
					value={c.y}
					min={0}
					dataTestId="prop-crop-y"
					contract={{
						nodes: [node],
						buildPatch: (_n, v) => cropPatch({ y: v }),
					}}
				/>
				<NumberField
					label={t("canvas.inspector.cropW", "Crop W")}
					value={c.width}
					min={0}
					dataTestId="prop-crop-width"
					contract={{
						nodes: [node],
						buildPatch: (_n, v) => cropPatch({ width: v }),
					}}
				/>
				<NumberField
					label={t("canvas.inspector.cropH", "Crop H")}
					value={c.height}
					min={0}
					dataTestId="prop-crop-height"
					contract={{
						nodes: [node],
						buildPatch: (_n, v) => cropPatch({ height: v }),
					}}
				/>
				{crop ? (
					<Button
						type="button"
						variant="ghost"
						size="sm"
						className="w-full"
						data-testid="prop-crop-clear"
						onClick={() => commitPatch(node, { crop: undefined })}
					>
						{t("canvas.inspector.clearCrop", "Clear crop")}
					</Button>
				) : null}
			</Section>
			{renderAdjustmentFields(node, commitPatch, t)}
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
 * contract. Non-destructive — only `node.adjustments` ever changes.
 */
function renderAdjustmentFields(
	node: CanvasImageNode,
	commitPatch: CommitPatch,
	t: CanvasT,
): React.JSX.Element {
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
					items={presetIds.map((id) => ({ value: id, label: id }))}
					value={activePreset ?? ""}
					onValueChange={(next) => {
						if (!next) return;
						const preset =
							CANVAS_IMAGE_ADJUSTMENT_PRESETS[
								next as CanvasImageAdjustmentPresetId
							];
						commitPatch(node, {
							adjustments: normalizeAdjustments(preset),
						});
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
								{id}
							</SelectItem>
						))}
					</SelectContent>
				</Select>
			</FieldRow>
			{ADJUSTMENT_FIELDS.map((field) => (
				<NumberField
					key={field.key}
					label={t(field.labelKey, field.fallback)}
					value={adjustments[field.key] ?? 0}
					min={field.min}
					max={field.max}
					step={field.step}
					dataTestId={`prop-adjust-${field.key}`}
					contract={{
						nodes: [node],
						buildPatch: (_n, v) => ({
							adjustments: normalizeAdjustments({
								...adjustments,
								[field.key]: v,
							}),
						}),
					}}
				/>
			))}
		</Section>
	);
}

/**
 * A frame's own controls: clip toggle, corner radius, and background fill.
 *
 * The background reuses {@link FillAndShadowFields} through its `fillKey` seam —
 * a frame stores its fill under `background`, not `fill`, and has no `shadow`
 * field at all, so the shadow controls are hidden.
 */
export function renderFrameFields(
	node: CanvasFrameNode,
	commitPatch: CommitPatch,
	ctx: CanvasStudioContextValue,
	brandKit: BrandKit,
	t: CanvasT,
): React.JSX.Element {
	// Only an image WELL (a frame carrying a placeholder) gets image controls; a
	// plain frame is just a container and has no single image to replace.
	const well = isImageWell(node) ? wellImage(node) : undefined;
	const logos = brandKit.logos ?? [];
	return (
		<Section title={t("canvas.inspector.frame", "Frame")}>
			<FieldRow label={t("canvas.inspector.imageWell", "Image well")}>
				<Switch
					checked={isImageWell(node)}
					onCheckedChange={(checked) =>
						// Turning a well off is non-destructive: any image already inside
						// stays as an ordinary child of a now-plain frame.
						commitPatch(node, {
							placeholder: checked ? { kind: "image" } : undefined,
						})
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
									commitPatch(node, {
										placeholder: {
											...node.placeholder,
											kind: "logo",
											assetToken: {
												type: "brand-token",
												tokenType: "logo",
												id: next,
											},
										},
									});
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
					checked={node.clip ?? false}
					onCheckedChange={(checked) => commitPatch(node, { clip: checked })}
					aria-label={t("canvas.inspector.clip", "Clip")}
					data-testid="prop-frame-clip"
				/>
			</FieldRow>
			<NumberField
				label={t("canvas.inspector.radius", "Radius")}
				value={node.radius ?? 0}
				min={0}
				dataTestId="prop-frame-radius"
				contract={{
					nodes: [node],
					buildPatch: (_n, v) => ({ radius: v, cornerRadii: undefined }),
				}}
			/>
			<CornerRadiiFields node={node} t={t} />
			<FillAndShadowFields
				node={node}
				fill={node.background}
				fillKey="background"
				showShadow={false}
				commitPatch={commitPatch}
				t={t}
			/>
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
