import { CANVAS_SIZE_PRESETS } from "@anvilkit/canvas-core";
import { cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { CanvasStudioContext } from "@/context/canvas-studio-context.js";
import { makeHarness } from "@/tools/__tests__/_tool-test-helpers.js";
import { CampaignResizePanel } from "../CampaignResizePanel.js";

afterEach(cleanup);

function renderPanel(pageId = "p1") {
	const harness = makeHarness({ pageId });
	const view = render(
		<CanvasStudioContext.Provider value={harness.studioCtx}>
			<CampaignResizePanel />
		</CanvasStudioContext.Provider>,
	);
	return { ...view, ...harness };
}

describe("CampaignResizePanel", () => {
	it("lists every preset in CANVAS_SIZE_PRESETS", () => {
		const { getByTestId } = renderPanel();
		for (const preset of CANVAS_SIZE_PRESETS) {
			expect(
				getByTestId(`campaign-resize-preset-${preset.id}`),
			).toBeInTheDocument();
		}
	});

	it("disables the create button until at least one preset is selected", () => {
		const { getByTestId } = renderPanel();
		const create = getByTestId("campaign-resize-create");
		expect(create).toBeDisabled();
		fireEvent.click(getByTestId("campaign-resize-preset-instagram-post"));
		expect(create).not.toBeDisabled();
	});

	it("toggles a preset's selected state on repeated clicks", () => {
		const { getByTestId } = renderPanel();
		const preset = getByTestId("campaign-resize-preset-instagram-post");
		expect(preset).toHaveAttribute("aria-pressed", "false");
		fireEvent.click(preset);
		expect(preset).toHaveAttribute("aria-pressed", "true");
		fireEvent.click(preset);
		expect(preset).toHaveAttribute("aria-pressed", "false");
	});

	it("commits a batch resize for every selected preset when confirmed", () => {
		const { getByTestId, commits } = renderPanel();
		fireEvent.click(getByTestId("campaign-resize-preset-instagram-post"));
		fireEvent.click(getByTestId("campaign-resize-preset-youtube-thumbnail"));
		fireEvent.click(getByTestId("campaign-resize-create"));
		expect(commits).toHaveLength(1);
		const batch = commits[0];
		if (!batch || batch.type !== "batch") throw new Error("expected a batch");
		expect(batch.commands).toHaveLength(2);
	});

	it("clears the selection after a successful resize", () => {
		const { getByTestId } = renderPanel();
		const preset = getByTestId("campaign-resize-preset-instagram-post");
		fireEvent.click(preset);
		fireEvent.click(getByTestId("campaign-resize-create"));
		expect(preset).toHaveAttribute("aria-pressed", "false");
		expect(getByTestId("campaign-resize-create")).toBeDisabled();
	});

	it("shows an error message and keeps the selection when resize fails", () => {
		const harness = makeHarness({ pageId: "p1" });
		// `activePageId` on the context is a snapshot taken at harness
		// creation (per _tool-test-helpers.js), not a live store subscription —
		// overwrite it directly to name a page absent from the IR, so
		// resizeActivePageToVariants's sourcePageId lookup fails.
		harness.studioCtx.activePageId = "missing-page";
		const { getByTestId, queryByTestId } = render(
			<CanvasStudioContext.Provider value={harness.studioCtx}>
				<CampaignResizePanel />
			</CanvasStudioContext.Provider>,
		);
		expect(queryByTestId("campaign-resize-error")).not.toBeInTheDocument();
		const preset = getByTestId("campaign-resize-preset-instagram-post");
		fireEvent.click(preset);
		fireEvent.click(getByTestId("campaign-resize-create"));
		expect(getByTestId("campaign-resize-error").textContent).toMatch(
			/no page with id/,
		);
		expect(preset).toHaveAttribute("aria-pressed", "true");
		expect(harness.commits).toHaveLength(0);
	});
});
