import {
	createCanvasIR,
	createGroup,
	createPage,
	createRichText,
	type RichTextParagraph,
	serializePageToSvg,
} from "@anvilkit/canvas-core";
import { describe, expect, it } from "vitest";
import { measureGlyphWidth } from "../canvas-glyph-measurer.js";
import { createCanvasTextMeasurer } from "../canvas-text-measurer.js";
import { layoutRichText } from "../rich-text-layout.js";
import { DEFAULT_RICH_TEXT_STYLE } from "../rich-text-style.js";

/**
 * The acceptance criterion for canvas-m1-008 is that the stage and an SVG
 * export produced with the exported measurer break lines identically for the
 * same document. Both paths run through `layoutRichText` + `measureGlyphWidth`
 * — this test proves that by comparing a direct call against what
 * `serializePageToSvg`'s measured-line path (`emitRichText` /
 * `emitMeasuredLines`) actually emits.
 */
describe("createCanvasTextMeasurer parity with core's SVG export", () => {
	const paragraphs: RichTextParagraph[] = [
		{
			spans: [
				{ text: "The quick brown fox jumps over " },
				{ text: "the lazy dog", fontWeight: "700" },
			],
		},
	];
	const width = 220;

	it("produces the exact same run breakdown the stage layout computes", async () => {
		const expected = layoutRichText(
			{ paragraphs, width, wrap: "word", defaults: DEFAULT_RICH_TEXT_STYLE },
			measureGlyphWidth,
		);
		const expectedRuns = expected.lines.flatMap((line) => line.runs);
		// Sanity: this document actually wraps and splits into multiple runs —
		// otherwise the test would trivially pass with one giant tspan.
		expect(expected.lines.length).toBeGreaterThan(1);
		expect(expectedRuns.length).toBeGreaterThan(2);

		const node = createRichText({
			bounds: { width, height: 200 },
			width,
			wrap: "word",
			paragraphs,
		});
		const ir = createCanvasIR({
			pages: [
				createPage({
					root: createGroup({
						bounds: { width: 400, height: 400 },
						children: [node],
					}),
				}),
			],
		});

		const { svg } = await serializePageToSvg(ir, 0, {
			textMeasurer: createCanvasTextMeasurer(),
		});

		const doc = new DOMParser().parseFromString(svg, "image/svg+xml");
		const tspans = Array.from(doc.querySelectorAll("tspan"));

		expect(tspans).toHaveLength(expectedRuns.length);
		tspans.forEach((tspan, i) => {
			expect(tspan.textContent).toBe(expectedRuns[i]?.text);
		});
	});
});
