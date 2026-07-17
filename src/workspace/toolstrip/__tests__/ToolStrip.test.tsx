import {
	act,
	cleanup,
	fireEvent,
	render,
	screen,
} from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { CanvasStudioContext } from "@/context/canvas-studio-context.js";
import { makeHarness } from "@/tools/__tests__/_tool-test-helpers.js";
import { ToolStrip } from "../ToolStrip.js";

afterEach(cleanup);

function setup() {
	const h = makeHarness();
	render(
		<CanvasStudioContext.Provider value={h.studioCtx}>
			<ToolStrip />
		</CanvasStudioContext.Provider>,
	);
	return h;
}

describe("ToolStrip (B-06, FR-010/011)", () => {
	it("renders a button per registry tool with shortcut tooltips", () => {
		setup();
		const ids = [
			"select",
			"hand",
			"frame",
			"rect",
			"ellipse",
			"line",
			"path",
			"text",
			"image",
		];
		for (const id of ids) {
			expect(screen.getByTestId(`tool-strip-${id}`)).toBeTruthy();
		}
		const rect = screen.getByTestId("tool-strip-rect");
		expect(rect.getAttribute("title")).toContain("R");
		expect(rect.getAttribute("aria-keyshortcuts")).toBe("R");
	});

	it("clicking a tool activates it and reflects the active state", () => {
		const h = setup();
		fireEvent.click(screen.getByTestId("tool-strip-rect"));
		expect(h.studioCtx.toolStore.getState().activeTool).toBe("rect");
		expect(
			screen.getByTestId("tool-strip-rect").getAttribute("aria-pressed"),
		).toBe("true");
		expect(
			screen.getByTestId("tool-strip-select").getAttribute("aria-pressed"),
		).toBe("false");
	});
});

describe("ToolStrip disabled/loading states (FR-011)", () => {
	it("the image tool is enabled by default (lightweight test contexts)", () => {
		setup();
		expect(
			(screen.getByTestId("tool-strip-image") as HTMLButtonElement).disabled,
		).toBe(false);
	});

	it("disables the image tool when hasImagePicker is explicitly false", () => {
		const h = makeHarness();
		h.studioCtx.hasImagePicker = false;
		render(
			<CanvasStudioContext.Provider value={h.studioCtx}>
				<ToolStrip />
			</CanvasStudioContext.Provider>,
		);
		const button = screen.getByTestId("tool-strip-image") as HTMLButtonElement;
		expect(button.disabled).toBe(true);
		fireEvent.click(button);
		expect(h.studioCtx.toolStore.getState().activeTool).not.toBe("image");
	});

	it("does not disable other tools when hasImagePicker is false", () => {
		const h = makeHarness();
		h.studioCtx.hasImagePicker = false;
		render(
			<CanvasStudioContext.Provider value={h.studioCtx}>
				<ToolStrip />
			</CanvasStudioContext.Provider>,
		);
		expect(
			(screen.getByTestId("tool-strip-rect") as HTMLButtonElement).disabled,
		).toBe(false);
	});

	it("shows ai-image/ai-brush as loading while an AI job is pending", () => {
		const h = makeHarness();
		render(
			<CanvasStudioContext.Provider value={h.studioCtx}>
				<ToolStrip />
			</CanvasStudioContext.Provider>,
		);
		expect(
			screen.getByTestId("tool-strip-ai-image").getAttribute("data-loading"),
		).toBe("false");
		act(() => {
			h.studioCtx.aiJobStore
				.getState()
				.register("job-1", { nodeId: "n1", abort: () => undefined });
		});
		expect(
			screen.getByTestId("tool-strip-ai-image").getAttribute("data-loading"),
		).toBe("true");
		expect(
			screen.getByTestId("tool-strip-ai-brush").getAttribute("data-loading"),
		).toBe("true");
		// Unrelated tools never show as loading.
		expect(
			screen.getByTestId("tool-strip-rect").getAttribute("data-loading"),
		).toBe("false");
	});

	it("stops showing loading once the job completes", () => {
		const h = makeHarness();
		h.studioCtx.aiJobStore
			.getState()
			.register("job-1", { nodeId: "n1", abort: () => undefined });
		render(
			<CanvasStudioContext.Provider value={h.studioCtx}>
				<ToolStrip />
			</CanvasStudioContext.Provider>,
		);
		expect(
			screen.getByTestId("tool-strip-ai-image").getAttribute("data-loading"),
		).toBe("true");
		act(() => {
			h.studioCtx.aiJobStore.getState().complete("job-1");
		});
		expect(
			screen.getByTestId("tool-strip-ai-image").getAttribute("data-loading"),
		).toBe("false");
	});
});
