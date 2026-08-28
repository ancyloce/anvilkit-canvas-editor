import {
	CanvasExportLimitError,
	createCanvasIR,
	createPage,
} from "@anvilkit/canvas-core";
import { afterEach, describe, expect, it, vi } from "vitest";
import { rasterizePage } from "@/render/rasterize-page.js";
import { makeHarness } from "@/tools/__tests__/_tool-test-helpers.js";
import { createCanvasStudioActions } from "../export-action.js";
import { CanvasExportEmptyError } from "../types.js";

vi.mock("@/render/rasterize-page.js", () => ({
	rasterizePage: vi.fn(async () => ({
		url: "data:image/png;base64,STUB",
		mimeType: "image/png",
	})),
}));

afterEach(() => {
	vi.clearAllMocks();
});

const FIXED_TS = "2026-05-20T00:00:00.000Z";

function twoPageIR() {
	return createCanvasIR({
		id: "doc-headless",
		pages: [createPage({ id: "p1" }), createPage({ id: "p2" })],
		now: () => FIXED_TS,
	});
}

interface JsonIrShape {
	pages: Array<{ id: string }>;
}

/**
 * §11.2 headless `export()` — the missing public API this package's audit
 * flagged: `CanvasStudioActions.export(request): Promise<CanvasExportResult>`
 * resolving REAL artifacts without opening the dialog UI or touching
 * `export-store.ts`'s progress state.
 */
describe("CanvasStudioActions.export() — headless export (§11.2)", () => {
	it("resolves a real CanvasExportResult for the default 'current' scope", async () => {
		const h = makeHarness({ ir: twoPageIR() });
		const actions = createCanvasStudioActions(h.studioCtx);
		const result = await actions.export({ format: "json" });
		expect(result.format).toBe("json");
		expect(result.artifacts).toHaveLength(1);
		const artifact = result.artifacts[0];
		expect(artifact?.filename.endsWith(".json")).toBe(true);
		expect(artifact?.blob).toBeInstanceOf(Blob);
		expect(artifact?.pageId).toBeUndefined(); // whole-doc format
		const parsed = JSON.parse(
			(await artifact?.blob.text()) ?? "{}",
		) as JsonIrShape;
		expect(parsed.pages).toHaveLength(1); // "current" scope, not the whole doc
	});

	it("scope 'all' packs every page into the one JSON artifact", async () => {
		const h = makeHarness({ ir: twoPageIR() });
		const actions = createCanvasStudioActions(h.studioCtx);
		const result = await actions.export({ format: "json", scope: "all" });
		const parsed = JSON.parse(
			(await result.artifacts[0]?.blob.text()) ?? "{}",
		) as JsonIrShape;
		expect(parsed.pages.map((p) => p.id)).toEqual(["p1", "p2"]);
	});

	it("exports print PDF as one default-built-in artifact", async () => {
		const h = makeHarness({ ir: twoPageIR() });
		const actions = createCanvasStudioActions(h.studioCtx);
		const result = await actions.export({ format: "pdf-print", scope: "all" });
		expect(result.format).toBe("pdf-print");
		expect(result.artifacts).toHaveLength(1);
		expect(result.artifacts[0]?.filename).toMatch(/\.print\.pdf$/);
		expect(result.artifacts[0]?.blob.type).toBe("application/pdf");
		expect(rasterizePage).toHaveBeenCalledTimes(2);
	});

	it("scope 'pages' scopes the export to exactly the given page ids (FR-152)", async () => {
		const h = makeHarness({ ir: twoPageIR() });
		const actions = createCanvasStudioActions(h.studioCtx);
		const result = await actions.export({
			format: "json",
			scope: "pages",
			pageIds: ["p2"],
		});
		const parsed = JSON.parse(
			(await result.artifacts[0]?.blob.text()) ?? "{}",
		) as JsonIrShape;
		expect(parsed.pages.map((p) => p.id)).toEqual(["p2"]);
	});

	it("rejects with CanvasExportEmptyError when scope 'selection' has nothing selected", async () => {
		const h = makeHarness({ ir: twoPageIR() });
		const actions = createCanvasStudioActions(h.studioCtx);
		await expect(
			actions.export({ format: "json", scope: "selection" }),
		).rejects.toBeInstanceOf(CanvasExportEmptyError);
	});

	it("rejects with CanvasExportEmptyError when scope 'pages' matches no page", async () => {
		const h = makeHarness({ ir: twoPageIR() });
		const actions = createCanvasStudioActions(h.studioCtx);
		await expect(
			actions.export({ format: "json", scope: "pages", pageIds: ["nope"] }),
		).rejects.toBeInstanceOf(CanvasExportEmptyError);
	});

	it("still exposes every CanvasEditorActions method alongside export()", () => {
		const h = makeHarness({ ir: twoPageIR() });
		const actions = createCanvasStudioActions(h.studioCtx);
		expect(typeof actions.zoomIn).toBe("function");
		expect(typeof actions.requestExport).toBe("function");
		expect(typeof actions.deleteSelection).toBe("function");
		expect(typeof actions.export).toBe("function");
	});

	// PRD §11.1: the other previously-missing public API this package's audit
	// flagged — `CanvasStudioProps.onExport` fires for BOTH this headless
	// action's resolution and the export dialog's user-driven export
	// (`ExportDialog.test.tsx` covers the dialog half).
	it("fires ctx.onExport with the SAME CanvasExportResult the promise resolves to (§11.1)", async () => {
		const h = makeHarness({ ir: twoPageIR() });
		const onExport = vi.fn();
		const ctx = { ...h.studioCtx, onExport };
		const actions = createCanvasStudioActions(ctx);
		const result = await actions.export({ format: "json", scope: "all" });
		expect(onExport).toHaveBeenCalledTimes(1);
		expect(onExport).toHaveBeenCalledWith(result);
	});

	it("does not fire onExport when the export rejects (empty selection)", async () => {
		const h = makeHarness({ ir: twoPageIR() });
		const onExport = vi.fn();
		const ctx = { ...h.studioCtx, onExport };
		const actions = createCanvasStudioActions(ctx);
		await expect(
			actions.export({ format: "json", scope: "selection" }),
		).rejects.toBeInstanceOf(CanvasExportEmptyError);
		expect(onExport).not.toHaveBeenCalled();
	});

	it("rejects an over-budget raster request before invoking the rasterizer", async () => {
		const h = makeHarness({ ir: twoPageIR() });
		const actions = createCanvasStudioActions(h.studioCtx);
		await expect(
			actions.export({
				format: "png",
				exportLimits: { maxPixelsPerPage: 1 },
			}),
		).rejects.toBeInstanceOf(CanvasExportLimitError);
		expect(rasterizePage).not.toHaveBeenCalled();
	});
});
