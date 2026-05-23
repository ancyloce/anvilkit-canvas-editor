import { createCanvasIR, createPage } from "@anvilkit/canvas-core";
import { cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { EditorStageBar } from "../EditorStageBar.js";
import { ZoomControl } from "../ZoomControl.js";
import {
	makeTestStudioContext,
	TestStudioProvider,
} from "./test-studio-context.js";

afterEach(cleanup);

function irWithTitle() {
	return createCanvasIR({
		title: "Spring Drop",
		pages: [
			createPage({
				id: "p1",
				name: "Page 1",
				size: { width: 1080, height: 1080, unit: "px" },
			}),
		],
		now: () => "2026-01-01T00:00:00.000Z",
	});
}

describe("EditorStageBar", () => {
	it("shows the document title and active page size, undo/redo disabled at rest", () => {
		const ctx = makeTestStudioContext({ ir: irWithTitle() });
		const { container } = render(
			<TestStudioProvider value={ctx}>
				<EditorStageBar actions={<button type="button">Export</button>} />
			</TestStudioProvider>,
		);
		expect(
			container.querySelector("[data-testid='stage-doc-title']")?.textContent,
		).toBe("Spring Drop");
		expect(
			container.querySelector("[data-testid='stage-doc-size']")?.textContent,
		).toBe("1080 × 1080");
		const undo = container.querySelector(
			"[data-testid='stage-undo']",
		) as HTMLButtonElement;
		const redo = container.querySelector(
			"[data-testid='stage-redo']",
		) as HTMLButtonElement;
		expect(undo.disabled).toBe(true);
		expect(redo.disabled).toBe(true);
	});

	it("renders the actions slot", () => {
		const ctx = makeTestStudioContext({ ir: irWithTitle() });
		const { container } = render(
			<TestStudioProvider value={ctx}>
				<EditorStageBar
					actions={
						<button type="button" data-testid="act-publish">
							Publish
						</button>
					}
				/>
			</TestStudioProvider>,
		);
		expect(
			container.querySelector("[data-testid='act-publish']"),
		).not.toBeNull();
	});
});

describe("ZoomControl", () => {
	it("renders the current zoom and page indicator", () => {
		const ctx = makeTestStudioContext({ ir: irWithTitle() });
		const { container } = render(
			<TestStudioProvider value={ctx}>
				<ZoomControl />
			</TestStudioProvider>,
		);
		expect(
			container.querySelector("[data-testid='zoom-value']")?.textContent,
		).toBe("100%");
		expect(
			container.querySelector("[data-testid='zoom-page']")?.textContent,
		).toBe("Page 1 / 1");
	});

	it("zooms in and out through viewportStore", () => {
		const ctx = makeTestStudioContext({ ir: irWithTitle() });
		const { container } = render(
			<TestStudioProvider value={ctx}>
				<ZoomControl />
			</TestStudioProvider>,
		);
		fireEvent.click(
			container.querySelector("[data-testid='zoom-in']") as HTMLElement,
		);
		expect(ctx.viewportStore.getState().zoom).toBeCloseTo(1.1);
		expect(
			container.querySelector("[data-testid='zoom-value']")?.textContent,
		).toBe("110%");
		fireEvent.click(
			container.querySelector("[data-testid='zoom-out']") as HTMLElement,
		);
		fireEvent.click(
			container.querySelector("[data-testid='zoom-out']") as HTMLElement,
		);
		expect(ctx.viewportStore.getState().zoom).toBeCloseTo(0.9);
		expect(
			container.querySelector("[data-testid='zoom-value']")?.textContent,
		).toBe("90%");
	});
});
