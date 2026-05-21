import {
	type CanvasIR,
	type CanvasNodeKind,
	type CanvasNodeUpdateCommand,
	createCanvasIR,
	createPage,
	createRect,
	createText,
} from "@anvilkit/canvas-core";
import { fireEvent, render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import {
	CanvasStudioContext,
	type CanvasStudioContextValue,
} from "../../context/canvas-studio-context.js";
import { makeHarness } from "../../tools/__tests__/_tool-test-helpers.js";
import { PropertyInspector } from "../PropertyInspector.js";

const FIXED_TS = "2026-05-20T00:00:00.000Z";

function withRectIR(): CanvasIR {
	const ir = createCanvasIR({
		id: "ir-1",
		pages: [createPage({ id: "p1" })],
		now: () => FIXED_TS,
	});
	const rect = createRect({
		id: "rect-a",
		bounds: { width: 50, height: 60 },
		fill: "#ff0000",
		strokeWidth: 2,
		now: () => FIXED_TS,
	});
	const firstPage = ir.pages[0];
	if (!firstPage) throw new Error("expected at least one page");
	firstPage.root.children = [rect];
	return ir;
}

function withTextIR(): CanvasIR {
	const ir = createCanvasIR({
		id: "ir-1",
		pages: [createPage({ id: "p1" })],
		now: () => FIXED_TS,
	});
	const text = createText({
		id: "text-a",
		text: "Hello",
		bounds: { width: 100, height: 20 },
		now: () => FIXED_TS,
	});
	const firstPage = ir.pages[0];
	if (!firstPage) throw new Error("expected at least one page");
	firstPage.root.children = [text];
	return ir;
}

function mount(ctx: CanvasStudioContextValue) {
	return render(
		<CanvasStudioContext.Provider value={ctx}>
			<PropertyInspector />
		</CanvasStudioContext.Provider>,
	);
}

describe("PropertyInspector — empty state", () => {
	it("shows empty hint when no selection", () => {
		const h = makeHarness();
		const { container } = mount(h.studioCtx);
		expect(
			container.querySelector("[data-testid='property-inspector-empty']"),
		).not.toBeNull();
	});
});

describe("PropertyInspector — rect selected", () => {
	it("renders transform and shape fields with current values", () => {
		const h = makeHarness({ ir: withRectIR() });
		h.studioCtx.selectionStore.getState().setSelection(["rect-a"]);
		const { container } = mount(h.studioCtx);
		const width = container.querySelector(
			"[data-testid='prop-width']",
		) as HTMLInputElement;
		expect(width.defaultValue).toBe("50");
		const radius = container.querySelector("[data-testid='prop-radius']");
		expect(radius).not.toBeNull();
		const inspector = container.querySelector(
			"[data-testid='property-inspector']",
		) as HTMLElement;
		expect(inspector.getAttribute("data-node-id")).toBe("rect-a");
	});

	it("editing width fires a single node.update with bounds patch on blur", () => {
		const h = makeHarness({ ir: withRectIR() });
		h.studioCtx.selectionStore.getState().setSelection(["rect-a"]);
		const { container } = mount(h.studioCtx);
		const width = container.querySelector(
			"[data-testid='prop-width']",
		) as HTMLInputElement;
		fireEvent.input(width, { target: { value: "125" } });
		// onChange / typing does NOT commit.
		expect(h.commits).toHaveLength(0);
		fireEvent.blur(width);
		expect(h.commits).toHaveLength(1);
		const cmd = h.commits[0] as CanvasNodeUpdateCommand<CanvasNodeKind>;
		expect(cmd.type).toBe("node.update");
		expect(cmd.nodeId).toBe("rect-a");
		expect((cmd.patch as { bounds?: { width: number } }).bounds?.width).toBe(
			125,
		);
	});

	it("blurring with unchanged value does not commit", () => {
		const h = makeHarness({ ir: withRectIR() });
		h.studioCtx.selectionStore.getState().setSelection(["rect-a"]);
		const { container } = mount(h.studioCtx);
		const width = container.querySelector(
			"[data-testid='prop-width']",
		) as HTMLInputElement;
		fireEvent.blur(width);
		expect(h.commits).toHaveLength(0);
	});
});

describe("PropertyInspector — text selected", () => {
	it("renders text-specific fields", () => {
		const h = makeHarness({ ir: withTextIR() });
		h.studioCtx.selectionStore.getState().setSelection(["text-a"]);
		const { container } = mount(h.studioCtx);
		const textInput = container.querySelector(
			"[data-testid='prop-text']",
		) as HTMLInputElement;
		expect(textInput.defaultValue).toBe("Hello");
		expect(
			container.querySelector("[data-testid='prop-font-size']"),
		).not.toBeNull();
	});

	it("editing text content fires node.update on blur", () => {
		const h = makeHarness({ ir: withTextIR() });
		h.studioCtx.selectionStore.getState().setSelection(["text-a"]);
		const { container } = mount(h.studioCtx);
		const textInput = container.querySelector(
			"[data-testid='prop-text']",
		) as HTMLInputElement;
		fireEvent.input(textInput, { target: { value: "World" } });
		fireEvent.blur(textInput);
		expect(h.commits).toHaveLength(1);
		const cmd = h.commits[0] as CanvasNodeUpdateCommand<CanvasNodeKind>;
		expect((cmd.patch as { text?: string }).text).toBe("World");
	});
});
