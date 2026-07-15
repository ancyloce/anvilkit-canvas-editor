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
	await screen.findByTestId("export-dialog"); // lazy chunk
}

describe("ExportDialog (B-09, FR-150..154)", () => {
	it("opens code-split, shows built-in formats, pages and scale controls", async () => {
		setup();
		await openDialog();
		expect(screen.getByTestId("export-format-png")).toBeTruthy();
		expect(screen.getByTestId("export-format-json")).toBeTruthy();
		expect(screen.queryByTestId("export-format-svg")).toBeNull();
		expect(screen.getByTestId("export-pages-current")).toBeTruthy();
		expect(screen.getByTestId("export-scale-2")).toBeTruthy();
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
});
