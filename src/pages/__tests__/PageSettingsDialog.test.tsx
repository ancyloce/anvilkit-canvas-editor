import { CANVAS_SIZE_PRESETS, createPage } from "@anvilkit/canvas-core";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CanvasStudioContext } from "@/context/canvas-studio-context.js";
import { makeHarness } from "@/tools/__tests__/_tool-test-helpers.js";
import PageSettingsDialog from "../PageSettingsDialog.js";

afterEach(cleanup);

function page() {
	return createPage({
		id: "p1",
		name: "Cover",
		size: { width: 800, height: 600, unit: "px" },
		background: { kind: "solid", value: "#ffffff" },
	});
}

function setup() {
	const h = makeHarness();
	const onClose = vi.fn();
	render(
		<CanvasStudioContext.Provider value={h.studioCtx}>
			<PageSettingsDialog page={page()} onClose={onClose} />
		</CanvasStudioContext.Provider>,
	);
	return { h, onClose };
}

describe("PageSettingsDialog (B-11, FR-063)", () => {
	it("commits a single page.resize with the chosen mode", () => {
		const { h, onClose } = setup();
		fireEvent.change(screen.getByTestId("page-settings-width"), {
			target: { value: "1000" },
		});
		fireEvent.click(screen.getByTestId("page-settings-mode-scale-content"));
		fireEvent.click(screen.getByTestId("page-settings-apply"));
		expect(h.studioCtx.commit).toHaveBeenCalledTimes(1);
		expect(h.studioCtx.commit).toHaveBeenCalledWith({
			type: "page.resize",
			pageId: "p1",
			from: { width: 800, height: 600 },
			to: { width: 1000, height: 600 },
			mode: "scale-content",
		});
		expect(h.studioCtx.commitBatch).not.toHaveBeenCalled();
		expect(onClose).toHaveBeenCalledTimes(1);
	});

	it("commits a single page.set-background when only the color changes", () => {
		const { h, onClose } = setup();
		fireEvent.change(screen.getByTestId("page-settings-background"), {
			target: { value: "#112233" },
		});
		fireEvent.click(screen.getByTestId("page-settings-apply"));
		expect(h.studioCtx.commit).toHaveBeenCalledWith({
			type: "page.set-background",
			pageId: "p1",
			from: { kind: "solid", value: "#ffffff" },
			to: { kind: "solid", value: "#112233" },
		});
		expect(onClose).toHaveBeenCalledTimes(1);
	});

	it("batches resize + background into ONE undo entry", () => {
		const { h } = setup();
		fireEvent.change(screen.getByTestId("page-settings-height"), {
			target: { value: "900" },
		});
		fireEvent.change(screen.getByTestId("page-settings-background"), {
			target: { value: "#aabbcc" },
		});
		fireEvent.click(screen.getByTestId("page-settings-apply"));
		expect(h.studioCtx.commit).not.toHaveBeenCalled();
		expect(h.studioCtx.commitBatch).toHaveBeenCalledTimes(1);
		const [cmds, label] = vi.mocked(h.studioCtx.commitBatch).mock.calls[0] ?? [
			[],
			"",
		];
		expect(label).toBe("Page settings");
		expect(cmds.map((c) => c.type)).toEqual([
			"page.resize",
			"page.set-background",
		]);
	});

	it("swap exchanges width and height; unchanged apply commits nothing", () => {
		const { h, onClose } = setup();
		fireEvent.click(screen.getByTestId("page-settings-orientation"));
		expect(
			(screen.getByTestId("page-settings-width") as HTMLInputElement).value,
		).toBe("600");
		expect(
			(screen.getByTestId("page-settings-height") as HTMLInputElement).value,
		).toBe("800");
		// Swap back → identical to the current size → no command at all.
		fireEvent.click(screen.getByTestId("page-settings-orientation"));
		fireEvent.click(screen.getByTestId("page-settings-apply"));
		expect(h.studioCtx.commit).not.toHaveBeenCalled();
		expect(h.studioCtx.commitBatch).not.toHaveBeenCalled();
		expect(onClose).toHaveBeenCalledTimes(1);
	});

	it("a size preset fills the width/height fields (picker reuse)", () => {
		const preset = CANVAS_SIZE_PRESETS[0];
		if (!preset) throw new Error("no presets");
		const { h } = setup();
		fireEvent.click(screen.getByTestId(`size-preset-${preset.id}`));
		expect(
			(screen.getByTestId("page-settings-width") as HTMLInputElement).value,
		).toBe(String(preset.width));
		fireEvent.click(screen.getByTestId("page-settings-apply"));
		expect(h.studioCtx.commit).toHaveBeenCalledWith(
			expect.objectContaining({
				type: "page.resize",
				to: { width: preset.width, height: preset.height },
			}),
		);
	});

	it("campaign-size variant creation is reachable from Page Settings (FR-063)", () => {
		setup();
		expect(screen.queryByTestId("campaign-resize-panel")).toBeNull();
		fireEvent.click(screen.getByTestId("page-settings-variants-toggle"));
		expect(screen.getByTestId("campaign-resize-panel")).toBeDefined();
		// The panel's own controls are live inside the dialog.
		const preset = CANVAS_SIZE_PRESETS[0];
		if (!preset) throw new Error("no presets");
		expect(
			screen.getByTestId(`campaign-resize-preset-${preset.id}`),
		).toBeDefined();
		expect(screen.getByTestId("campaign-resize-create")).toBeDefined();
	});
});
