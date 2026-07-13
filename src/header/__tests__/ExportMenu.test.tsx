import type { CanvasExportWarning } from "@anvilkit/canvas-core";
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CanvasStudioContext } from "@/context/canvas-studio-context.js";
import { makeHarness } from "@/tools/__tests__/_tool-test-helpers.js";
import { ExportMenu } from "../ExportMenu.js";
import type { CanvasExporter } from "../types.js";

afterEach(cleanup);

const warning: CanvasExportWarning = {
	level: "warn",
	code: "TOKEN_UNRESOLVED",
	message: "A brand token could not be resolved.",
	fallback: "Falls back to a literal color.",
};

function renderMenu(exporters: Partial<Record<string, CanvasExporter>>) {
	const harness = makeHarness({ pageId: "p1" });
	const view = render(
		<CanvasStudioContext.Provider value={harness.studioCtx}>
			<ExportMenu exporters={exporters} />
		</CanvasStudioContext.Provider>,
	);
	return { ...view, ...harness };
}

describe("ExportMenu — fidelity warnings (FR-041/UX-007, canvas-m3-008)", () => {
	it("downloads and closes the popover when the artifact has no warnings", async () => {
		const svgExporter: CanvasExporter = () => ({
			filename: "design.svg",
			data: "<svg/>",
			mimeType: "image/svg+xml",
		});
		const { getByTestId, queryByTestId } = renderMenu({ svg: svgExporter });
		fireEvent.click(getByTestId("canvas-export-trigger"));
		fireEvent.click(getByTestId("canvas-export-svg"));
		fireEvent.click(getByTestId("canvas-export-save"));
		await waitFor(() => {
			expect(queryByTestId("canvas-export-panel")).not.toBeInTheDocument();
		});
		expect(queryByTestId("canvas-export-warnings")).not.toBeInTheDocument();
	});

	it("shows the artifact's warnings and keeps the popover open", async () => {
		const svgExporter: CanvasExporter = () => ({
			filename: "design.svg",
			data: "<svg/>",
			mimeType: "image/svg+xml",
			warnings: [warning],
		});
		const { getByTestId } = renderMenu({ svg: svgExporter });
		fireEvent.click(getByTestId("canvas-export-trigger"));
		fireEvent.click(getByTestId("canvas-export-svg"));
		fireEvent.click(getByTestId("canvas-export-save"));
		await waitFor(() => {
			expect(getByTestId("canvas-export-warnings")).toBeInTheDocument();
		});
		expect(getByTestId("canvas-export-warnings").textContent).toContain(
			"A brand token could not be resolved.",
		);
		expect(getByTestId("canvas-export-warnings").textContent).toContain(
			"Falls back to a literal color.",
		);
		// The popover stays open — the artifact still downloaded, but the user
		// can see the warning rather than it being silently discarded.
		expect(getByTestId("canvas-export-panel")).toBeInTheDocument();
	});

	it("clears warnings when the popover is reopened", async () => {
		const svgExporter: CanvasExporter = () => ({
			filename: "design.svg",
			data: "<svg/>",
			mimeType: "image/svg+xml",
			warnings: [warning],
		});
		const { getByTestId, queryByTestId } = renderMenu({ svg: svgExporter });
		fireEvent.click(getByTestId("canvas-export-trigger"));
		fireEvent.click(getByTestId("canvas-export-svg"));
		fireEvent.click(getByTestId("canvas-export-save"));
		await waitFor(() => {
			expect(getByTestId("canvas-export-warnings")).toBeInTheDocument();
		});
		fireEvent.click(getByTestId("canvas-export-cancel"));
		await waitFor(() => {
			expect(queryByTestId("canvas-export-panel")).not.toBeInTheDocument();
		});
		fireEvent.click(getByTestId("canvas-export-trigger"));
		expect(queryByTestId("canvas-export-warnings")).not.toBeInTheDocument();
	});

	it("still surfaces a thrown error over any stale warnings", async () => {
		const failingExporter: CanvasExporter = vi.fn(() => {
			throw new Error("boom");
		});
		const { getByTestId } = renderMenu({ svg: failingExporter });
		fireEvent.click(getByTestId("canvas-export-trigger"));
		fireEvent.click(getByTestId("canvas-export-svg"));
		fireEvent.click(getByTestId("canvas-export-save"));
		await waitFor(() => {
			expect(getByTestId("canvas-export-error")).toBeInTheDocument();
		});
	});
});
