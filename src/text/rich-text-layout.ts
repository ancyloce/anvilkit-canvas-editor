import {
	type CanvasTextAlign,
	type MeasuredLine,
	type MeasuredRun,
	type MeasuredText,
	type ResolvedSpanStyle,
	type RichTextParagraph,
	type RichTextSpan,
	type RichTextStyleDefaults,
	type RichTextWrap,
	resolveSpanStyle,
	type TextMeasureRequest,
} from "@anvilkit/canvas-core";

/**
 * Pure text layout for `rich-text` nodes: paragraphs + spans + a wrap width
 * flow into line boxes and run positions, with no React, DOM, or Konva
 * import — the exact shape core's `CanvasTextMeasurer` contract asks for
 * (`text-contracts.ts`). Both the stage renderer (`CanvasNodeRenderer.tsx`)
 * and the host-facing SVG measurer adapter (`canvas-text-measurer.ts`) call
 * THIS function, so they can never disagree about where a line breaks —
 * only about how a `GlyphWidthMeasurer` answers "how wide are these glyphs".
 */

/**
 * Raw glyph-metrics width of `text` rendered in `style`, with NO
 * letter-spacing applied — {@link layoutRichText} adds that itself, so an
 * implementation (a real Canvas2D context, a deterministic test stub, …) only
 * ever has to answer one question.
 */
export type GlyphWidthMeasurer = (
	text: string,
	style: ResolvedSpanStyle,
) => number;

/**
 * Mirrors core's private SVG baseline constant (`TEXT_ASCENT_RATIO`,
 * `serialize/svg.ts`) so a line's glyphs sit at the same relative baseline on
 * the stage as they would in an SVG export.
 */
const TEXT_ASCENT_RATIO = 0.8;

interface Token {
	spanIndex: number;
	/** Character offset of this token within its span's `text`. */
	start: number;
	text: string;
	width: number;
	whitespace: boolean;
}

const WHITESPACE_RE = /\s/;

function measureWithSpacing(
	text: string,
	style: ResolvedSpanStyle,
	measure: GlyphWidthMeasurer,
): number {
	if (text.length === 0) return 0;
	return measure(text, style) + style.letterSpacing * text.length;
}

/**
 * Split one span's text into layout tokens for the given wrap mode.
 *
 * `"none"` never breaks — the whole span is one token. `"word"` alternates
 * whitespace-run / non-whitespace-run tokens (a break may only happen between
 * tokens). `"character"` treats every UTF-16 code unit as its own token, so a
 * break may happen anywhere.
 */
function tokenizeSpan(
	text: string,
	spanIndex: number,
	style: ResolvedSpanStyle,
	wrap: RichTextWrap,
	measure: GlyphWidthMeasurer,
): Token[] {
	if (text.length === 0) return [];

	if (wrap === "none") {
		return [
			{
				spanIndex,
				start: 0,
				text,
				width: measureWithSpacing(text, style, measure),
				whitespace: false,
			},
		];
	}

	if (wrap === "character") {
		const tokens: Token[] = [];
		for (let i = 0; i < text.length; i += 1) {
			const ch = text[i] as string;
			tokens.push({
				spanIndex,
				start: i,
				text: ch,
				width: measureWithSpacing(ch, style, measure),
				whitespace: WHITESPACE_RE.test(ch),
			});
		}
		return tokens;
	}

	const tokens: Token[] = [];
	for (const match of text.matchAll(/\s+|\S+/g)) {
		const chunk = match[0];
		tokens.push({
			spanIndex,
			start: match.index,
			text: chunk,
			width: measureWithSpacing(chunk, style, measure),
			whitespace: WHITESPACE_RE.test(chunk[0] ?? ""),
		});
	}
	return tokens;
}

function trimTrailingWhitespace(tokens: Token[]): Token[] {
	let end = tokens.length;
	while (end > 0 && tokens[end - 1]?.whitespace) end -= 1;
	return tokens.slice(0, end);
}

/**
 * Greedily pack a paragraph's flat token stream into lines of at most `width`.
 *
 * Breaks only ever land BETWEEN tokens (never inside one), so a single token
 * wider than `width` is placed on its own line rather than forced to split —
 * `"word"` wrap never breaks a word mid-way, matching common editor behavior.
 * Leading whitespace of a WRAPPED line is dropped (the paragraph's own first
 * line keeps it), and trailing whitespace of every line is trimmed before it
 * is finalized — both mirror standard text-flow behavior.
 */
function packParagraphLines(
	tokens: Token[],
	wrap: RichTextWrap,
	width: number,
): Token[][] {
	if (tokens.length === 0) return [[]];

	const lines: Token[][] = [];
	let current: Token[] = [];
	let currentWidth = 0;

	const pushLine = (): void => {
		lines.push(trimTrailingWhitespace(current));
		current = [];
		currentWidth = 0;
	};

	for (const token of tokens) {
		if (current.length === 0 && token.whitespace && lines.length > 0) {
			continue;
		}
		if (
			wrap !== "none" &&
			current.length > 0 &&
			currentWidth + token.width > width
		) {
			pushLine();
			if (token.whitespace) continue;
		}
		current.push(token);
		currentWidth += token.width;
	}
	lines.push(trimTrailingWhitespace(current));
	return lines;
}

/** Merge consecutive same-span tokens on one line into contiguous runs. */
function buildRuns(
	lineTokens: readonly Token[],
	paragraphIndex: number,
	spans: readonly RichTextSpan[],
	defaults: RichTextStyleDefaults,
	measure: GlyphWidthMeasurer,
): MeasuredRun[] {
	const runs: MeasuredRun[] = [];
	let x = 0;
	let i = 0;
	while (i < lineTokens.length) {
		const spanIndex = lineTokens[i]?.spanIndex as number;
		const start = lineTokens[i]?.start as number;
		let text = "";
		let j = i;
		while (j < lineTokens.length && lineTokens[j]?.spanIndex === spanIndex) {
			text += lineTokens[j]?.text;
			j += 1;
		}
		const span = spans[spanIndex];
		const style = span ? resolveSpanStyle(span, defaults) : defaults;
		const width = measureWithSpacing(text, style, measure);
		runs.push({ paragraphIndex, spanIndex, start, text, x, width });
		x += width;
		i = j;
	}
	return runs;
}

/** The largest resolved font size touched by a line — what drives its height. */
function lineFontSize(
	lineTokens: readonly Token[],
	spans: readonly RichTextSpan[],
	defaults: RichTextStyleDefaults,
): number {
	let size = 0;
	const seen = new Set<number>();
	for (const token of lineTokens) {
		if (seen.has(token.spanIndex)) continue;
		seen.add(token.spanIndex);
		const span = spans[token.spanIndex];
		const fontSize = span
			? resolveSpanStyle(span, defaults).fontSize
			: defaults.fontSize;
		size = Math.max(size, fontSize);
	}
	// An empty line (empty paragraph) still occupies vertical space.
	return size > 0 ? size : defaults.fontSize;
}

function alignOffset(
	align: CanvasTextAlign,
	boxWidth: number,
	lineWidth: number,
): number {
	if (align === "center") return (boxWidth - lineWidth) / 2;
	if (align === "right") return boxWidth - lineWidth;
	return 0;
}

/**
 * Lay out rich text: the shared implementation behind core's
 * {@link CanvasTextMeasurer} contract. Pure and deterministic given the same
 * `request` and `measure` function — see the contract's own docs for why that
 * matters (stage/export parity).
 */
export function layoutRichText(
	request: TextMeasureRequest,
	measure: GlyphWidthMeasurer,
): MeasuredText {
	const { paragraphs, width, wrap, defaults } = request;
	const lines: MeasuredLine[] = [];
	let y = 0;
	let maxWidth = 0;

	for (const [paragraphIndex, paragraph] of paragraphs.entries()) {
		const tokens = paragraph.spans.flatMap((span, spanIndex) =>
			tokenizeSpan(
				span.text,
				spanIndex,
				resolveSpanStyle(span, defaults),
				wrap,
				measure,
			),
		);
		const lineHeightMultiple = paragraph.lineHeight ?? defaults.lineHeight;
		const align = paragraph.align ?? defaults.align;

		for (const lineTokens of packParagraphLines(tokens, wrap, width)) {
			const runs = buildRuns(
				lineTokens,
				paragraphIndex,
				paragraph.spans,
				defaults,
				measure,
			);
			const lineWidth = runs.reduce((sum, run) => sum + run.width, 0);
			const fontSize = lineFontSize(lineTokens, paragraph.spans, defaults);
			const height = fontSize * lineHeightMultiple;

			lines.push({
				paragraphIndex,
				runs,
				x: alignOffset(align, width, lineWidth),
				y,
				width: lineWidth,
				height,
				baseline: fontSize * TEXT_ASCENT_RATIO,
			});

			maxWidth = Math.max(maxWidth, lineWidth);
			y += height;
		}
	}

	return { lines, width: maxWidth, height: y };
}
