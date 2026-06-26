import { act, cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { CanvasStudioContext } from "@/context/canvas-studio-context.js";
import { makeHarness } from "@/tools/__tests__/_tool-test-helpers.js";
import { ToolAnnouncer } from "../ToolAnnouncer.js";

// react-library vitest preset runs with globals:false → RTL auto-cleanup is OFF.
afterEach(cleanup);

function mount(ctx = makeHarness().studioCtx) {
	return render(
		<CanvasStudioContext.Provider value={ctx}>
			<ToolAnnouncer />
		</CanvasStudioContext.Provider>,
	);
}

describe("ToolAnnouncer", () => {
	it("renders a polite status live region", () => {
		const { container } = mount();
		const region = container.querySelector(
			"[data-testid='tool-announcer']",
		) as HTMLElement;
		expect(region).not.toBeNull();
		expect(region.getAttribute("role")).toBe("status");
		expect(region.getAttribute("aria-live")).toBe("polite");
	});

	it("announces the default tool (select) on mount", () => {
		const { container } = mount();
		const region = container.querySelector(
			"[data-testid='tool-announcer']",
		) as HTMLElement;
		expect(region.textContent).toMatch(/select/i);
	});

	it("updates the announcement when the active tool changes", () => {
		const h = makeHarness();
		const { container } = mount(h.studioCtx);
		act(() => {
			h.studioCtx.toolStore.getState().setActiveTool("rect");
		});
		const region = container.querySelector(
			"[data-testid='tool-announcer']",
		) as HTMLElement;
		expect(region.textContent).toMatch(/rectangle/i);
	});
});
