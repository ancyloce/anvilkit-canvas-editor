import type { CanvasExportDiagnostic } from "@anvilkit/canvas-core";
import {
	CanvasExportDiagnosticError,
	createCanvasIR,
	createPage,
	createText,
} from "@anvilkit/canvas-core";
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CanvasStudioContext } from "@/context/canvas-studio-context.js";
import { rasterizePage } from "@/render/rasterize-page.js";
import { makeHarness } from "@/tools/__tests__/_tool-test-helpers.js";
import { ExportMenu } from "../ExportMenu.js";
import { createCanvasStudioActions } from "../export-action.js";
import type { CanvasExporter, CanvasExportFormat } from "../types.js";
import { CanvasExportCancelledError } from "../types.js";

vi.mock("@/render/rasterize-page.js", () => ({
	rasterizePage: vi.fn(),
	RasterizePageCancelledError: class RasterizePageCancelledError extends Error {},
}));

afterEach(() => {
	cleanup();
	vi.clearAllMocks();
});

describe("standard export diagnostics", () => {
	it("rejects an unsupported runtime format with a typed diagnostic", async () => {
		const h = makeHarness();
		const before = JSON.stringify(h.studioCtx.getIR());
		const actions = createCanvasStudioActions(h.studioCtx);
		const promise = actions.export({
			format: "tiff" as CanvasExportFormat,
		});
		await expect(promise).rejects.toMatchObject({
			code: "CANVAS_EXPORT_UNSUPPORTED_FORMAT",
			diagnostic: { category: "unsupported-format" },
		});
		expect(JSON.stringify(h.studioCtx.getIR())).toBe(before);
		expect(h.studioCtx.historyStore.getState().canUndo()).toBe(false);
	});

	it("classifies a built-in raster crash and leaves document/history unchanged", async () => {
		vi.mocked(rasterizePage).mockRejectedValueOnce(new Error("canvas crashed"));
		const h = makeHarness();
		const before = JSON.stringify(h.studioCtx.getIR());
		const actions = createCanvasStudioActions(h.studioCtx);
		const promise = actions.export({ format: "png" });
		await expect(promise).rejects.toBeInstanceOf(CanvasExportDiagnosticError);
		await expect(promise).rejects.toMatchObject({
			code: "CANVAS_EXPORT_RENDER_FAILED",
			diagnostic: { category: "rendering-failure" },
		});
		expect(JSON.stringify(h.studioCtx.getIR())).toBe(before);
		expect(h.studioCtx.historyStore.getState().past).toHaveLength(0);
	});

	it("passes provider failures to onError as a distinct diagnostic", async () => {
		const h = makeHarness();
		const provider: CanvasExporter = () => {
			throw new Error("provider offline");
		};
		const onError =
			vi.fn<
				(
					error: unknown,
					format: CanvasExportFormat,
					diagnostic: CanvasExportDiagnostic,
				) => void
			>();
		const view = render(
			<CanvasStudioContext.Provider value={h.studioCtx}>
				<ExportMenu
					exporters={{ svg: provider }}
					formats={["svg"]}
					onError={onError}
				/>
			</CanvasStudioContext.Provider>,
		);
		fireEvent.click(view.getByTestId("canvas-export-trigger"));
		fireEvent.click(view.getByTestId("canvas-export-save"));
		await waitFor(() => expect(onError).toHaveBeenCalledTimes(1));
		expect(onError.mock.calls[0]?.[2]).toMatchObject({
			code: "CANVAS_EXPORT_PROVIDER_FAILED",
			category: "provider-failure",
		});
	});

	it("attaches normalized missing-font diagnostics to successful results", async () => {
		const page = createPage({ id: "p1" });
		page.root.children.push(
			createText({
				id: "title",
				text: "Missing",
				fontFamily: "Unavailable Sans",
				bounds: { width: 200, height: 40 },
			}),
		);
		const ir = createCanvasIR({
			id: "missing-font",
			pages: [page],
			now: () => "2026-08-28T00:00:00.000Z",
		});
		const h = makeHarness({ ir });
		const result = await createCanvasStudioActions(h.studioCtx).export({
			format: "svg",
		});
		expect(result.diagnostics).toContainEqual(
			expect.objectContaining({
				code: "CANVAS_EXPORT_MISSING_FONT",
				category: "missing-font",
				sourceCode: "FONT_NOT_IN_MANIFEST",
			}),
		);
	});

	it("gives cancellation its stable diagnostic code", () => {
		const error = new CanvasExportCancelledError();
		expect(error).toMatchObject({
			code: "CANVAS_EXPORT_CANCELLED",
			diagnostic: { category: "cancellation" },
		});
	});
});
