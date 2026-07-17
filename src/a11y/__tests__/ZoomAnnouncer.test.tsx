import { act, cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { CanvasStudioContext } from "@/context/canvas-studio-context.js";
import { makeHarness } from "@/tools/__tests__/_tool-test-helpers.js";
import { ZoomAnnouncer } from "../ZoomAnnouncer.js";

// react-library vitest preset runs with globals:false → RTL auto-cleanup is OFF.
afterEach(cleanup);

function mount(ctx = makeHarness().studioCtx) {
	return render(
		<CanvasStudioContext.Provider value={ctx}>
			<ZoomAnnouncer />
		</CanvasStudioContext.Provider>,
	);
}

describe("ZoomAnnouncer", () => {
	it("renders a polite status live region", () => {
		const { container } = mount();
		const region = container.querySelector(
			"[data-testid='zoom-announcer']",
		) as HTMLElement;
		expect(region).not.toBeNull();
		expect(region.getAttribute("role")).toBe("status");
		expect(region.getAttribute("aria-live")).toBe("polite");
	});

	it("announces the default zoom (100%) on mount", () => {
		const { container } = mount();
		const region = container.querySelector(
			"[data-testid='zoom-announcer']",
		) as HTMLElement;
		expect(region.textContent).toMatch(/100%/);
	});

	it("updates the announcement when the zoom changes", () => {
		const h = makeHarness();
		const { container } = mount(h.studioCtx);
		act(() => {
			h.studioCtx.viewportStore.getState().setZoom(1.5);
		});
		const region = container.querySelector(
			"[data-testid='zoom-announcer']",
		) as HTMLElement;
		expect(region.textContent).toMatch(/150%/);
	});
});
