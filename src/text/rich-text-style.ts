import type {
	RichTextStyleDefaults,
	RichTextTransform,
} from "@anvilkit/canvas-core";

/**
 * Fallbacks for the rich-text style fields a document leaves unset.
 *
 * MUST stay byte-identical to core's private `DEFAULT_RICH_TEXT_STYLE`
 * (`serialize/svg.ts`): the stage and an SVG export both resolve unset span
 * fields through this, and if the two disagreed an unstyled rich-text block
 * would render differently in each. Same cross-package-constant convention as
 * `FRAME_PLACEHOLDER_FALLBACK_FILL` (`CanvasNodeRenderer.tsx`).
 */
export const DEFAULT_RICH_TEXT_STYLE: RichTextStyleDefaults = {
	fontFamily: "Inter",
	fontSize: 16,
	fontWeight: "400",
	italic: false,
	underline: false,
	strikethrough: false,
	letterSpacing: 0,
	textTransform: "none",
	fill: "#000000",
	lineHeight: 1.4,
	align: "left",
};

/**
 * Apply a span's `textTransform` to its displayed string. Mirrors core's
 * private `applyTextTransform` (`serialize/svg.ts`) so the stage cases text
 * the same way an SVG export does; the IR's `span.text` itself is never
 * rewritten, only what gets painted.
 */
export function applyRichTextTransform(
	text: string,
	transform: RichTextTransform,
): string {
	switch (transform) {
		case "uppercase":
			return text.toUpperCase();
		case "lowercase":
			return text.toLowerCase();
		case "capitalize":
			return text.replace(
				/(^|\s)(\S)/g,
				(_m, lead: string, ch: string) => lead + ch.toUpperCase(),
			);
		default:
			return text;
	}
}
