import type {
	RichTextParagraph,
	RichTextStyleDefaults,
	TextMeasureRequest,
} from "@anvilkit/canvas-core";
import { describe, expect, it } from "vitest";
import { layoutRichText } from "../rich-text-layout.js";

/**
 * jsdom canvas metrics are unreliable on this box, so every test here drives
 * `layoutRichText` with a deterministic stub instead of a real Canvas2D
 * context: `charWidth` per character, ignoring font family entirely, scaling
 * with `fontSize` only when a test cares about it.
 */
const CHAR_WIDTH = 10;
const stubMeasure = (text: string) => text.length * CHAR_WIDTH;
const fontSizeMeasure = (text: string, style: { fontSize: number }) =>
	text.length * style.fontSize;

const DEFAULTS: RichTextStyleDefaults = {
	fontFamily: "Inter",
	fontSize: 16,
	fontWeight: "400",
	italic: false,
	underline: false,
	letterSpacing: 0,
	textTransform: "none",
	fill: "#000000",
	lineHeight: 1.4,
	align: "left",
};

function request(
	paragraphs: RichTextParagraph[],
	overrides: Partial<Omit<TextMeasureRequest, "paragraphs">> = {},
): TextMeasureRequest {
	return {
		paragraphs,
		width: 1000,
		wrap: "word",
		defaults: DEFAULTS,
		...overrides,
	};
}

describe("layoutRichText", () => {
	it("lays out a single unwrapped line when the content fits", () => {
		const result = layoutRichText(
			request([{ spans: [{ text: "Hello World" }] }]),
			stubMeasure,
		);
		expect(result.lines).toHaveLength(1);
		expect(result.lines[0]?.runs).toEqual([
			{
				paragraphIndex: 0,
				spanIndex: 0,
				start: 0,
				text: "Hello World",
				x: 0,
				width: "Hello World".length * CHAR_WIDTH,
			},
		]);
	});

	it("wraps at word boundaries when a line exceeds the width", () => {
		// "Hello World " = 12 chars = 120; "Foo" pushes past width=130.
		const result = layoutRichText(
			request([{ spans: [{ text: "Hello World Foo" }] }], { width: 130 }),
			stubMeasure,
		);
		expect(result.lines).toHaveLength(2);
		expect(result.lines[0]?.runs[0]?.text).toBe("Hello World");
		expect(result.lines[1]?.runs[0]?.text).toBe("Foo");
		// Leading whitespace of the wrapped line is dropped, trailing of the
		// first line trimmed — neither line carries the separating space.
		expect(result.lines[1]?.runs[0]?.start).toBe(12);
	});

	it("never breaks a word mid-way under word wrap, even if it overflows", () => {
		const result = layoutRichText(
			request([{ spans: [{ text: "Supercalifragilistic" }] }], { width: 50 }),
			stubMeasure,
		);
		expect(result.lines).toHaveLength(1);
		expect(result.lines[0]?.width).toBeGreaterThan(50);
	});

	it("breaks anywhere under character wrap", () => {
		const result = layoutRichText(
			request([{ spans: [{ text: "Supercalifragilistic" }] }], {
				width: 50,
				wrap: "character",
			}),
			stubMeasure,
		);
		// width=50 / CHAR_WIDTH=10 => 5 chars per line.
		expect(result.lines.length).toBeGreaterThan(1);
		expect(result.lines[0]?.runs[0]?.text).toHaveLength(5);
	});

	it("never breaks under wrap 'none', even past the requested width", () => {
		const result = layoutRichText(
			request([{ spans: [{ text: "Hello World Foo Bar Baz" }] }], {
				width: 50,
				wrap: "none",
			}),
			stubMeasure,
		);
		expect(result.lines).toHaveLength(1);
		expect(result.width).toBeGreaterThan(50);
	});

	it("splits a single span into per-line runs when it wraps", () => {
		const result = layoutRichText(
			request([{ spans: [{ text: "AAAAA BBBBB" }] }], { width: 60 }),
			stubMeasure,
		);
		expect(result.lines).toHaveLength(2);
		expect(result.lines[0]?.runs).toEqual([
			{
				paragraphIndex: 0,
				spanIndex: 0,
				start: 0,
				text: "AAAAA",
				x: 0,
				width: 50,
			},
		]);
		expect(result.lines[1]?.runs).toEqual([
			{
				paragraphIndex: 0,
				spanIndex: 0,
				start: 6,
				text: "BBBBB",
				x: 0,
				width: 50,
			},
		]);
	});

	it("keeps two spans on one line as two separate contiguous runs", () => {
		const result = layoutRichText(
			request([{ spans: [{ text: "Hello " }, { text: "World" }] }]),
			stubMeasure,
		);
		expect(result.lines[0]?.runs).toHaveLength(2);
		expect(result.lines[0]?.runs[0]).toMatchObject({
			spanIndex: 0,
			text: "Hello ",
		});
		expect(result.lines[0]?.runs[1]).toMatchObject({
			spanIndex: 1,
			text: "World",
			x: 60,
		});
	});

	it("applies letter-spacing on top of the raw glyph width", () => {
		const spaced = layoutRichText(
			request([{ spans: [{ text: "AB", letterSpacing: 3 }] }]),
			stubMeasure,
		);
		const unspaced = layoutRichText(
			request([{ spans: [{ text: "AB" }] }]),
			stubMeasure,
		);
		expect(spaced.lines[0]?.runs[0]?.width).toBe(
			(unspaced.lines[0]?.runs[0]?.width ?? 0) + 3 * 2,
		);
	});

	it("resolves align to a per-line x offset", () => {
		const spans = [{ text: "Hi" }]; // width = 20
		const left = layoutRichText(
			request([{ align: "left", spans }], { width: 100 }),
			stubMeasure,
		);
		const center = layoutRichText(
			request([{ align: "center", spans }], { width: 100 }),
			stubMeasure,
		);
		const right = layoutRichText(
			request([{ align: "right", spans }], { width: 100 }),
			stubMeasure,
		);
		expect(left.lines[0]?.x).toBe(0);
		expect(center.lines[0]?.x).toBe(40);
		expect(right.lines[0]?.x).toBe(80);
	});

	it("scales line height by the paragraph's lineHeight multiple and the max span font size", () => {
		const result = layoutRichText(
			request([
				{
					lineHeight: 2,
					spans: [
						{ text: "big", fontSize: 20 },
						{ text: "small", fontSize: 10 },
					],
				},
			]),
			fontSizeMeasure,
		);
		expect(result.lines[0]?.height).toBe(20 * 2);
		expect(result.lines[0]?.baseline).toBe(20 * 0.8);
	});

	it("gives an empty paragraph one blank line sized from the default font size", () => {
		const result = layoutRichText(request([{ spans: [] }]), stubMeasure);
		expect(result.lines).toHaveLength(1);
		expect(result.lines[0]?.runs).toEqual([]);
		expect(result.lines[0]?.height).toBe(
			DEFAULTS.fontSize * DEFAULTS.lineHeight,
		);
	});

	it("stacks multiple paragraphs vertically and reports the widest line", () => {
		const result = layoutRichText(
			request([
				{ spans: [{ text: "Short" }] },
				{ spans: [{ text: "A longer paragraph" }] },
			]),
			stubMeasure,
		);
		expect(result.lines).toHaveLength(2);
		expect(result.lines[1]?.y).toBe(result.lines[0]?.height);
		expect(result.height).toBe(
			(result.lines[0]?.height ?? 0) + (result.lines[1]?.height ?? 0),
		);
		expect(result.width).toBe("A longer paragraph".length * CHAR_WIDTH);
	});
});
