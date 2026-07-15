"use client";

import type { CanvasFrameNode, CanvasImageNode } from "@anvilkit/canvas-core";
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

/**
 * Image / frame inspector sections (M0-07 split from `PropertyInspector.tsx`,
 * verbatim). Dispatch lives in `./type-sections.tsx`.
 */

export function renderImageFields(
	node: CanvasImageNode,
	commitPatch: CommitPatch,
	ctx: CanvasStudioContextValue,
	t: CanvasT,
): React.JSX.Element {
	const crop = node.crop;
	const c = crop ?? { x: 0, y: 0, width: 0, height: 0 };
	const setCrop = (patch: Partial<typeof c>) =>
		commitPatch(node, { crop: { ...c, ...patch } });
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
					onCommit={(v) => setCrop({ x: v })}
				/>
				<NumberField
					label={t("canvas.inspector.cropY", "Crop Y")}
					value={c.y}
					min={0}
					dataTestId="prop-crop-y"
					onCommit={(v) => setCrop({ y: v })}
				/>
				<NumberField
					label={t("canvas.inspector.cropW", "Crop W")}
					value={c.width}
					min={0}
					dataTestId="prop-crop-width"
					onCommit={(v) => setCrop({ width: v })}
				/>
				<NumberField
					label={t("canvas.inspector.cropH", "Crop H")}
					value={c.height}
					min={0}
					dataTestId="prop-crop-height"
					onCommit={(v) => setCrop({ height: v })}
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
		</>
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
				onCommit={(v) => commitPatch(node, { radius: v })}
			/>
			<FillAndShadowFields
				node={node}
				fill={node.background}
				fillKey="background"
				showShadow={false}
				shadow={undefined}
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
