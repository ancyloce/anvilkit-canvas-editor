import { createCanvasIR, createPage } from "@anvilkit/canvas-core";
import { describe, expect, it, vi } from "vitest";
import { rasterizePage } from "@/render/rasterize-page.js";
import { pdfExporter } from "../exporters.js";
import type { CanvasExportContext, CanvasExportRequest } from "../types.js";
import { CanvasExportCancelledError } from "../types.js";

const PNG_1X1 =
	"data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";

vi.mock("@/render/rasterize-page.js", () => ({
	rasterizePage: vi.fn(),
	RasterizePageCancelledError: class RasterizePageCancelledError extends Error {},
}));

function fixture(): CanvasExportContext {
	const ir = createCanvasIR({
		id: "pdf-resource-doc",
		pages: [createPage({ id: "p1" }), createPage({ id: "p2" })],
		now: () => "2026-08-27T00:00:00.000Z",
	});
	return { ir, activePageId: "p1", stage: null };
}

function request(isCancelled?: () => boolean): CanvasExportRequest {
	return {
		quality: 0.92,
		resolution: 1,
		stripMetadata: true,
		...(isCancelled ? { isCancelled } : {}),
	};
}

describe("pdfExporter incremental resource handling", () => {
	it("rasterizes each page lazily while the PDF serializer consumes it", async () => {
		vi.mocked(rasterizePage).mockImplementation(async ({ page }) => ({
			url: PNG_1X1,
			mimeType: "image/png",
		}));

		const artifact = await pdfExporter(fixture(), request());
		expect(rasterizePage).toHaveBeenCalledTimes(2);
		expect(
			vi.mocked(rasterizePage).mock.calls.map(([input]) => input.page.id),
		).toEqual(["p1", "p2"]);
		expect(artifact.mimeType).toBe("application/pdf");
	});

	it("cancels after an in-flight page and never starts the next page", async () => {
		let cancelled = false;
		let release!: () => void;
		const held = new Promise<void>((resolve) => {
			release = resolve;
		});
		vi.mocked(rasterizePage).mockImplementation(async () => {
			await held;
			return { url: PNG_1X1, mimeType: "image/png" };
		});

		const result = pdfExporter(
			fixture(),
			request(() => cancelled),
		);
		await vi.waitFor(() => expect(rasterizePage).toHaveBeenCalledTimes(1));
		cancelled = true;
		release();
		await expect(result).rejects.toBeInstanceOf(CanvasExportCancelledError);
		expect(rasterizePage).toHaveBeenCalledTimes(1);
	});
});
