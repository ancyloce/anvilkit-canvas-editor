import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

function source(relativeUrl: string): string {
	return readFileSync(new URL(relativeUrl, import.meta.url), "utf8");
}

describe("export worker feasibility boundary", () => {
	it("keeps cost estimation and print preflight worker-safe", () => {
		const coreSources = [
			source("../../../../core/src/export/cost.ts"),
			source("../../../../core/src/print-preflight.ts"),
		];

		for (const coreSource of coreSources) {
			expect(coreSource).not.toMatch(
				/from ["'](?:react|react-dom|react-konva|konva)["']|\b(?:document|window|HTMLCanvasElement|OffscreenCanvas)\b/,
			);
		}
	});

	it("records the DOM and React dependencies that keep Konva rasterization on the main thread", () => {
		const rasterizer = source("../../render/rasterize-page.tsx");

		expect(rasterizer).toContain('from "react-dom/client"');
		expect(rasterizer).toContain('from "react-konva"');
		expect(rasterizer).toContain('import type Konva from "konva"');
		expect(rasterizer).toContain('document.createElement("div")');
		expect(rasterizer).toContain("document.fonts");
		expect(rasterizer).toContain("requestAnimationFrame");
		expect(rasterizer).toContain("readyStage.toDataURL");
	});

	it("preserves incremental rasterize-then-embed ownership instead of retaining a worker batch", () => {
		const editorExporter = source("../exporters.ts");
		const pdfSerializer = source("../../../../core/src/serialize/pdf.ts");
		const providerStart = editorExporter.indexOf("rasterProvider: async (page)");
		const serializerCall = editorExporter.indexOf("serializeDocumentToPdf(ir");

		expect(serializerCall).toBeGreaterThan(-1);
		expect(providerStart).toBeGreaterThan(serializerCall);
		expect(editorExporter.slice(providerStart)).toContain("rasterizePage({");
		expect(pdfSerializer).toContain("await options.rasterProvider(page, pageIndex)");
		expect(pdfSerializer).toContain(
			"options.onRasterReleased?.(page, pageIndex)",
		);
	});
});
