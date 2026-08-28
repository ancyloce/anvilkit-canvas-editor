import {
	createCanvasIR,
	createImage,
	createPage,
	createRect,
	createText,
} from "@anvilkit/canvas-core";
import { afterEach, describe, expect, it, vi } from "vitest";
import { rasterizePage } from "@/render/rasterize-page.js";
import { pdfPrintExporter } from "../exporters.js";
import type { CanvasExportContext, CanvasExportRequest } from "../types.js";

const PNG_1X1 =
	"data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";

vi.mock("@/render/rasterize-page.js", () => ({
	rasterizePage: vi.fn(async () => ({
		url: PNG_1X1,
		mimeType: "image/png",
	})),
	RasterizePageCancelledError: class RasterizePageCancelledError extends Error {},
}));

afterEach(() => vi.clearAllMocks());

function fixture(): CanvasExportContext {
	const page = createPage({
		id: "p1",
		size: { width: 1200, height: 1200, unit: "px", dpi: 96 },
	});
	page.root.children.push(
		createImage({
			id: "low-res",
			assetId: "photo",
			bounds: { width: 800, height: 800 },
			transform: { x: 200, y: 200 },
		}),
		createText({
			id: "missing-font",
			text: "Print",
			fontFamily: "Missing Sans",
			bounds: { width: 200, height: 40 },
			transform: { x: 0, y: 0 },
		}),
		{
			...createRect({
				id: "blurred",
				bounds: { width: 100, height: 100 },
				transform: { x: 300, y: 300 },
			}),
			effects: [{ type: "blur", radius: 5 }],
		},
	);
	const ir = createCanvasIR({
		id: "print-preflight",
		pages: [page],
		now: () => "2026-08-28T00:00:00.000Z",
	});
	ir.assets.photo = {
		id: "photo",
		uri: "https://example.invalid/photo.png",
		width: 100,
		height: 100,
	};
	return {
		ir,
		activePageId: "p1",
		stage: null,
		fontCatalog: { entries: [], get: () => undefined },
	};
}

function request(): CanvasExportRequest {
	return {
		quality: 0.92,
		resolution: 1,
		stripMetadata: true,
		print: { capabilities: { raster: true, vector: false } },
	};
}

describe("pdfPrintExporter print preflight", () => {
	it("surfaces all preflight classes without mutating the document", async () => {
		const context = fixture();
		const before = JSON.stringify(context.ir);
		const artifact = await pdfPrintExporter(context, request());
		const codes = new Set(artifact.warnings?.map((warning) => warning.code));
		for (const expected of [
			"PRINT_BLEED_INSUFFICIENT",
			"PRINT_MARGIN_INSUFFICIENT",
			"PRINT_CONTENT_OUTSIDE_SAFE_AREA",
			"PRINT_IMAGE_RESOLUTION_LOW",
			"PRINT_FONT_MISSING",
			"PRINT_EFFECT_UNSUPPORTED",
		]) {
			expect(codes).toContain(expected);
		}
		expect(rasterizePage).toHaveBeenCalledTimes(1);
		expect(JSON.stringify(context.ir)).toBe(before);
	});
});
