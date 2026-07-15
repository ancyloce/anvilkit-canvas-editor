import { cleanup, fireEvent, render, screen } from "@testing-library/react";
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
