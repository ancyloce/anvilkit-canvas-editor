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
import * as React from "react";
import type { BrandKit } from "../../brand/brand-kit.js";
import {
	resolveFillForDisplay,
	resolveFontFamilyForDisplay,
} from "../../brand/resolve-brand-token.js";
import type { CanvasT } from "../../context/canvas-studio-context.js";
import { measureGlyphWidth } from "../../text/canvas-glyph-measurer.js";
import { fontManifestHash, observeFontFamily } from "../../text/font-status.js";
import { getCachedLayout } from "../../text/layout-cache.js";
import { layoutRichText } from "../../text/rich-text-layout.js";
import { DEFAULT_RICH_TEXT_STYLE } from "../../text/rich-text-style.js";
import {
	type CommitPatchAll,
	FieldRow,
	NumberField,
	Section,
	SelectField,
	type SelectFieldOption,
	sharedFieldValue,
	TextField,
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

/** Shared align options — plain `text`'s node-level align and rich text's
 * paragraph align offer the exact same three choices. */
function alignOptions(t: CanvasT): SelectFieldOption<CanvasTextAlign>[] {
	return [
		{ value: "left", label: t("canvas.inspector.alignLeft", "Left") },
		{ value: "center", label: t("canvas.inspector.alignCenter", "Center") },
		{ value: "right", label: t("canvas.inspector.alignRight", "Right") },
	];
}

/** Align field wired through the §10 field contract (FR-081), on the packaged
 * `SelectField` primitive. */
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
	return (
		<SelectField
			label={t("canvas.inspector.align", "Align")}
			value={shared.value}
			mixed={shared.mixed}
			options={alignOptions(t)}
			dataTestId="prop-text-align"
			contract={{ nodes, buildPatch: (_n, v) => ({ align: v }) }}
		/>
	);
}

/**
 * FR-081: exposes exactly the plain-`text` node's own Core schema fields —
 * content, font family/size/weight, fill, align, shadow — nothing rich-text
 * only (no letter-spacing/line-height/vertical-align/strikethrough). Weight
 * reuses rich-text's `TextField`-based Weight control (same contract
 * pattern); Align shares rich-text's paragraph-align options via
 * `alignOptions`, wired through the field contract; Shadow reuses the SAME
 * `FillAndShadowFields` shape/path
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
	const measured = getCachedLayout(
		node.paragraphs,
		node.width,
		wrap,
		() =>
			layoutRichText(
				{
					paragraphs: node.paragraphs,
					width: node.width,
					wrap,
					defaults: DEFAULT_RICH_TEXT_STYLE,
				},
				measureGlyphWidth,
			),
		{ defaults: DEFAULT_RICH_TEXT_STYLE, manifestHash: fontManifestHash() },
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
				<SelectField
					label={t("canvas.inspector.wrap", "Wrap")}
					value={wrap}
					options={[
						{ value: "word", label: t("canvas.inspector.wrapWord", "Word") },
						{
							value: "character",
							label: t("canvas.inspector.wrapCharacter", "Character"),
						},
						{ value: "none", label: t("canvas.inspector.wrapNone", "None") },
					]}
					dataTestId="prop-rich-text-wrap"
					onCommit={(v: RichTextWrap) =>
						commitPatchAll(nodes, () => ({ wrap: v }))
					}
				/>
				<SelectField
					label={t("canvas.inspector.overflow", "Overflow")}
					value={overflow}
					options={[
						{
							value: "visible",
							label: t("canvas.inspector.overflowVisible", "Visible"),
						},
						{
							value: "clip",
							label: t("canvas.inspector.overflowClip", "Clip"),
						},
						{
							value: "auto-height",
							label: t("canvas.inspector.overflowAutoHeight", "Auto height"),
						},
						{
							value: "ellipsis",
							label: t("canvas.inspector.overflowEllipsis", "Ellipsis"),
						},
					]}
					dataTestId="prop-rich-text-overflow"
					onCommit={(v: RichTextOverflow) =>
						commitPatchAll(nodes, () => ({ overflow: v }))
					}
				/>
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
				<SelectField
					label={t("canvas.inspector.sizing", "Sizing")}
					value={node.sizing ?? "fixed"}
					options={[
						{
							value: "fixed",
							label: t("canvas.inspector.sizingFixed", "Fixed"),
						},
						{
							value: "auto-width",
							label: t("canvas.inspector.sizingAutoWidth", "Auto width"),
						},
					]}
					dataTestId="prop-rich-text-sizing"
					onCommit={(v: "fixed" | "auto-width") =>
						commitPatchAll(nodes, () => ({
							// "fixed" is the schema default — written back as absent.
							sizing: v === "fixed" ? undefined : v,
						}))
					}
				/>
				<SelectField
					label={t("canvas.inspector.verticalAlign", "Vertical align")}
					value={node.verticalAlign ?? "top"}
					options={[
						{ value: "top", label: t("canvas.inspector.vAlignTop", "Top") },
						{
							value: "middle",
							label: t("canvas.inspector.vAlignMiddle", "Middle"),
						},
						{
							value: "bottom",
							label: t("canvas.inspector.vAlignBottom", "Bottom"),
						},
					]}
					dataTestId="prop-rich-text-vertical-align"
					onCommit={(v: "top" | "middle" | "bottom") =>
						commitPatchAll(nodes, () => ({
							// "top" is the schema default — written back as absent.
							verticalAlign: v === "top" ? undefined : v,
						}))
					}
				/>
			</Section>
			<Section title={t("canvas.inspector.paragraph", "Paragraph")}>
				<SelectField
					label={t("canvas.inspector.align", "Align")}
					value={align}
					options={alignOptions(t)}
					dataTestId="prop-rich-text-align"
					onCommit={(v: CanvasTextAlign) =>
						commitPatchAll(nodes, (n) =>
							allParagraphsPatch(n as CanvasRichTextNode, { align: v }),
						)
					}
				/>
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
				<SelectField
					label={t("canvas.inspector.textTransform", "Transform")}
					value={style.textTransform}
					options={[
						{
							value: "none",
							label: t("canvas.inspector.transformNone", "None"),
						},
						{
							value: "uppercase",
							label: t("canvas.inspector.transformUppercase", "UPPERCASE"),
						},
						{
							value: "lowercase",
							label: t("canvas.inspector.transformLowercase", "lowercase"),
						},
						{
							value: "capitalize",
							label: t("canvas.inspector.transformCapitalize", "Capitalize"),
						},
					]}
					dataTestId="prop-rich-text-transform"
					onCommit={(v: RichTextTransform) =>
						commitPatchAll(nodes, (n) =>
							allSpansPatch(n as CanvasRichTextNode, { textTransform: v }),
						)
					}
				/>
			</Section>
		</>
	);
}
