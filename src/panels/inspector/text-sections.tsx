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
import { Switch } from "@anvilkit/ui/components/animate-ui/components/base/switch";
import type { BrandKit } from "../../brand/brand-kit.js";
import {
	resolveFillForDisplay,
	resolveFontFamilyForDisplay,
} from "../../brand/resolve-brand-token.js";
import type { CanvasT } from "../../context/canvas-studio-context.js";
import { DEFAULT_RICH_TEXT_STYLE } from "../../text/rich-text-style.js";
import {
	type CommitPatch,
	FieldRow,
	NumberField,
	Section,
	TextField,
} from "../fields.js";
import {
	TokenAwareColorField,
	TokenAwareFontField,
} from "../token-aware-fields.js";

/**
 * Text-kind inspector sections (M0-07 split from `PropertyInspector.tsx`,
 * verbatim). Dispatch lives in `./type-sections.tsx`.
 */

export function renderTextFields(
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
				contract={{ nodes: [node], buildPatch: (_n, v) => ({ text: v }) }}
			/>
			<TokenAwareFontField
				label={t("canvas.inspector.font", "Font")}
				rawValue={node.fontFamily}
				resolvedValue={fontFamilyResolved.value}
				unresolved={fontFamilyResolved.unresolved}
				fonts={brandKit.fonts}
				dataTestId="prop-font-family"
				onCommit={(v) => commitPatch(node, { fontFamily: v })}
				contract={{ nodes: [node], buildPatch: (_n, v) => ({ fontFamily: v }) }}
				t={t}
			/>
			<NumberField
				label={t("canvas.inspector.size", "Size")}
				value={node.fontSize}
				min={1}
				dataTestId="prop-font-size"
				contract={{ nodes: [node], buildPatch: (_n, v) => ({ fontSize: v }) }}
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
				contract={{ nodes: [node], buildPatch: (_n, v) => ({ fill: v }) }}
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
export function renderRichTextFields(
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

	const allParagraphsPatch = (
		patch: Pick<
			CanvasRichTextNode["paragraphs"][number],
			"align" | "lineHeight"
		>,
	) => ({ paragraphs: node.paragraphs.map((p) => ({ ...p, ...patch })) });
	const allSpansPatch = (
		patch: Partial<CanvasRichTextNode["paragraphs"][number]["spans"][number]>,
	) => ({
		paragraphs: node.paragraphs.map((p) => ({
			...p,
			spans: p.spans.map((s) => ({ ...s, ...patch })),
		})),
	});
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
				<FieldRow label={t("canvas.inspector.sizing", "Sizing")}>
					<select
						aria-label={t("canvas.inspector.sizing", "Sizing")}
						data-testid="prop-rich-text-sizing"
						className="h-7.5 rounded-md border border-input bg-transparent px-2 text-xs"
						value={node.sizing ?? "fixed"}
						onChange={(e) =>
							commitPatch(node, {
								sizing:
									e.currentTarget.value === "fixed"
										? undefined
										: (e.currentTarget.value as "auto-width"),
							})
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
					contract={{
						nodes: [node],
						buildPatch: (_n, v) => allParagraphsPatch({ lineHeight: v }),
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
					onCommit={(v) => commitAllSpans({ fontFamily: v })}
					contract={{
						nodes: [node],
						buildPatch: (_n, v) => allSpansPatch({ fontFamily: v }),
					}}
					t={t}
				/>
				<NumberField
					label={t("canvas.inspector.size", "Size")}
					value={style.fontSize}
					min={1}
					dataTestId="prop-rich-text-font-size"
					contract={{
						nodes: [node],
						buildPatch: (_n, v) => allSpansPatch({ fontSize: v }),
					}}
				/>
				<TextField
					label={t("canvas.inspector.fontWeight", "Weight")}
					value={style.fontWeight}
					dataTestId="prop-rich-text-font-weight"
					contract={{
						nodes: [node],
						buildPatch: (_n, v) => allSpansPatch({ fontWeight: v }),
					}}
				/>
				<NumberField
					label={t("canvas.inspector.letterSpacing", "Letter spacing")}
					value={style.letterSpacing}
					step={0.1}
					dataTestId="prop-rich-text-letter-spacing"
					contract={{
						nodes: [node],
						buildPatch: (_n, v) => allSpansPatch({ letterSpacing: v }),
					}}
				/>
				<TokenAwareColorField
					label={t("canvas.inspector.color", "Color")}
					rawValue={style.fill}
					resolvedValue={typeof fill === "string" ? fill : undefined}
					unresolved={fillResolved.unresolved}
					colors={brandKit.colors}
					dataTestId="prop-rich-text-fill"
					onCommit={(v) => commitAllSpans({ fill: v })}
					contract={{
						nodes: [node],
						buildPatch: (_n, v) => allSpansPatch({ fill: v }),
					}}
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
				<FieldRow label={t("canvas.inspector.strikethrough", "Strikethrough")}>
					<Switch
						checked={style.strikethrough}
						onCheckedChange={(checked) =>
							commitAllSpans({ strikethrough: checked })
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
