import type {
	RichTextParagraph,
	TextMeasureRequest,
} from "@anvilkit/canvas-core";
import { afterEach, describe, expect, it } from "vitest";
import {
	createCanvasLayoutMeasurementProvider,
	createCanvasTextMeasurer,
} from "../canvas-text-measurer.js";
import {
	fontManifestHash,
	observeFontFamily,
	resetFontStatusesForTests,
} from "../font-status.js";
import { DEFAULT_RICH_TEXT_STYLE } from "../rich-text-style.js";

/**
 * @file T-M3-04 step 5 — the editor's `CanvasLayoutMeasurementProvider`.
 * The provider, the SVG-export measurer, and the stage all route through the
 * editor's ONE cache; cache hits are observable as reference-identical
 * `MeasuredText` results, no spies needed. Each test builds its own
 * `paragraphs` array — the cache is module-global and keyed on that
 * reference, so sharing one across tests would couple them.
 */

function makeRequest(): () => TextMeasureRequest {
	const paragraphs: RichTextParagraph[] = [
		{ spans: [{ text: "The quick brown fox" }] },
	];
	return () => ({
		paragraphs,
		width: 120,
		wrap: "word",
		defaults: DEFAULT_RICH_TEXT_STYLE,
	});
}

afterEach(() => {
	resetFontStatusesForTests();
});

describe("createCanvasLayoutMeasurementProvider", () => {
	it("shares the one measurement cache with the export measurer", () => {
		const request = makeRequest();
		const provider = createCanvasLayoutMeasurementProvider();
		const exportMeasurer = createCanvasTextMeasurer();

		const fromProvider = provider.measureText(request());
		const again = provider.measureText(request());
		const fromExport = exportMeasurer(request());

		expect(fromProvider.lines.length).toBeGreaterThan(0);
		expect(again).toBe(fromProvider);
		expect(fromExport).toBe(fromProvider);
	});

	it("reports the live font-manifest hash", () => {
		const provider = createCanvasLayoutMeasurementProvider();
		const before = provider.manifestHash;
		observeFontFamily("Provider-Test-Family");
		expect(provider.manifestHash).toBe(fontManifestHash());
		expect(provider.manifestHash).not.toBe(before);
	});

	it("re-measures after a font lifecycle transition instead of serving pre-load metrics", () => {
		const request = makeRequest();
		const provider = createCanvasLayoutMeasurementProvider();
		const before = provider.measureText(request());
		observeFontFamily("Another-Test-Family");
		const after = provider.measureText(request());
		expect(after).not.toBe(before);
		// Same content and environment → same geometry, freshly computed.
		expect(after.width).toBe(before.width);
	});
});
