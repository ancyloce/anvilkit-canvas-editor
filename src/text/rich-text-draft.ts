import type {
	CanvasRichTextNode,
	RichTextParagraph,
	RichTextSpan,
} from "@anvilkit/canvas-core";

/**
 * Shared conversion between a rich-text node's structured `paragraphs` and
 * the flat single-textarea draft the overlay edits (TextEditorOverlay) and
 * the toolbar reads back before applying a style change (RichTextToolbar).
 * Single source of truth so the two components can never disagree about
 * what the "current draft text" is (E-4) — a mismatch there is exactly how
 * a toolbar click discarded uncommitted typing.
 */

/** A paragraph's text, as the flat single-span line the textarea shows. */
export function flattenRichText(node: CanvasRichTextNode): string {
	return node.paragraphs
		.map((p) => p.spans.map((s) => s.text).join(""))
		.join("\n");
}

function spanStyleWithoutText(
	span: RichTextSpan | undefined,
): Omit<RichTextSpan, "text"> {
	if (!span) return {};
	const { text: _text, ...rest } = span;
	return rest;
}

/**
 * Split edited text back into paragraphs on newlines. Per-span selection is
 * out of scope for MVP (deliverable note), so each edited paragraph collapses
 * to a single span that inherits its SOURCE paragraph's align/lineHeight and
 * first span's style — the source paragraph at the same index when it existed,
 * or the original's last paragraph for any newly-typed lines beyond it.
 */
export function rebuildRichTextParagraphs(
	original: CanvasRichTextNode,
	newText: string,
): RichTextParagraph[] {
	const lastOriginal = original.paragraphs[original.paragraphs.length - 1];
	return newText.split("\n").map((lineText, i) => {
		const source = original.paragraphs[i] ?? lastOriginal;
		const style = spanStyleWithoutText(source?.spans[0]);
		return {
			...(source?.align !== undefined ? { align: source.align } : {}),
			...(source?.lineHeight !== undefined
				? { lineHeight: source.lineHeight }
				: {}),
			spans: [{ ...style, text: lineText }],
		};
	});
}
