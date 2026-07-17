import {
	type CanvasIR,
	createCanvasIR,
	createGroup,
	createPage,
	createRect,
} from "@anvilkit/canvas-core";
import {
	cleanup,
	fireEvent,
	render,
	screen,
	waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CanvasStudioContext } from "@/context/canvas-studio-context.js";
import {
	CanvasToastContext,
	type CanvasToastInput,
} from "@/context/toast-context.js";
import { rasterizePage } from "@/render/rasterize-page.js";
import { createExportRequestStore } from "@/stores/export-request-store.js";
import { makeHarness } from "@/tools/__tests__/_tool-test-helpers.js";
import { ExportDialogTrigger } from "../ExportDialogTrigger.js";
import type { CanvasExporter } from "../types.js";
import { CanvasExportCancelledError } from "../types.js";

// Bug 1 + Bug 3 raster coverage below drives PNG (the dialog's default
// format) without needing a real Konva stage — no existing test in this file
// exercises the real rasterizer (they all switch away from PNG), so mocking
// it file-wide is safe.
vi.mock("@/render/rasterize-page.js", () => ({
	rasterizePage: vi.fn(async () => ({
		url: "data:image/png;base64,STUB",
		mimeType: "image/png",
	})),
}));

afterEach(() => {
	cleanup();
	vi.restoreAllMocks();
	vi.mocked(rasterizePage).mockClear();
});

const FIXED_TS = "2026-05-20T00:00:00.000Z";

function twoPageIR(): CanvasIR {
	return createCanvasIR({
		id: "doc-x",
		pages: [createPage({ id: "p1" }), createPage({ id: "p2" })],
		now: () => FIXED_TS,
	});
}

function setup(exporters: Partial<Record<string, CanvasExporter>> = {}) {
	const h = makeHarness({ ir: twoPageIR() });
	render(
		<CanvasStudioContext.Provider value={h.studioCtx}>
			<ExportDialogTrigger exporters={exporters} />
		</CanvasStudioContext.Provider>,
	);
	return h;
}

async function openDialog(): Promise<void> {
	fireEvent.click(screen.getByTestId("workspace-export"));
	// The dialog is a lazy import() chunk; under CPU contention its resolution
	// can exceed RTL's default 1 s wait (recurring full-suite flake).
	await screen.findByTestId("export-dialog", undefined, { timeout: 15_000 });
}

describe("ExportDialog (B-09, FR-150..154)", () => {
	it("opens code-split, shows all six built-in formats, pages and scale controls", async () => {
		setup();
		await openDialog();
		// FR-151 / AC-010: all six formats export with no host wiring.
		expect(screen.getByTestId("export-format-png")).toBeTruthy();
		expect(screen.getByTestId("export-format-json")).toBeTruthy();
		expect(screen.getByTestId("export-format-svg")).toBeTruthy();
		expect(screen.getByTestId("export-format-pdf")).toBeTruthy();
		expect(screen.getByTestId("export-pages-current")).toBeTruthy();
		expect(screen.getByTestId("export-pages-all")).toBeTruthy();
		// FR-153 raster controls appear for the default (PNG) format.
		expect(screen.getByTestId("export-scale-2")).toBeTruthy();
		expect(screen.getByTestId("export-filename")).toBeTruthy();
	});

	it("exports all pages sequentially with an injected exporter and reports progress", async () => {
		const seenPages: string[] = [];
		const svg: CanvasExporter = ({ activePageId }) => {
			seenPages.push(activePageId);
			return { filename: "x.svg", data: "<svg/>", mimeType: "image/svg+xml" };
		};
		// jsdom: neutralize the download anchor click.
		vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(
			() => undefined,
		);
		const urlSpy = vi
			.spyOn(URL, "createObjectURL")
			.mockReturnValue("blob:mock");
		vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => undefined);
		setup({ svg });
		await openDialog();
		fireEvent.click(screen.getByTestId("export-format-svg"));
		fireEvent.click(screen.getByTestId("export-pages-all"));
		fireEvent.click(screen.getByTestId("export-run"));
		await waitFor(() => {
			expect(
				screen.getByTestId("export-progress").getAttribute("data-phase"),
			).toBe("completed");
		});
		expect(seenPages).toEqual(["p1", "p2"]);
		expect(urlSpy).toHaveBeenCalledTimes(2);
	});

	it("shows the PDF fidelity note (FR-151 disclosure)", async () => {
		const pdf: CanvasExporter = () => ({
			filename: "x.pdf",
			data: "%PDF",
			mimeType: "application/pdf",
		});
		setup({ pdf });
		await openDialog();
		fireEvent.click(screen.getByTestId("export-format-pdf"));
		expect(screen.getByTestId("export-fidelity-note").textContent).toContain(
			"not selectable",
		);
	});

	it("failed exports surface the FR-154 failed phase", async () => {
		const svg: CanvasExporter = () => {
			throw new Error("nope");
		};
		const onError = vi.fn();
		setup({ svg });
		render(<div />);
		await openDialog();
		fireEvent.click(screen.getByTestId("export-format-svg"));
		fireEvent.click(screen.getByTestId("export-run"));
		await waitFor(() => {
			expect(
				screen.getByTestId("export-progress").getAttribute("data-phase"),
			).toBe("failed");
		});
		expect(onError).toHaveBeenCalledTimes(0); // not wired in this render
	});

	it("whole-document JSON export honors the current-page scope (FR-152)", async () => {
		let seenPageCount = -1;
		const json: CanvasExporter = ({ ir }) => {
			seenPageCount = ir.pages.length;
			return { filename: "x.json", data: "{}", mimeType: "application/json" };
		};
		vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(
			() => undefined,
		);
		vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:mock");
		vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => undefined);
		setup({ json });
		await openDialog();
		fireEvent.click(screen.getByTestId("export-format-json"));
		// Default scope is "current page" → the scoped IR has exactly one page.
		fireEvent.click(screen.getByTestId("export-run"));
		await waitFor(() => {
			expect(
				screen.getByTestId("export-progress").getAttribute("data-phase"),
			).toBe("completed");
		});
		expect(seenPageCount).toBe(1);
	});

	it("all-pages JSON export passes every page to the exporter (FR-152)", async () => {
		let seenPageCount = -1;
		const json: CanvasExporter = ({ ir }) => {
			seenPageCount = ir.pages.length;
			return { filename: "x.json", data: "{}", mimeType: "application/json" };
		};
		vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(
			() => undefined,
		);
		vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:mock");
		vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => undefined);
		setup({ json });
		await openDialog();
		fireEvent.click(screen.getByTestId("export-format-json"));
		fireEvent.click(screen.getByTestId("export-pages-all"));
		fireEvent.click(screen.getByTestId("export-run"));
		await waitFor(() => {
			expect(
				screen.getByTestId("export-progress").getAttribute("data-phase"),
			).toBe("completed");
		});
		expect(seenPageCount).toBe(2);
	});

	it("disables the Selection scope when nothing is selected (FR-031)", async () => {
		setup();
		await openDialog();
		expect(
			screen.getByTestId("export-pages-selection").hasAttribute("disabled"),
		).toBe(true);
	});
});

describe("custom width x height pixel ratio (FR-153, Bug 1)", () => {
	it("threads an unlocked, non-proportional custom size through to the rasterizer as {x, y}", async () => {
		setup();
		await openDialog();
		// Default page size is 1080x1080 (createPage's default).
		fireEvent.click(screen.getByTestId("export-lock-aspect")); // unlock
		fireEvent.change(screen.getByTestId("export-width"), {
			target: { value: "1500" },
		});
		fireEvent.change(screen.getByTestId("export-height"), {
			target: { value: "600" },
		});
		fireEvent.click(screen.getByTestId("export-run"));
		await waitFor(() => {
			expect(
				screen.getByTestId("export-progress").getAttribute("data-phase"),
			).toBe("completed");
		});
		const call = vi.mocked(rasterizePage).mock.calls[0]?.[0];
		expect(call?.pixelRatio).toEqual({
			x: (1500 / 1080) * 2,
			y: (600 / 1080) * 2,
		});
	});

	it("still passes a single uniform pixelRatio number when width/height are unset", async () => {
		setup();
		await openDialog();
		fireEvent.click(screen.getByTestId("export-scale-2"));
		fireEvent.click(screen.getByTestId("export-run"));
		await waitFor(() => {
			expect(
				screen.getByTestId("export-progress").getAttribute("data-phase"),
			).toBe("completed");
		});
		const call = vi.mocked(rasterizePage).mock.calls[0]?.[0];
		expect(call?.pixelRatio).toBe(4);
	});
});

describe("Export Selection scoping across formats (Bug 2)", () => {
	function selectableIR(): CanvasIR {
		return createCanvasIR({
			id: "doc-sel",
			pages: [
				createPage({
					id: "p1",
					root: createGroup({
						id: "root",
						bounds: { width: 500, height: 500 },
						children: [
							createRect({
								id: "a",
								bounds: { width: 40, height: 30 },
								transform: { x: 10, y: 10 },
							}),
						],
					}),
				}),
			],
			now: () => FIXED_TS,
		});
	}

	function setupSelected(
		exporters: Partial<Record<string, CanvasExporter>> = {},
	) {
		const h = makeHarness({ ir: selectableIR() });
		h.studioCtx.selectionStore.getState().setSelection(["a"]);
		render(
			<CanvasStudioContext.Provider value={h.studioCtx}>
				<ExportDialogTrigger exporters={exporters} />
			</CanvasStudioContext.Provider>,
		);
		return h;
	}

	function mockDownloads(): void {
		vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(
			() => undefined,
		);
		vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:mock");
		vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => undefined);
	}

	it("SVG export of a selection does not throw and only sees the synthetic selection page", async () => {
		let seenIr: CanvasIR | null = null;
		let seenActivePageId = "";
		const svg: CanvasExporter = ({ ir, activePageId }) => {
			seenIr = ir;
			seenActivePageId = activePageId;
			return { filename: "sel.svg", data: "<svg/>", mimeType: "image/svg+xml" };
		};
		mockDownloads();
		setupSelected({ svg });
		await openDialog();
		fireEvent.click(screen.getByTestId("export-format-svg"));
		fireEvent.click(screen.getByTestId("export-pages-selection"));
		fireEvent.click(screen.getByTestId("export-run"));
		await waitFor(() => {
			expect(
				screen.getByTestId("export-progress").getAttribute("data-phase"),
			).toBe("completed"); // did NOT throw / fail
		});
		expect(seenIr).not.toBeNull();
		expect((seenIr as unknown as CanvasIR).pages).toHaveLength(1);
		expect((seenIr as unknown as CanvasIR).pages[0]?.id).toBe(seenActivePageId);
		expect((seenIr as unknown as CanvasIR).pages[0]?.id).not.toBe("p1");
	});

	it("PDF export of a selection is scoped to ONE synthetic page, not the whole document", async () => {
		let seenPageCount = -1;
		const pdf: CanvasExporter = ({ ir }) => {
			seenPageCount = ir.pages.length;
			return { filename: "sel.pdf", data: "%PDF", mimeType: "application/pdf" };
		};
		mockDownloads();
		setupSelected({ pdf });
		await openDialog();
		fireEvent.click(screen.getByTestId("export-format-pdf"));
		fireEvent.click(screen.getByTestId("export-pages-selection"));
		fireEvent.click(screen.getByTestId("export-run"));
		await waitFor(() => {
			expect(
				screen.getByTestId("export-progress").getAttribute("data-phase"),
			).toBe("completed");
		});
		expect(seenPageCount).toBe(1);
	});

	it("JSON export of a selection only serializes the synthetic selection page, not the original document", async () => {
		let seenPageIds: string[] = [];
		const json: CanvasExporter = ({ ir }) => {
			seenPageIds = ir.pages.map((p) => p.id);
			return { filename: "sel.json", data: "{}", mimeType: "application/json" };
		};
		mockDownloads();
		setupSelected({ json });
		await openDialog();
		fireEvent.click(screen.getByTestId("export-format-json"));
		fireEvent.click(screen.getByTestId("export-pages-selection"));
		fireEvent.click(screen.getByTestId("export-run"));
		await waitFor(() => {
			expect(
				screen.getByTestId("export-progress").getAttribute("data-phase"),
			).toBe("completed");
		});
		expect(seenPageIds).toHaveLength(1);
		expect(seenPageIds[0]).not.toBe("p1");
	});
});

describe('scope "pages" — FR-152 selected pages (Bug 3)', () => {
	function fourPageIR(): CanvasIR {
		return createCanvasIR({
			id: "doc-4",
			pages: [
				createPage({ id: "p1" }),
				createPage({ id: "p2" }),
				createPage({ id: "p3" }),
				createPage({ id: "p4" }),
			],
			now: () => FIXED_TS,
		});
	}

	function setupPagesScope(
		pageIds: string[],
		exporters: Partial<Record<string, CanvasExporter>> = {},
	) {
		const h = makeHarness({ ir: fourPageIR() });
		const exportRequestStore = createExportRequestStore();
		exportRequestStore.getState().request({ scope: "pages", pageIds });
		const studioCtx = { ...h.studioCtx, exportRequestStore };
		render(
			<CanvasStudioContext.Provider value={studioCtx}>
				<ExportDialogTrigger exporters={exporters} />
			</CanvasStudioContext.Provider>,
		);
		return h;
	}

	it("preselects the 'pages' scope and surfaces the selected count", async () => {
		setupPagesScope(["p2", "p4"]);
		await openDialog();
		const btn = screen.getByTestId("export-pages-selected");
		expect(btn.getAttribute("aria-pressed")).toBe("true");
		expect(btn.textContent).toContain("2");
	});

	it("JSON export is scoped to exactly the selected page ids, in order", async () => {
		let seenPageIds: string[] = [];
		const json: CanvasExporter = ({ ir }) => {
			seenPageIds = ir.pages.map((p) => p.id);
			return { filename: "x.json", data: "{}", mimeType: "application/json" };
		};
		vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(
			() => undefined,
		);
		vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:mock");
		vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => undefined);
		setupPagesScope(["p2", "p4"], { json });
		await openDialog();
		fireEvent.click(screen.getByTestId("export-format-json"));
		fireEvent.click(screen.getByTestId("export-run"));
		await waitFor(() => {
			expect(
				screen.getByTestId("export-progress").getAttribute("data-phase"),
			).toBe("completed");
		});
		expect(seenPageIds).toEqual(["p2", "p4"]);
	});

	it("raster (PNG) export produces exactly one artifact per selected page", async () => {
		vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(
			() => undefined,
		);
		const urlSpy = vi
			.spyOn(URL, "createObjectURL")
			.mockReturnValue("blob:mock");
		vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => undefined);
		setupPagesScope(["p1", "p3"]);
		await openDialog();
		// PNG is the dialog's default format.
		fireEvent.click(screen.getByTestId("export-run"));
		await waitFor(() => {
			expect(
				screen.getByTestId("export-progress").getAttribute("data-phase"),
			).toBe("completed");
		});
		expect(urlSpy).toHaveBeenCalledTimes(2);
		expect(vi.mocked(rasterizePage)).toHaveBeenCalledTimes(2);
	});
});

describe("cancellation stops before download (Bug 4, FR-154)", () => {
	it("cancelling mid-PDF-render stops before the download fires and ends in the cancelled phase", async () => {
		let calls = 0;
		const pdf: CanvasExporter = async (_ctx, request) => {
			calls += 1;
			if (request.isCancelled?.()) throw new CanvasExportCancelledError();
			await new Promise((resolve) => setTimeout(resolve, 30));
			if (request.isCancelled?.()) throw new CanvasExportCancelledError();
			return { filename: "x.pdf", data: "%PDF", mimeType: "application/pdf" };
		};
		vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(
			() => undefined,
		);
		const urlSpy = vi
			.spyOn(URL, "createObjectURL")
			.mockReturnValue("blob:mock");
		vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => undefined);
		setup({ pdf });
		await openDialog();
		fireEvent.click(screen.getByTestId("export-format-pdf"));
		fireEvent.click(screen.getByTestId("export-run"));
		await waitFor(() => {
			expect(screen.getByTestId("export-cancel")).toBeTruthy();
		});
		fireEvent.click(screen.getByTestId("export-cancel"));
		await waitFor(() => {
			expect(
				screen.getByTestId("export-progress").getAttribute("data-phase"),
			).toBe("cancelled");
		});
		expect(calls).toBe(1); // never re-invoked after cancellation
		expect(urlSpy).not.toHaveBeenCalled(); // no download fired
	});
});

// PRD §11.1: the previously-missing `CanvasStudioProps.onExport` — the
// UI-driven half. `export-action.test.ts` covers the headless
// `useCanvasStudioActions().export()` half with the SAME `CanvasExportResult`
// shape.
describe("onExport (PRD §11.1)", () => {
	function mockDownloads(): void {
		vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(
			() => undefined,
		);
		vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:mock");
		vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => undefined);
	}

	it("fires once with one artifact per page after a multi-page per-page-format export", async () => {
		const seenPages: string[] = [];
		const svg: CanvasExporter = ({ activePageId }) => {
			seenPages.push(activePageId);
			return { filename: "x.svg", data: "<svg/>", mimeType: "image/svg+xml" };
		};
		mockDownloads();
		const h = makeHarness({ ir: twoPageIR() });
		const onExport = vi.fn();
		const studioCtx = { ...h.studioCtx, onExport };
		render(
			<CanvasStudioContext.Provider value={studioCtx}>
				<ExportDialogTrigger exporters={{ svg }} />
			</CanvasStudioContext.Provider>,
		);
		await openDialog();
		fireEvent.click(screen.getByTestId("export-format-svg"));
		fireEvent.click(screen.getByTestId("export-pages-all"));
		fireEvent.click(screen.getByTestId("export-run"));
		await waitFor(() => {
			expect(
				screen.getByTestId("export-progress").getAttribute("data-phase"),
			).toBe("completed");
		});
		expect(seenPages).toEqual(["p1", "p2"]); // export itself still ran once per page
		expect(onExport).toHaveBeenCalledTimes(1); // but onExport fires ONCE, aggregated
		const result = onExport.mock.calls[0]?.[0];
		expect(result.format).toBe("svg");
		expect(result.artifacts).toHaveLength(2);
		expect(result.artifacts.map((a: { pageId?: string }) => a.pageId)).toEqual([
			"p1",
			"p2",
		]);
		for (const artifact of result.artifacts) {
			expect(artifact.blob).toBeInstanceOf(Blob);
		}
	});

	it("fires once with a single whole-document artifact after a JSON export", async () => {
		const json: CanvasExporter = ({ ir: docIr }) => ({
			filename: "x.json",
			data: JSON.stringify(docIr),
			mimeType: "application/json",
		});
		mockDownloads();
		const h = makeHarness({ ir: twoPageIR() });
		const onExport = vi.fn();
		const studioCtx = { ...h.studioCtx, onExport };
		render(
			<CanvasStudioContext.Provider value={studioCtx}>
				<ExportDialogTrigger exporters={{ json }} />
			</CanvasStudioContext.Provider>,
		);
		await openDialog();
		fireEvent.click(screen.getByTestId("export-format-json"));
		fireEvent.click(screen.getByTestId("export-pages-all"));
		fireEvent.click(screen.getByTestId("export-run"));
		await waitFor(() => {
			expect(
				screen.getByTestId("export-progress").getAttribute("data-phase"),
			).toBe("completed");
		});
		expect(onExport).toHaveBeenCalledTimes(1);
		const result = onExport.mock.calls[0]?.[0];
		expect(result.format).toBe("json");
		expect(result.artifacts).toHaveLength(1);
		expect(result.artifacts[0].pageId).toBeUndefined(); // whole-doc format
	});

	it("fires once with the synthetic selection-page artifact after a selection export", async () => {
		const selectableIr = createCanvasIR({
			id: "doc-onexport-sel",
			pages: [
				createPage({
					id: "p1",
					root: createGroup({
						id: "root",
						bounds: { width: 500, height: 500 },
						children: [
							createRect({
								id: "a",
								bounds: { width: 40, height: 30 },
								transform: { x: 10, y: 10 },
							}),
						],
					}),
				}),
			],
			now: () => FIXED_TS,
		});
		const svg: CanvasExporter = () => ({
			filename: "sel.svg",
			data: "<svg/>",
			mimeType: "image/svg+xml",
		});
		mockDownloads();
		const h = makeHarness({ ir: selectableIr });
		h.studioCtx.selectionStore.getState().setSelection(["a"]);
		const onExport = vi.fn();
		const studioCtx = { ...h.studioCtx, onExport };
		render(
			<CanvasStudioContext.Provider value={studioCtx}>
				<ExportDialogTrigger exporters={{ svg }} />
			</CanvasStudioContext.Provider>,
		);
		await openDialog();
		fireEvent.click(screen.getByTestId("export-format-svg"));
		fireEvent.click(screen.getByTestId("export-pages-selection"));
		fireEvent.click(screen.getByTestId("export-run"));
		await waitFor(() => {
			expect(
				screen.getByTestId("export-progress").getAttribute("data-phase"),
			).toBe("completed");
		});
		expect(onExport).toHaveBeenCalledTimes(1);
		const result = onExport.mock.calls[0]?.[0];
		expect(result.artifacts).toHaveLength(1);
		expect(result.artifacts[0].pageId).not.toBe("p1"); // the synthetic selection page
	});

	it("does not fire onExport on a failed export", async () => {
		const svg: CanvasExporter = () => {
			throw new Error("nope");
		};
		const h = makeHarness({ ir: twoPageIR() });
		const onExport = vi.fn();
		const studioCtx = { ...h.studioCtx, onExport };
		render(
			<CanvasStudioContext.Provider value={studioCtx}>
				<ExportDialogTrigger exporters={{ svg }} />
			</CanvasStudioContext.Provider>,
		);
		await openDialog();
		fireEvent.click(screen.getByTestId("export-format-svg"));
		fireEvent.click(screen.getByTestId("export-run"));
		await waitFor(() => {
			expect(
				screen.getByTestId("export-progress").getAttribute("data-phase"),
			).toBe("failed");
		});
		expect(onExport).not.toHaveBeenCalled();
	});
});

/**
 * FR-170: a dedicated toast for completed/failed, IN ADDITION to the inline
 * `exportState.phase` status the tests above already cover — primarily for
 * a user who closes this dialog while a longer export (e.g. multi-page PDF)
 * is still running and would otherwise never see that inline status resolve.
 */
describe("export completed/failed toast (FR-170)", () => {
	function mockDownloads(): void {
		vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(
			() => undefined,
		);
		vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:mock");
		vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => undefined);
	}

	function setupWithToaster(
		exporters: Partial<Record<string, CanvasExporter>> = {},
	) {
		const h = makeHarness({ ir: twoPageIR() });
		const toasts: CanvasToastInput[] = [];
		render(
			<CanvasStudioContext.Provider value={h.studioCtx}>
				<CanvasToastContext.Provider
					value={{ add: (input) => toasts.push(input) }}
				>
					<ExportDialogTrigger exporters={exporters} />
				</CanvasToastContext.Provider>
			</CanvasStudioContext.Provider>,
		);
		return { h, toasts };
	}

	it("fires a success toast alongside the inline 'completed' status", async () => {
		const svg: CanvasExporter = () => ({
			filename: "x.svg",
			data: "<svg/>",
			mimeType: "image/svg+xml",
		});
		mockDownloads();
		const { toasts } = setupWithToaster({ svg });
		await openDialog();
		fireEvent.click(screen.getByTestId("export-format-svg"));
		fireEvent.click(screen.getByTestId("export-run"));
		await waitFor(() => {
			expect(
				screen.getByTestId("export-progress").getAttribute("data-phase"),
			).toBe("completed");
		});
		expect(toasts).toHaveLength(1);
		expect(toasts[0]?.type).toBe("success");
		expect(toasts[0]?.title).toBe("Export complete");
	});

	it("fires an error toast alongside the inline 'failed' status", async () => {
		const svg: CanvasExporter = () => {
			throw new Error("nope");
		};
		const { toasts } = setupWithToaster({ svg });
		await openDialog();
		fireEvent.click(screen.getByTestId("export-format-svg"));
		fireEvent.click(screen.getByTestId("export-run"));
		await waitFor(() => {
			expect(
				screen.getByTestId("export-progress").getAttribute("data-phase"),
			).toBe("failed");
		});
		expect(toasts).toHaveLength(1);
		expect(toasts[0]?.type).toBe("error");
		expect(toasts[0]?.title).toBe("Export failed");
		expect(toasts[0]?.description).toBe("nope");
	});

	it("does not toast on cancellation (only completed/failed)", async () => {
		const pdf: CanvasExporter = async (_ctx, request) => {
			if (request.isCancelled?.()) throw new CanvasExportCancelledError();
			await new Promise((resolve) => setTimeout(resolve, 30));
			if (request.isCancelled?.()) throw new CanvasExportCancelledError();
			return { filename: "x.pdf", data: "%PDF", mimeType: "application/pdf" };
		};
		mockDownloads();
		const { toasts } = setupWithToaster({ pdf });
		await openDialog();
		fireEvent.click(screen.getByTestId("export-format-pdf"));
		fireEvent.click(screen.getByTestId("export-run"));
		await waitFor(() => {
			expect(screen.getByTestId("export-cancel")).toBeTruthy();
		});
		fireEvent.click(screen.getByTestId("export-cancel"));
		await waitFor(() => {
			expect(
				screen.getByTestId("export-progress").getAttribute("data-phase"),
			).toBe("cancelled");
		});
		expect(toasts).toHaveLength(0);
	});

	it("still fires the completion toast even after the dialog (and the whole tree) has been unmounted mid-export", async () => {
		const pdf: CanvasExporter = async () => {
			await new Promise((resolve) => setTimeout(resolve, 40));
			return { filename: "x.pdf", data: "%PDF", mimeType: "application/pdf" };
		};
		mockDownloads();
		const { toasts } = setupWithToaster({ pdf });
		await openDialog();
		fireEvent.click(screen.getByTestId("export-format-pdf"));
		fireEvent.click(screen.getByTestId("export-run"));
		// Simulate the user closing the dialog (and unmounting the whole tree)
		// while the multi-page-style export is still in flight — the toast
		// path must not depend on the component still being mounted.
		cleanup();
		await new Promise((resolve) => setTimeout(resolve, 80));
		expect(toasts).toHaveLength(1);
		expect(toasts[0]?.type).toBe("success");
	});
});
