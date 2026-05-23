import {
	createCanvasIR,
	createGroup,
	createPage,
	createRect,
	findNode,
} from "@anvilkit/canvas-core";
import { cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { FloatingSelectionToolbar } from "../FloatingSelectionToolbar.js";
import {
	makeTestStudioContext,
	TestStudioProvider,
} from "./test-studio-context.js";

afterEach(cleanup);

function irWithRect() {
	const page = createPage({ id: "p1" });
	page.root = createGroup({
		id: "p1-root",
		bounds: page.root.bounds,
		children: [
			createRect({
				id: "r1",
				bounds: { width: 10, height: 10 },
				fill: "#aabbcc",
			}),
		],
	});
	return createCanvasIR({
		pages: [page],
		now: () => "2026-01-01T00:00:00.000Z",
	});
}

describe("FloatingSelectionToolbar", () => {
	it("renders nothing when the selection is empty", () => {
		const ctx = makeTestStudioContext({ ir: irWithRect() });
		const { container } = render(
			<TestStudioProvider value={ctx}>
				<FloatingSelectionToolbar />
			</TestStudioProvider>,
		);
		expect(
			container.querySelector("[data-testid='floating-selection-toolbar']"),
		).toBeNull();
	});

	it("appears when a node is selected and deletes it", () => {
		const ctx = makeTestStudioContext({ ir: irWithRect() });
		ctx.selectionStore.getState().setSelection(["r1"]);
		const { container } = render(
			<TestStudioProvider value={ctx}>
				<FloatingSelectionToolbar />
			</TestStudioProvider>,
		);
		expect(
			container.querySelector("[data-testid='floating-selection-toolbar']"),
		).not.toBeNull();
		fireEvent.click(
			container.querySelector("[data-testid='floating-delete']") as HTMLElement,
		);
		expect(findNode(ctx.getIR(), "r1")).toBeNull();
		expect(ctx.selectionStore.getState().selectedIds).toEqual([]);
	});

	it("routes Ask AI through requestAiIntent for the first selected node", () => {
		const requestAiIntent = vi.fn();
		const ctx = makeTestStudioContext({ ir: irWithRect(), requestAiIntent });
		ctx.selectionStore.getState().setSelection(["r1"]);
		const { container } = render(
			<TestStudioProvider value={ctx}>
				<FloatingSelectionToolbar />
			</TestStudioProvider>,
		);
		fireEvent.click(
			container.querySelector("[data-testid='floating-ask-ai']") as HTMLElement,
		);
		expect(requestAiIntent).toHaveBeenCalledWith({
			kind: "ai-brush-select",
			nodeId: "r1",
			context: { artboardId: "p1" },
		});
	});

	it("hides Ask AI when no host wired requestAiIntent", () => {
		const ctx = makeTestStudioContext({ ir: irWithRect() });
		ctx.selectionStore.getState().setSelection(["r1"]);
		const { container } = render(
			<TestStudioProvider value={ctx}>
				<FloatingSelectionToolbar />
			</TestStudioProvider>,
		);
		expect(
			container.querySelector("[data-testid='floating-ask-ai']"),
		).toBeNull();
	});
});
