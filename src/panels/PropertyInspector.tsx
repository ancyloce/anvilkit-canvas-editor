"use client";

import {
	type CanvasEllipseNode,
	type CanvasFrameNode,
	type CanvasGroupNode,
	type CanvasImageNode,
	type CanvasLineNode,
	type CanvasNode,
	type CanvasPathNode,
	type CanvasPolygonNode,
	type CanvasRectNode,
	type CanvasRichTextNode,
	type CanvasStarNode,
	type CanvasTextAlign,
	type CanvasTextNode,
	findNode,
	type RichTextOverflow,
	type RichTextTransform,
	type RichTextWrap,
	resolveSpanStyle,
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
import { useSyncExternalStore } from "react";
import type { BrandKit } from "../brand/brand-kit.js";
import { EMPTY_BRAND_KIT } from "../brand/brand-kit.js";
import {
	resolveFillForDisplay,
	resolveFontFamilyForDisplay,
} from "../brand/resolve-brand-token.js";
import type {
	CanvasStudioContextValue,
	CanvasT,
} from "../context/canvas-studio-context.js";
import {
	useCanvasStudio,
	useCanvasT,
} from "../context/canvas-studio-context.js";
import { beginCrop } from "../selection/crop-actions.js";
import {
	isImageWell,
	pickAndReplaceImage,
	replaceFrameImage,
	resetFrameCrop,
	wellImage,
} from "../selection/frame-image-actions.js";
import { beginPathEdit } from "../selection/path-edit-actions.js";
import { DEFAULT_RICH_TEXT_STYLE } from "../text/rich-text-style.js";
import {
	ColorField,
	type CommitPatch,
	FieldRow,
	NumberField,
	Section,
	TextField,
	useCommitPatch,
} from "./fields.js";
import { FillAndShadowFields } from "./fill-shadow-fields.js";
import {
	TokenAwareColorField,
	TokenAwareFontField,
} from "./token-aware-fields.js";

export interface PropertyInspectorProps {
	id?: string;
}

export function PropertyInspector({
	id,
}: PropertyInspectorProps): React.JSX.Element {
	const ctx = useCanvasStudio();
	const selectedIds = useSyncExternalStore(
		ctx.selectionStore.subscribe,
		() => ctx.selectionStore.getState().selectedIds,
		() => ctx.selectionStore.getState().selectedIds,
	);
	const firstSelectedId = selectedIds[0];
	const found = firstSelectedId ? findNode(ctx.ir, firstSelectedId) : null;
	const node = found?.node ?? null;

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

function renderTypeSpecificFields(
	node: CanvasNode,
	commitPatch: CommitPatch,
	ctx: CanvasStudioContextValue,
	t: CanvasT,
): React.JSX.Element | null {
	switch (node.type) {
		case "rect":
			return renderRectFields(node, commitPatch, t);
		case "ellipse":
			return renderEllipseFields(node, commitPatch, t);
		case "polygon":
			return renderPolygonFields(node, commitPatch, t);
		case "star":
			return renderStarFields(node, commitPatch, t);
		case "line":
			return renderLineFields(node, commitPatch, t);
		case "text":
			return renderTextFields(
				node,
				commitPatch,
				ctx.brandKit ?? EMPTY_BRAND_KIT,
				t,
			);
		case "rich-text":
			return renderRichTextFields(
				node,
				commitPatch,
				ctx.brandKit ?? EMPTY_BRAND_KIT,
				t,
			);
		case "image":
			return renderImageFields(node, commitPatch, ctx, t);
		case "path":
			return renderPathFields(node, commitPatch, ctx, t);
		case "group":
			return renderGroupFields(node, t);
		case "frame":
			return renderFrameFields(
				node,
				commitPatch,
				ctx,
				ctx.brandKit ?? EMPTY_BRAND_KIT,
				t,
			);
		case "ai-placeholder":
			return null;
		default: {
			// Custom (extension) kind: render its registered inspector fields, if any.
			const custom = node as unknown as CanvasNode & { type: string };
			const inspector = ctx.kindInspectors?.[custom.type];
			return inspector ? inspector.render(custom, ctx.commit) : null;
		}
	}
}

function renderRectFields(
	node: CanvasRectNode,
	commitPatch: CommitPatch,
	t: CanvasT,
): React.JSX.Element {
	return (
		<Section title={t("canvas.inspector.shape", "Shape")}>
			<FillAndShadowFields
				node={node}
				fill={node.fill}
				shadow={node.shadow}
				commitPatch={commitPatch}
				t={t}
			/>
			<ColorField
				label={t("canvas.inspector.stroke", "Stroke")}
				value={node.stroke}
				dataTestId="prop-stroke"
				onCommit={(v) => commitPatch(node, { stroke: v })}
			/>
			<NumberField
				label={t("canvas.inspector.strokeWidth", "Stroke W")}
				value={node.strokeWidth ?? 0}
				min={0}
				dataTestId="prop-stroke-width"
				onCommit={(v) => commitPatch(node, { strokeWidth: v })}
			/>
			<NumberField
				label={t("canvas.inspector.radius", "Radius")}
				value={node.radius ?? 0}
				min={0}
				dataTestId="prop-radius"
				onCommit={(v) => commitPatch(node, { radius: v })}
			/>
		</Section>
	);
}

function renderEllipseFields(
	node: CanvasEllipseNode,
	commitPatch: CommitPatch,
	t: CanvasT,
): React.JSX.Element {
	return (
		<Section title={t("canvas.inspector.shape", "Shape")}>
			<FillAndShadowFields
				node={node}
				fill={node.fill}
				shadow={node.shadow}
				commitPatch={commitPatch}
				t={t}
			/>
			<ColorField
				label={t("canvas.inspector.stroke", "Stroke")}
				value={node.stroke}
				dataTestId="prop-stroke"
				onCommit={(v) => commitPatch(node, { stroke: v })}
			/>
			<NumberField
				label={t("canvas.inspector.strokeWidth", "Stroke W")}
				value={node.strokeWidth ?? 0}
				min={0}
				dataTestId="prop-stroke-width"
				onCommit={(v) => commitPatch(node, { strokeWidth: v })}
			/>
		</Section>
	);
}

function renderPolygonFields(
	node: CanvasPolygonNode,
	commitPatch: CommitPatch,
	t: CanvasT,
): React.JSX.Element {
	return (
		<Section title={t("canvas.inspector.shape", "Shape")}>
			<NumberField
				label={t("canvas.inspector.sides", "Sides")}
				value={node.sides}
				min={3}
				step={1}
				dataTestId="prop-polygon-sides"
				onCommit={(v) => commitPatch(node, { sides: Math.round(v) })}
			/>
			<FillAndShadowFields
				node={node}
				fill={node.fill}
				shadow={node.shadow}
				commitPatch={commitPatch}
				t={t}
			/>
			<ColorField
				label={t("canvas.inspector.stroke", "Stroke")}
				value={node.stroke}
				dataTestId="prop-stroke"
				onCommit={(v) => commitPatch(node, { stroke: v })}
			/>
			<NumberField
				label={t("canvas.inspector.strokeWidth", "Stroke W")}
				value={node.strokeWidth ?? 0}
				min={0}
				dataTestId="prop-stroke-width"
				onCommit={(v) => commitPatch(node, { strokeWidth: v })}
			/>
		</Section>
	);
}

function renderStarFields(
	node: CanvasStarNode,
	commitPatch: CommitPatch,
	t: CanvasT,
): React.JSX.Element {
	return (
		<Section title={t("canvas.inspector.shape", "Shape")}>
			<NumberField
				label={t("canvas.inspector.points", "Points")}
				value={node.points}
				min={3}
				step={1}
				dataTestId="prop-star-points"
				onCommit={(v) => commitPatch(node, { points: Math.round(v) })}
			/>
			<NumberField
				label={t("canvas.inspector.innerRadiusRatio", "Inner radius")}
				value={node.innerRadiusRatio}
				min={0}
				max={1}
				step={0.05}
				dataTestId="prop-star-inner-radius"
				onCommit={(v) => commitPatch(node, { innerRadiusRatio: v })}
			/>
			<FillAndShadowFields
				node={node}
				fill={node.fill}
				shadow={node.shadow}
				commitPatch={commitPatch}
				t={t}
			/>
			<ColorField
				label={t("canvas.inspector.stroke", "Stroke")}
				value={node.stroke}
				dataTestId="prop-stroke"
				onCommit={(v) => commitPatch(node, { stroke: v })}
			/>
			<NumberField
				label={t("canvas.inspector.strokeWidth", "Stroke W")}
				value={node.strokeWidth ?? 0}
				min={0}
				dataTestId="prop-stroke-width"
				onCommit={(v) => commitPatch(node, { strokeWidth: v })}
			/>
		</Section>
	);
}

function renderLineFields(
	node: CanvasLineNode,
	commitPatch: CommitPatch,
	t: CanvasT,
): React.JSX.Element {
	return (
		<Section title={t("canvas.inspector.line", "Line")}>
			<ColorField
				label={t("canvas.inspector.stroke", "Stroke")}
				value={node.stroke}
				dataTestId="prop-stroke"
				onCommit={(v) => commitPatch(node, { stroke: v })}
			/>
			<NumberField
				label={t("canvas.inspector.strokeWidth", "Stroke W")}
				value={node.strokeWidth ?? 1}
				min={0}
				dataTestId="prop-stroke-width"
				onCommit={(v) => commitPatch(node, { strokeWidth: v })}
			/>
		</Section>
	);
}

function renderTextFields(
	node: CanvasTextNode,
	commitPatch: CommitPatch,
	brandKit: BrandKit,
	t: CanvasT,
): React.JSX.Element {
	// fontFamily/fill may be a brand-token ref (canvas-m1-013): resolve for
	// display so a token never crashes a `string`-typed field. Token-aware
	// picker UI (choose literal or brand token, explicit detach) lands in
	// canvas-m2-007 (FR-033) via `TokenAwareFontField`/`TokenAwareColorField`.
	const fontFamilyResolved = resolveFontFamilyForDisplay(
		node.fontFamily,
		brandKit,
	);
	const fillResolved = resolveFillForDisplay(node.fill, brandKit);
	return (
		<Section title={t("canvas.inspector.text", "Text")}>
			<TextField
				label={t("canvas.inspector.content", "Content")}
				value={node.text}
				dataTestId="prop-text"
				onCommit={(v) => commitPatch(node, { text: v })}
			/>
			<TokenAwareFontField
				label={t("canvas.inspector.font", "Font")}
				rawValue={node.fontFamily}
				resolvedValue={fontFamilyResolved.value}
				unresolved={fontFamilyResolved.unresolved}
				fonts={brandKit.fonts}
				dataTestId="prop-font-family"
				onCommit={(v) => commitPatch(node, { fontFamily: v })}
				t={t}
			/>
			<NumberField
				label={t("canvas.inspector.size", "Size")}
				value={node.fontSize}
				min={1}
				dataTestId="prop-font-size"
				onCommit={(v) => commitPatch(node, { fontSize: v })}
			/>
			<TokenAwareColorField
				label={t("canvas.inspector.color", "Color")}
				rawValue={node.fill}
				resolvedValue={
					typeof fillResolved.value === "string"
						? fillResolved.value
						: undefined
				}
				unresolved={fillResolved.unresolved}
				colors={brandKit.colors}
				dataTestId="prop-text-fill"
				onCommit={(v) => commitPatch(node, { fill: v })}
				t={t}
			/>
		</Section>
	);
}

/**
 * Rich-text controls. MVP scope (canvas-m1-009): paragraph align/lineHeight
 * and span styling apply UNIFORMLY to every paragraph/span on the node —
 * there is no per-paragraph or per-span selection UI. Field values read from
 * the first paragraph's first span as the representative "current" value;
 * committing a field rewrites that field on every paragraph/span.
 */
function renderRichTextFields(
	node: CanvasRichTextNode,
	commitPatch: CommitPatch,
	brandKit: BrandKit,
	t: CanvasT,
): React.JSX.Element {
	const firstParagraph = node.paragraphs[0];
	const style = resolveSpanStyle(
		firstParagraph?.spans[0] ?? { text: "" },
		DEFAULT_RICH_TEXT_STYLE,
	);
	// style.fontFamily/.fill may be a brand-token ref (canvas-m1-013) — resolve
	// for display the same way renderTextFields does; see its comment.
	const fontFamilyResolved = resolveFontFamilyForDisplay(
		style.fontFamily,
		brandKit,
	);
	const fillResolved = resolveFillForDisplay(style.fill, brandKit);
	const fontFamily = fontFamilyResolved.value;
	const fill = fillResolved.value;
	const align = firstParagraph?.align ?? DEFAULT_RICH_TEXT_STYLE.align;
	const lineHeight =
		firstParagraph?.lineHeight ?? DEFAULT_RICH_TEXT_STYLE.lineHeight;
	const wrap = node.wrap ?? "word";
	const overflow = node.overflow ?? "visible";

	const commitAllParagraphs = (
		patch: Pick<
			CanvasRichTextNode["paragraphs"][number],
			"align" | "lineHeight"
		>,
	): void => {
		commitPatch(node, {
			paragraphs: node.paragraphs.map((p) => ({ ...p, ...patch })),
		});
	};
	const commitAllSpans = (
		patch: Partial<CanvasRichTextNode["paragraphs"][number]["spans"][number]>,
	): void => {
		commitPatch(node, {
			paragraphs: node.paragraphs.map((p) => ({
				...p,
				spans: p.spans.map((s) => ({ ...s, ...patch })),
			})),
		});
	};

	return (
		<>
			<Section title={t("canvas.inspector.text", "Text")}>
				<FieldRow label={t("canvas.inspector.wrap", "Wrap")}>
					<select
						aria-label={t("canvas.inspector.wrap", "Wrap")}
						data-testid="prop-rich-text-wrap"
						className="h-7.5 rounded-md border border-input bg-transparent px-2 text-xs"
						value={wrap}
						onChange={(e) =>
							commitPatch(node, {
								wrap: e.currentTarget.value as RichTextWrap,
							})
						}
					>
						<option value="word">
							{t("canvas.inspector.wrapWord", "Word")}
						</option>
						<option value="character">
							{t("canvas.inspector.wrapCharacter", "Character")}
						</option>
						<option value="none">
							{t("canvas.inspector.wrapNone", "None")}
						</option>
					</select>
				</FieldRow>
				<FieldRow label={t("canvas.inspector.overflow", "Overflow")}>
					<select
						aria-label={t("canvas.inspector.overflow", "Overflow")}
						data-testid="prop-rich-text-overflow"
						className="h-7.5 rounded-md border border-input bg-transparent px-2 text-xs"
						value={overflow}
						onChange={(e) =>
							commitPatch(node, {
								overflow: e.currentTarget.value as RichTextOverflow,
							})
						}
					>
						<option value="visible">
							{t("canvas.inspector.overflowVisible", "Visible")}
						</option>
						<option value="clip">
							{t("canvas.inspector.overflowClip", "Clip")}
						</option>
						<option value="auto-height">
							{t("canvas.inspector.overflowAutoHeight", "Auto height")}
						</option>
						<option value="ellipsis">
							{t("canvas.inspector.overflowEllipsis", "Ellipsis")}
						</option>
					</select>
				</FieldRow>
			</Section>
			<Section title={t("canvas.inspector.paragraph", "Paragraph")}>
				<FieldRow label={t("canvas.inspector.align", "Align")}>
					<select
						aria-label={t("canvas.inspector.align", "Align")}
						data-testid="prop-rich-text-align"
						className="h-7.5 rounded-md border border-input bg-transparent px-2 text-xs"
						value={align}
						onChange={(e) =>
							commitAllParagraphs({
								align: e.currentTarget.value as CanvasTextAlign,
							})
						}
					>
						<option value="left">
							{t("canvas.inspector.alignLeft", "Left")}
						</option>
						<option value="center">
							{t("canvas.inspector.alignCenter", "Center")}
						</option>
						<option value="right">
							{t("canvas.inspector.alignRight", "Right")}
						</option>
					</select>
				</FieldRow>
				<NumberField
					label={t("canvas.inspector.lineHeight", "Line height")}
					value={lineHeight}
					step={0.1}
					min={0}
					dataTestId="prop-rich-text-line-height"
					onCommit={(v) => commitAllParagraphs({ lineHeight: v })}
				/>
			</Section>
			<Section title={t("canvas.inspector.span", "Text style")}>
				<TokenAwareFontField
					label={t("canvas.inspector.font", "Font")}
					rawValue={style.fontFamily}
					resolvedValue={fontFamily}
					unresolved={fontFamilyResolved.unresolved}
					fonts={brandKit.fonts}
					dataTestId="prop-rich-text-font-family"
					onCommit={(v) => commitAllSpans({ fontFamily: v })}
					t={t}
				/>
				<NumberField
					label={t("canvas.inspector.size", "Size")}
					value={style.fontSize}
					min={1}
					dataTestId="prop-rich-text-font-size"
					onCommit={(v) => commitAllSpans({ fontSize: v })}
				/>
				<TextField
					label={t("canvas.inspector.fontWeight", "Weight")}
					value={style.fontWeight}
					dataTestId="prop-rich-text-font-weight"
					onCommit={(v) => commitAllSpans({ fontWeight: v })}
				/>
				<NumberField
					label={t("canvas.inspector.letterSpacing", "Letter spacing")}
					value={style.letterSpacing}
					step={0.1}
					dataTestId="prop-rich-text-letter-spacing"
					onCommit={(v) => commitAllSpans({ letterSpacing: v })}
				/>
				<TokenAwareColorField
					label={t("canvas.inspector.color", "Color")}
					rawValue={style.fill}
					resolvedValue={typeof fill === "string" ? fill : undefined}
					unresolved={fillResolved.unresolved}
					colors={brandKit.colors}
					dataTestId="prop-rich-text-fill"
					onCommit={(v) => commitAllSpans({ fill: v })}
					t={t}
				/>
				<FieldRow label={t("canvas.inspector.italic", "Italic")}>
					<Switch
						checked={style.italic}
						onCheckedChange={(checked) => commitAllSpans({ italic: checked })}
						aria-label={t("canvas.inspector.italic", "Italic")}
						data-testid="prop-rich-text-italic"
					/>
				</FieldRow>
				<FieldRow label={t("canvas.inspector.underline", "Underline")}>
					<Switch
						checked={style.underline}
						onCheckedChange={(checked) =>
							commitAllSpans({ underline: checked })
						}
						aria-label={t("canvas.inspector.underline", "Underline")}
						data-testid="prop-rich-text-underline"
					/>
				</FieldRow>
				<FieldRow label={t("canvas.inspector.textTransform", "Transform")}>
					<select
						aria-label={t("canvas.inspector.textTransform", "Transform")}
						data-testid="prop-rich-text-transform"
						className="h-7.5 rounded-md border border-input bg-transparent px-2 text-xs"
						value={style.textTransform}
						onChange={(e) =>
							commitAllSpans({
								textTransform: e.currentTarget.value as RichTextTransform,
							})
						}
					>
						<option value="none">
							{t("canvas.inspector.transformNone", "None")}
						</option>
						<option value="uppercase">
							{t("canvas.inspector.transformUppercase", "UPPERCASE")}
						</option>
						<option value="lowercase">
							{t("canvas.inspector.transformLowercase", "lowercase")}
						</option>
						<option value="capitalize">
							{t("canvas.inspector.transformCapitalize", "Capitalize")}
						</option>
					</select>
				</FieldRow>
			</Section>
		</>
	);
}

function renderImageFields(
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

function renderPathFields(
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
				shadow={node.shadow}
				commitPatch={commitPatch}
				t={t}
			/>
			<ColorField
				label={t("canvas.inspector.stroke", "Stroke")}
				value={node.stroke}
				dataTestId="prop-stroke"
				onCommit={(v) => commitPatch(node, { stroke: v })}
			/>
			<NumberField
				label={t("canvas.inspector.strokeWidth", "Stroke W")}
				value={node.strokeWidth ?? 1}
				min={0}
				dataTestId="prop-stroke-width"
				onCommit={(v) => commitPatch(node, { strokeWidth: v })}
			/>
			<TextField
				label={t("canvas.inspector.pathD", "Path d")}
				value={node.d}
				dataTestId="prop-path-d"
				onCommit={(v) => commitPatch(node, { d: v })}
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

function renderGroupFields(
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

/**
 * A frame's own controls: clip toggle, corner radius, and background fill.
 *
 * The background reuses {@link FillAndShadowFields} through its `fillKey` seam —
 * a frame stores its fill under `background`, not `fill`, and has no `shadow`
 * field at all, so the shadow controls are hidden.
 */
function renderFrameFields(
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
