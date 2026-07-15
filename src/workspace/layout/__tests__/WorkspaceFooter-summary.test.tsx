import {
	type CanvasIR,
	createCanvasIR,
	createGroup,
	createPage,
	createRect,
} from "@anvilkit/canvas-core";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { CanvasStudioContext } from "@/context/canvas-studio-context.js";
import { makeHarness } from "@/tools/__tests__/_tool-test-helpers.js";
import { WorkspaceFooter } from "../WorkspaceFooter.js";

afterEach(cleanup);

const NOW = "2026-01-01T00:00:00.000Z";

function fixtureIR(): CanvasIR {
	const page = createPage({ id: "p1" });
	const a = createRect({
		id: "a",
		transform: { x: 10, y: 20 },
		bounds: { width: 50, height: 40 },
	});
	const b = createRect({
		id: "b",
		transform: { x: 100, y: 60 },
		bounds: { width: 30, height: 30 },
	});
	b.locked = true;
	b.visible = false;
	page.root = createGroup({
		id: "p1-root",
		bounds: page.root.bounds,
		children: [a, b],
	});
	return createCanvasIR({ id: "ir", pages: [page], now: () => NOW });
}

function mount(selection: string[]) {
	const h = makeHarness({ ir: fixtureIR() });
	h.studioCtx.selectionStore.getState().setSelection(selection);
	render(
		<CanvasStudioContext.Provider value={h.studioCtx}>
			<WorkspaceFooter />
		</CanvasStudioContext.Provider>,
	);
	return h;
}

describe("WorkspaceFooter selection summary (B-13, FR-131)", () => {
	it("is absent with no selection", () => {
		mount([]);
		expect(screen.queryByTestId("workspace-selection-summary")).toBeNull();
	});

	it("shows count, combined bbox, and locked/hidden counts", () => {
		mount(["a", "b"]);
		expect(screen.getByTestId("selection-summary-count").textContent).toBe(
			"2 selected",
		);
		// AABB over a(10,20 50x40) + b(100,60 30x30) → 10,20 · 120×70
		expect(screen.getByTestId("selection-summary-bbox").textContent).toBe(
			"10, 20 · 120×70",
		);
		expect(screen.getByTestId("selection-summary-locked").textContent).toBe(
			"1 locked",
		);
		expect(screen.getByTestId("selection-summary-hidden").textContent).toBe(
			"1 hidden",
		);
	});

	it("omits locked/hidden badges when none apply", () => {
		mount(["a"]);
		expect(screen.getByTestId("selection-summary-count").textContent).toBe(
			"1 selected",
		);
		expect(screen.queryByTestId("selection-summary-locked")).toBeNull();
		expect(screen.queryByTestId("selection-summary-hidden")).toBeNull();
	});
});
