import {
	type CanvasIR,
	createCanvasIR,
	createEllipse,
	createPage,
	createRect,
} from "@anvilkit/canvas-core";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { CanvasStudioContext } from "@/context/canvas-studio-context.js";
import { makeHarness } from "@/tools/__tests__/_tool-test-helpers.js";
import { CornerRadiusOverlay } from "../CornerRadiusOverlay.js";

afterEach(cleanup);

const NOW = "2026-01-01T00:00:00.000Z";

function irWith(node: ReturnType<typeof createRect>): CanvasIR {
	const ir = createCanvasIR({
		id: "ir",
		pages: [createPage({ id: "p1" })],
		now: () => NOW,
	});
	const page = ir.pages[0];
	if (!page) throw new Error("no page");
	page.root.children = [node];
	return ir;
}

function mount(ir: CanvasIR, selection: string[]) {
	const h = makeHarness({ ir });
	h.studioCtx.selectionStore.getState().setSelection(selection);
	render(
		<CanvasStudioContext.Provider value={h.studioCtx}>
			<CornerRadiusOverlay />
		</CanvasStudioContext.Provider>,
	);
	return h;
}

describe("CornerRadiusOverlay (FR-076)", () => {
	it("shows the handle for a single selected rect", () => {
		mount(
			irWith(createRect({ id: "r", bounds: { width: 200, height: 100 } })),
			["r"],
		);
		expect(screen.getByTestId("corner-radius-handle")).toBeTruthy();
	});

	it("does not show for a non-roundable node (ellipse)", () => {
		const ir = createCanvasIR({
			id: "ir-e",
			pages: [createPage({ id: "p1" })],
			now: () => NOW,
		});
		const page = ir.pages[0];
		if (page)
			page.root.children = [
				createEllipse({ id: "e", bounds: { width: 40, height: 40 } }),
			];
		mount(ir, ["e"]);
		expect(screen.queryByTestId("corner-radius-handle")).toBeNull();
	});

	it("does not show for a multi-selection", () => {
		const ir = createCanvasIR({
			id: "ir-m",
			pages: [createPage({ id: "p1" })],
			now: () => NOW,
		});
		const page = ir.pages[0];
		if (page)
			page.root.children = [
				createRect({ id: "a", bounds: { width: 20, height: 20 } }),
				createRect({ id: "b", bounds: { width: 20, height: 20 } }),
			];
		mount(ir, ["a", "b"]);
		expect(screen.queryByTestId("corner-radius-handle")).toBeNull();
	});

	it("ArrowRight commits an increased uniform radius and clears per-corner radii", () => {
		const h = mount(
			irWith(
				createRect({ id: "r", bounds: { width: 200, height: 100 }, radius: 4 }),
			),
			["r"],
		);
		fireEvent.keyDown(screen.getByTestId("corner-radius-handle"), {
			key: "ArrowRight",
		});
		expect(h.studioCtx.commitCoalesced).toHaveBeenCalledWith(
			expect.objectContaining({
				patch: { radius: 5, cornerRadii: undefined },
			}),
			"corner-radius:r",
		);
	});

	it("clamps the radius to half the shorter side", () => {
		const h = mount(
			irWith(
				createRect({
					id: "r",
					bounds: { width: 200, height: 100 },
					radius: 50,
				}),
			),
			["r"],
		);
		// max = 100/2 = 50; shift+ArrowRight (+10) stays clamped at 50.
		fireEvent.keyDown(screen.getByTestId("corner-radius-handle"), {
			key: "ArrowRight",
			shiftKey: true,
		});
		expect(h.studioCtx.commitCoalesced).toHaveBeenCalledWith(
			expect.objectContaining({
				patch: { radius: 50, cornerRadii: undefined },
			}),
			"corner-radius:r",
		);
	});
});
