"use client";

import {
	type CanvasRichTextNode,
	type CanvasTextAlign,
	type CanvasTextNode,
	type RichTextOverflow,
	type RichTextTransform,
	type RichTextWrap,
	resolveSpanStyle,
} from "@anvilkit/canvas-core";
import { Button } from "@anvilkit/ui/button";
import { Switch } from "@anvilkit/ui/components/animate-ui/components/base/switch";
import type { BrandKit } from "../../brand/brand-kit.js";
import {
	resolveFillForDisplay,
	resolveFontFamilyForDisplay,
} from "../../brand/resolve-brand-token.js";
import type { CanvasT } from "../../context/canvas-studio-context.js";
import { measureGlyphWidth } from "../../text/canvas-glyph-measurer.js";
import { observeFontFamily } from "../../text/font-status.js";
import { getCachedLayout } from "../../text/layout-cache.js";
import { layoutRichText } from "../../text/rich-text-layout.js";
import { DEFAULT_RICH_TEXT_STYLE } from "../../text/rich-text-style.js";
import {
	type CommitPatchAll,
	FieldRow,
	NumberField,
	Section,
	sharedFieldValue,
	TextField,
	useFieldContract,
} from "../fields.js";
import { FillAndShadowFields } from "../fill-shadow-fields.js";
import {
	TokenAwareColorField,
	TokenAwareFontField,
} from "../token-aware-fields.js";

/**
 * Text-kind inspector sections (M0-07 split from `PropertyInspector.tsx`,
 * verbatim). Dispatch lives in `./type-sections.tsx`.
 *
 * FR-070 (B-12 multi-kind sections): both render functions take the WHOLE
 * same-kind selection as `nodes` (a single-node array for single-selection).
 * Continuous fields patch every node in ONE batch via the `contract` prop;
 * discrete controls (selects, switches) via `commitPatchAll`.
 */

/** Native `<select>`-backed align field, wired through the §10 field contract
 * (FR-081): reuses the exact select markup rich-text's paragraph-align field
 * already renders below, just committing through `useFieldContract` directly
 * since there is no packaged contract-aware Select component. */
function TextAlignField({
	nodes,
	t,
}: {
	nodes: readonly CanvasTextNode[];
	t: CanvasT;
}): React.JSX.Element {
	const shared = sharedFieldValue(
		nodes,
		(n) => (n as CanvasTextNode).align ?? "left",
	);
	const field = useFieldContract<CanvasTextAlign>(
		{ nodes, buildPatch: (_n, v) => ({ align: v }) },
		"prop-text-align",
	);
	return (
		<FieldRow label={t("canvas.inspector.align", "Align")}>
			<select
				aria-label={t("canvas.inspector.align", "Align")}
				data-testid="prop-text-align"
				className="h-7.5 rounded-md border border-input bg-transparent px-2 text-xs"
				value={shared.mixed ? "" : shared.value}
				onChange={(e) => field.commit(e.currentTarget.value as CanvasTextAlign)}
			>
				{shared.mixed ? (
					<option value="" disabled>
						{t("canvas.inspector.mixed", "Mixed")}
					</option>
				) : null}
				<option value="left">{t("canvas.inspector.alignLeft", "Left")}</option>
				<option value="center">
					{t("canvas.inspector.alignCenter", "Center")}
				</option>
				<option value="right">
					{t("canvas.inspector.alignRight", "Right")}
				</option>
			</select>
		</FieldRow>
	);
}

/**
 * FR-081: exposes exactly the plain-`text` node's own Core schema fields —
 * content, font family/size/weight, fill, align, shadow — nothing rich-text
 * only (no letter-spacing/line-height/vertical-align/strikethrough). Weight
 * reuses rich-text's `TextField`-based Weight control (same contract
 * pattern); Align reuses rich-text's align `<select>` markup, wired through
 * the field contract; Shadow reuses the SAME `FillAndShadowFields` shape/path
 * kinds already use — `showFill={false}` keeps this node's own dedicated
 * Color field as the only fill control (no duplicate "Fill type" picker).
 */
export function renderTextFields(
	nodes: readonly CanvasTextNode[],
	commitPatchAll: CommitPatchAll,
	brandKit: BrandKit,
	t: CanvasT,
): React.JSX.Element {
	const node = nodes[0] as CanvasTextNode;
	// fontFamily/fill may be a brand-token ref (canvas-m1-013): resolve for
	// display so a token never crashes a `string`-typed field. Token-aware
	// picker UI (choose literal or brand token, explicit detach) lands in
	// canvas-m2-007 (FR-033) via `TokenAwareFontField`/`TokenAwareColorField`.
	// Display values read from the FIRST node (representative); "Mixed" shows
	// via `NumberField`/`TextField`'s `mixed` prop where a value differs.
	const fontFamilyResolved = resolveFontFamilyForDisplay(
		node.fontFamily,
		brandKit,
	);
	const fillResolved = resolveFillForDisplay(node.fill, brandKit);
	const text = sharedFieldValue(nodes, (n) => (n as CanvasTextNode).text);
	const fontSize = sharedFieldValue(
		nodes,
		(n) => (n as CanvasTextNode).fontSize,
	);
	const fontWeight = sharedFieldValue(
		nodes,
		(n) => (n as CanvasTextNode).fontWeight ?? "",
	);
	return (
		<Section title={t("canvas.inspector.text", "Text")}>
			<TextField
				label={t("canvas.inspector.content", "Content")}
				value={text.value}
				mixed={text.mixed}
				dataTestId="prop-text"
				contract={{ nodes, buildPatch: (_n, v) => ({ text: v }) }}
			/>
			<TokenAwareFontField
				label={t("canvas.inspector.font", "Font")}
				rawValue={node.fontFamily}
				resolvedValue={fontFamilyResolved.value}
				unresolved={fontFamilyResolved.unresolved}
				fonts={brandKit.fonts}
				dataTestId="prop-font-family"
				onCommit={(v) => commitPatchAll(nodes, () => ({ fontFamily: v }))}
				contract={{ nodes, buildPatch: (_n, v) => ({ fontFamily: v }) }}
				t={t}
			/>
			<NumberField
				label={t("canvas.inspector.size", "Size")}
				value={fontSize.value}
				mixed={fontSize.mixed}
				min={1}
				dataTestId="prop-font-size"
				contract={{ nodes, buildPatch: (_n, v) => ({ fontSize: v }) }}
			/>
			<TextField
				label={t("canvas.inspector.fontWeight", "Weight")}
				value={fontWeight.value}
				mixed={fontWeight.mixed}
				dataTestId="prop-font-weight"
				contract={{ nodes, buildPatch: (_n, v) => ({ fontWeight: v }) }}
			/>
			<TextAlignField nodes={nodes} t={t} />
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
				onCommit={(v) => commitPatchAll(nodes, () => ({ fill: v }))}
				contract={{ nodes, buildPatch: (_n, v) => ({ fill: v }) }}
				t={t}
			/>
			<FillAndShadowFields
				nodes={nodes}
				commitPatchAll={commitPatchAll}
				t={t}
				showFill={false}
			/>
		</Section>
	);
}

/**
 * Rich-text controls. MVP scope (canvas-m1-009): paragraph align/lineHeight
 * and span styling apply UNIFORMLY to every paragraph/span on the node —
 * there is no per-paragraph or per-span selection UI. Field values read from
 * the REPRESENTATIVE node's (nodes[0]) first paragraph's first span as the
 * "current" value; committing a field rewrites that field on every
 * paragraph/span of EVERY selected node (FR-070), each node keeping its own
 * paragraph/span structure — only the edited field changes.
 */
export function renderRichTextFields(
	nodes: readonly CanvasRichTextNode[],
	commitPatchAll: CommitPatchAll,
	brandKit: BrandKit,
	t: CanvasT,
): React.JSX.Element {
	const node = nodes[0] as CanvasRichTextNode;
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
	const wrap = node.wrap ?? "word";
	const overflow = node.overflow ?? "visible";

	/** Every selected node's own first-paragraph-first-span style, for mixed
	 * indication on the span-style fields. */
	const spanStyleOf = (n: CanvasRichTextNode) =>
		resolveSpanStyle(
			n.paragraphs[0]?.spans[0] ?? { text: "" },
			DEFAULT_RICH_TEXT_STYLE,
		);
	const fontSizeShared = sharedFieldValue(
		nodes,
		(n) => spanStyleOf(n as CanvasRichTextNode).fontSize,
	);
	const fontWeightShared = sharedFieldValue(
		nodes,
		(n) => spanStyleOf(n as CanvasRichTextNode).fontWeight,
	);
	const letterSpacingShared = sharedFieldValue(
		nodes,
		(n) => spanStyleOf(n as CanvasRichTextNode).letterSpacing,
	);
	const lineHeightShared = sharedFieldValue(
		nodes,
		(n) =>
			(n as CanvasRichTextNode).paragraphs[0]?.lineHeight ??
			DEFAULT_RICH_TEXT_STYLE.lineHeight,
	);

	// FR-083 (C-11): passive font state; FR-084: overflow warning + fixes.
	// Layout/overflow measurement is inherently a REPRESENTATIVE-node concern
	// (it depends on that node's own paragraphs/bounds) — shrink-to-fit/expand
	// act on the first selected node only, same as `path`'s "Edit points".
	const fontStatus = observeFontFamily(fontFamilyResolved.value);
	const measured = getCachedLayout(node.paragraphs, node.width, wrap, () =>
		layoutRichText(
			{
				paragraphs: node.paragraphs,
				width: node.width,
				wrap,
				defaults: DEFAULT_RICH_TEXT_STYLE,
			},
			measureGlyphWidth,
		),
	);
	const overflowing =
		overflow !== "auto-height" &&
		measured.height > node.bounds.height + 0.5 &&
		node.bounds.height > 0;
	const shrinkToFit = (): void => {
		const factor = node.bounds.height / measured.height;
		commitPatchAll([node], () => ({
			paragraphs: node.paragraphs.map((p) => ({
				...p,
				spans: p.spans.map((s) => ({
					...s,
					fontSize: Math.max(
						1,
						Math.floor(
							resolveSpanStyle(s, DEFAULT_RICH_TEXT_STYLE).fontSize * factor,
						),
					),
				})),
			})),
		}));
	};
	const expandBox = (): void => {
		commitPatchAll([node], () => ({
			bounds: { ...node.bounds, height: Math.ceil(measured.height) },
		}));
	};

	const allParagraphsPatch = (
		n: CanvasRichTextNode,
		patch: Pick<
			CanvasRichTextNode["paragraphs"][number],
			"align" | "lineHeight"
		>,
	) => ({ paragraphs: n.paragraphs.map((p) => ({ ...p, ...patch })) });
	const allSpansPatch = (
		n: CanvasRichTextNode,
		patch: Partial<CanvasRichTextNode["paragraphs"][number]["spans"][number]>,
	) => ({
		paragraphs: n.paragraphs.map((p) => ({
			...p,
			spans: p.spans.map((s) => ({ ...s, ...patch })),
		})),
	});

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
							commitPatchAll(nodes, () => ({
								wrap: e.currentTarget.value as RichTextWrap,
							}))
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
							commitPatchAll(nodes, () => ({
								overflow: e.currentTarget.value as RichTextOverflow,
							}))
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
				{overflowing ? (
					<div
						data-testid="rich-text-overflow-warning"
						role="status"
						className="space-y-1 rounded-md bg-amber-500/10 px-2.5 py-1.5 text-[0.7rem] text-amber-700 dark:text-amber-400"
					>
						<div>
							{t(
								"canvas.inspector.overflowWarning",
								"Text exceeds the box and may be cut off.",
							)}
						</div>
						<div className="flex gap-1.5">
							<Button
								type="button"
								variant="outline"
								size="sm"
								className="h-6 px-2 text-[11px]"
								data-testid="rich-text-shrink-to-fit"
								onClick={shrinkToFit}
							>
								{t("canvas.inspector.shrinkToFit", "Shrink to fit")}
							</Button>
							<Button
								type="button"
								variant="outline"
								size="sm"
								className="h-6 px-2 text-[11px]"
								data-testid="rich-text-expand-box"
								onClick={expandBox}
							>
								{t("canvas.inspector.expandBox", "Expand box")}
							</Button>
						</div>
					</div>
				) : null}
				{fontStatus === "missing" || fontStatus === "error" ? (
					<div
						data-testid="rich-text-font-status"
						role="status"
						className="rounded-md bg-amber-500/10 px-2.5 py-1.5 text-[0.7rem] text-amber-700 dark:text-amber-400"
					>
						{t(
							"canvas.inspector.fontMissing",
							"Font isn't available — showing a fallback.",
						)}
					</div>
				) : null}
				<FieldRow label={t("canvas.inspector.sizing", "Sizing")}>
					<select
						aria-label={t("canvas.inspector.sizing", "Sizing")}
						data-testid="prop-rich-text-sizing"
						className="h-7.5 rounded-md border border-input bg-transparent px-2 text-xs"
						value={node.sizing ?? "fixed"}
						onChange={(e) =>
							commitPatchAll(nodes, () => ({
								sizing:
									e.currentTarget.value === "fixed"
										? undefined
										: (e.currentTarget.value as "auto-width"),
							}))
						}
					>
						<option value="fixed">
							{t("canvas.inspector.sizingFixed", "Fixed")}
						</option>
						<option value="auto-width">
							{t("canvas.inspector.sizingAutoWidth", "Auto width")}
						</option>
					</select>
				</FieldRow>
				<FieldRow label={t("canvas.inspector.verticalAlign", "Vertical align")}>
					<select
						aria-label={t("canvas.inspector.verticalAlign", "Vertical align")}
						data-testid="prop-rich-text-vertical-align"
						className="h-7.5 rounded-md border border-input bg-transparent px-2 text-xs"
						value={node.verticalAlign ?? "top"}
						onChange={(e) =>
							commitPatchAll(nodes, () => ({
								verticalAlign:
									e.currentTarget.value === "top"
										? undefined
										: (e.currentTarget.value as "middle" | "bottom"),
							}))
						}
					>
						<option value="top">
							{t("canvas.inspector.vAlignTop", "Top")}
						</option>
						<option value="middle">
							{t("canvas.inspector.vAlignMiddle", "Middle")}
						</option>
						<option value="bottom">
							{t("canvas.inspector.vAlignBottom", "Bottom")}
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
							commitPatchAll(nodes, (n) =>
								allParagraphsPatch(n as CanvasRichTextNode, {
									align: e.currentTarget.value as CanvasTextAlign,
								}),
							)
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
					value={lineHeightShared.value}
					mixed={lineHeightShared.mixed}
					step={0.1}
					min={0}
					dataTestId="prop-rich-text-line-height"
					contract={{
						nodes,
						buildPatch: (n, v) =>
							allParagraphsPatch(n as CanvasRichTextNode, { lineHeight: v }),
					}}
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
					onCommit={(v) =>
						commitPatchAll(nodes, (n) =>
							allSpansPatch(n as CanvasRichTextNode, { fontFamily: v }),
						)
					}
					contract={{
						nodes,
						buildPatch: (n, v) =>
							allSpansPatch(n as CanvasRichTextNode, { fontFamily: v }),
					}}
					t={t}
				/>
				<NumberField
					label={t("canvas.inspector.size", "Size")}
					value={fontSizeShared.value}
					mixed={fontSizeShared.mixed}
					min={1}
					dataTestId="prop-rich-text-font-size"
					contract={{
						nodes,
						buildPatch: (n, v) =>
							allSpansPatch(n as CanvasRichTextNode, { fontSize: v }),
					}}
				/>
				<TextField
					label={t("canvas.inspector.fontWeight", "Weight")}
					value={fontWeightShared.value ?? ""}
					mixed={fontWeightShared.mixed}
					dataTestId="prop-rich-text-font-weight"
					contract={{
						nodes,
						buildPatch: (n, v) =>
							allSpansPatch(n as CanvasRichTextNode, { fontWeight: v }),
					}}
				/>
				<NumberField
					label={t("canvas.inspector.letterSpacing", "Letter spacing")}
					value={letterSpacingShared.value ?? 0}
					mixed={letterSpacingShared.mixed}
					step={0.1}
					dataTestId="prop-rich-text-letter-spacing"
					contract={{
						nodes,
						buildPatch: (n, v) =>
							allSpansPatch(n as CanvasRichTextNode, { letterSpacing: v }),
					}}
				/>
				<TokenAwareColorField
					label={t("canvas.inspector.color", "Color")}
					rawValue={style.fill}
					resolvedValue={typeof fill === "string" ? fill : undefined}
					unresolved={fillResolved.unresolved}
					colors={brandKit.colors}
					dataTestId="prop-rich-text-fill"
					onCommit={(v) =>
						commitPatchAll(nodes, (n) =>
							allSpansPatch(n as CanvasRichTextNode, { fill: v }),
						)
					}
					contract={{
						nodes,
						buildPatch: (n, v) =>
							allSpansPatch(n as CanvasRichTextNode, { fill: v }),
					}}
					t={t}
				/>
				<FieldRow label={t("canvas.inspector.italic", "Italic")}>
					<Switch
						checked={style.italic}
						onCheckedChange={(checked) =>
							commitPatchAll(nodes, (n) =>
								allSpansPatch(n as CanvasRichTextNode, { italic: checked }),
							)
						}
						aria-label={t("canvas.inspector.italic", "Italic")}
						data-testid="prop-rich-text-italic"
					/>
				</FieldRow>
				<FieldRow label={t("canvas.inspector.underline", "Underline")}>
					<Switch
						checked={style.underline}
						onCheckedChange={(checked) =>
							commitPatchAll(nodes, (n) =>
								allSpansPatch(n as CanvasRichTextNode, { underline: checked }),
							)
						}
						aria-label={t("canvas.inspector.underline", "Underline")}
						data-testid="prop-rich-text-underline"
					/>
				</FieldRow>
				<FieldRow label={t("canvas.inspector.strikethrough", "Strikethrough")}>
					<Switch
						checked={style.strikethrough}
						onCheckedChange={(checked) =>
							commitPatchAll(nodes, (n) =>
								allSpansPatch(n as CanvasRichTextNode, {
									strikethrough: checked,
								}),
							)
						}
						aria-label={t("canvas.inspector.strikethrough", "Strikethrough")}
						data-testid="prop-rich-text-strikethrough"
					/>
				</FieldRow>
				<FieldRow label={t("canvas.inspector.textTransform", "Transform")}>
					<select
						aria-label={t("canvas.inspector.textTransform", "Transform")}
						data-testid="prop-rich-text-transform"
						className="h-7.5 rounded-md border border-input bg-transparent px-2 text-xs"
						value={style.textTransform}
						onChange={(e) =>
							commitPatchAll(nodes, (n) =>
								allSpansPatch(n as CanvasRichTextNode, {
									textTransform: e.currentTarget.value as RichTextTransform,
								}),
							)
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
