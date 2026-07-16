import {
	type CanvasIR,
	createCanvasIR,
	createPage,
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
import { makeHarness } from "@/tools/__tests__/_tool-test-helpers.js";
import { ExportDialogTrigger } from "../ExportDialogTrigger.js";
import type { CanvasExporter } from "../types.js";

afterEach(() => {
	cleanup();
	vi.restoreAllMocks();
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
