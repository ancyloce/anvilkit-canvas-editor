import { createCanvasIR, createPage } from "@anvilkit/canvas-core";
import type Konva from "konva";
import { describe, expect, it, vi } from "vitest";
import {
	DEFAULT_CANVAS_EXPORTERS,
	jpegExporter,
	jsonExporter,
	pngExporter,
	webpExporter,
} from "../exporters.js";

const NOW = "2026-01-01T00:00:00.000Z";

function fixture() {
	const ir = createCanvasIR({
		id: "doc-1",
		title: "Poster",
		pages: [createPage({ id: "p1" })],
		now: () => NOW,
	});
	const toDataURL = vi.fn(
		(opts: { mimeType?: string }) =>
			`data:${opts.mimeType ?? "image/png"};base64,AAAA`,
	);
	const stage = { toDataURL } as unknown as Konva.Stage;
	return { ir, stage, toDataURL };
}

describe("built-in raster exporters (B-18, AC-010)", () => {
	it("png/jpeg/webp map format → mimeType, extension, and pixel ratio", () => {
		const { ir, stage, toDataURL } = fixture();
		const cases = [
			{ exporter: pngExporter, mime: "image/png", ext: "png" },
			{ exporter: jpegExporter, mime: "image/jpeg", ext: "jpg" },
			{ exporter: webpExporter, mime: "image/webp", ext: "webp" },
		] as const;
		for (const { exporter, mime, ext } of cases) {
			const artifact = exporter(
				{ ir, stage, pageId: "p1" },
				{ resolution: 2, quality: 0.8, transparent: false },
			);
			expect(artifact.mimeType).toBe(mime);
			expect(artifact.filename).toBe(`Poster.${ext}`);
			expect(String(artifact.data)).toContain(mime);
		}
		// resolution 2 → pixelRatio 4 (2× retina base) on every call.
		for (const call of toDataURL.mock.calls) {
			expect((call[0] as { pixelRatio: number }).pixelRatio).toBe(4);
		}
	});

	it("quality reaches the lossy formats but never PNG", () => {
		const { ir, stage, toDataURL } = fixture();
		pngExporter(
			{ ir, stage, pageId: "p1" },
			{
				resolution: 1,
				quality: 0.5,
				transparent: false,
			},
		);
		jpegExporter(
			{ ir, stage, pageId: "p1" },
			{
				resolution: 1,
				quality: 0.5,
				transparent: false,
			},
		);
		const [pngCall, jpegCall] = toDataURL.mock.calls;
		expect(pngCall?.[0]).not.toHaveProperty("quality");
		expect(jpegCall?.[0]).toMatchObject({ quality: 0.5 });
	});

	it("raster exporters throw without a stage; json works stage-free", () => {
		const { ir } = fixture();
		expect(() =>
			jpegExporter(
				{ ir, stage: null, pageId: "p1" },
				{
					resolution: 1,
					quality: 1,
					transparent: false,
				},
			),
		).toThrow(/JPG export needs a ready Konva stage/i);
		const artifact = jsonExporter(
			{ ir, stage: null, pageId: "p1" },
			{
				resolution: 1,
				quality: 1,
				transparent: false,
			},
		);
		expect(artifact.mimeType).toBe("application/json");
	});

	it("the default exporter map covers png/jpeg/webp/json", () => {
		expect(Object.keys(DEFAULT_CANVAS_EXPORTERS).sort()).toEqual([
			"jpeg",
			"json",
			"png",
			"webp",
		]);
	});
});
