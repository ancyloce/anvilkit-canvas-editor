import {
	type CanvasImageCrop,
	type CanvasIR,
	type CanvasNodeKind,
	type CanvasNodeUpdateCommand,
	createCanvasIR,
	createImage,
	createPage,
	createPath,
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

function withStarIR(): CanvasIR {
	const ir = createCanvasIR({
		id: "ir-1",
		pages: [createPage({ id: "p1" })],
		now: () => FIXED_TS,
	});
	const star = {
		id: "star-1",
		type: "star",
		transform: { x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1 },
		bounds: { width: 10, height: 10 },
		zIndex: 0,
		points: 5,
	};
	const firstPage = ir.pages[0];
	if (!firstPage) throw new Error("expected at least one page");
	firstPage.root.children = [star as never];
	return ir;
}

function withGradientRectIR(): CanvasIR {
	const ir = createCanvasIR({
		id: "ir-1",
		pages: [createPage({ id: "p1" })],
		now: () => FIXED_TS,
	});
	const rect = createRect({
		id: "rect-a",
		bounds: { width: 50, height: 60 },
		now: () => FIXED_TS,
	});
	const firstPage = ir.pages[0];
	if (!firstPage) throw new Error("expected at least one page");
	firstPage.root.children = [
		{
			...rect,
			fill: {
				kind: "linear",
				stops: [
					{ offset: 0, color: "#ff0000" },
					{ offset: 1, color: "#0000ff" },
				],
				from: { x: 0, y: 0 },
				to: { x: 1, y: 1 },
			},
		},
	];
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

	it("exposes the panel as a labeled region even when empty", () => {
		const h = makeHarness();
		const { container } = mount(h.studioCtx);
		const panel = container.querySelector(
			"[data-testid='property-inspector']",
		) as HTMLElement;
		// A <section> with an accessible name has the implicit ARIA role "region".
		expect(panel.tagName).toBe("SECTION");
		expect(panel.getAttribute("aria-label")).toBe("Properties");
	});
});

describe("PropertyInspector — fill type", () => {
	it("switches a node's fill to a gradient via the fill-type selector", () => {
		const h = makeHarness({ ir: withRectIR() });
		h.studioCtx.selectionStore.getState().setSelection(["rect-a"]);
		const { container } = mount(h.studioCtx);
		const select = container.querySelector(
			"[data-testid='prop-fill-type']",
		) as HTMLSelectElement;
		fireEvent.change(select, { target: { value: "linear" } });
		const last = h.commits.at(-1) as CanvasNodeUpdateCommand<"rect">;
		expect(last.type).toBe("node.update");
		expect((last.patch as { fill?: { kind?: string } }).fill?.kind).toBe(
			"linear",
		);
	});

	it("adds a shadow when a shadow color is set", () => {
		const h = makeHarness({ ir: withRectIR() });
		h.studioCtx.selectionStore.getState().setSelection(["rect-a"]);
		const { container } = mount(h.studioCtx);
		const shadow = container.querySelector(
			"[data-testid='prop-shadow-color']",
		) as HTMLInputElement;
		shadow.value = "#123456";
		fireEvent.blur(shadow);
		const last = h.commits.at(-1) as CanvasNodeUpdateCommand<"rect">;
		expect((last.patch as { shadow?: { color?: string } }).shadow?.color).toBe(
			"#123456",
		);
	});

	it("renders one color field per gradient stop", () => {
		const h = makeHarness({ ir: withGradientRectIR() });
		h.studioCtx.selectionStore.getState().setSelection(["rect-a"]);
		const { container } = mount(h.studioCtx);
		expect(
			container.querySelectorAll("[data-testid^='prop-gradient-stop-row-']"),
		).toHaveLength(2);
	});

	it("adds a gradient stop via the add-stop button", () => {
		const h = makeHarness({ ir: withGradientRectIR() });
		h.studioCtx.selectionStore.getState().setSelection(["rect-a"]);
		const { container } = mount(h.studioCtx);
		const addBtn = container.querySelector(
			"[data-testid='prop-gradient-add-stop']",
		) as HTMLButtonElement;
		fireEvent.click(addBtn);
		const last = h.commits.at(-1) as CanvasNodeUpdateCommand<"rect">;
		const fill = (last.patch as { fill?: { stops?: unknown[] } }).fill;
		expect(fill?.stops).toHaveLength(3);
	});
});

describe("PropertyInspector — custom (extension) kind", () => {
	it("renders the registered inspector fields for a custom node kind", () => {
		const h = makeHarness({ ir: withStarIR() });
		h.studioCtx.kindInspectors = {
			star: {
				kind: "star",
				render: (node) => (
					<div data-testid="star-fields">
						points:{(node as unknown as { points: number }).points}
					</div>
				),
			},
		};
		h.studioCtx.selectionStore.getState().setSelection(["star-1"]);
		const { container } = mount(h.studioCtx);
		expect(
			container.querySelector("[data-testid='star-fields']"),
		).not.toBeNull();
	});
});

describe("PropertyInspector — a11y labels", () => {
	it("exposes the populated panel as a labeled region", () => {
		const h = makeHarness({ ir: withRectIR() });
		h.studioCtx.selectionStore.getState().setSelection(["rect-a"]);
		const { container } = mount(h.studioCtx);
		const panel = container.querySelector(
			"[data-testid='property-inspector']",
		) as HTMLElement;
		// A <section> with an accessible name has the implicit ARIA role "region".
		expect(panel.tagName).toBe("SECTION");
		expect(panel.getAttribute("aria-label")).toBe("Properties");
	});

	it("gives every property input an accessible name via aria-label", () => {
		const h = makeHarness({ ir: withRectIR() });
		h.studioCtx.selectionStore.getState().setSelection(["rect-a"]);
		const { container } = mount(h.studioCtx);
		// number, text, and color inputs each carry their visible label.
		const width = container.querySelector(
			"[data-testid='prop-width']",
		) as HTMLInputElement;
		expect(width.getAttribute("aria-label")).toBe("Width");
		const name = container.querySelector(
			"[data-testid='prop-name']",
		) as HTMLInputElement;
		expect(name.getAttribute("aria-label")).toBe("Name");
		const fill = container.querySelector(
			"[data-testid='prop-fill']",
		) as HTMLInputElement;
		expect(fill.getAttribute("aria-label")).toBe("Fill");
		// No control should be left without an accessible name.
		const inputs = Array.from(container.querySelectorAll("input"));
		expect(inputs.length).toBeGreaterThan(0);
		for (const input of inputs) {
			expect(input.getAttribute("aria-label")).toBeTruthy();
		}
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

function withImageIR(crop?: CanvasImageCrop): CanvasIR {
	const ir = createCanvasIR({
		id: "ir-1",
		pages: [createPage({ id: "p1" })],
		now: () => FIXED_TS,
	});
	const image = createImage({
		id: "img-a",
		bounds: { width: 200, height: 100 },
		assetId: "asset-1",
		...(crop ? { crop } : {}),
	});
	const firstPage = ir.pages[0];
	if (!firstPage) throw new Error("expected at least one page");
	firstPage.root.children = [image];
	return ir;
}

describe("PropertyInspector — image crop", () => {
	it("renders crop fields seeded from the node's crop", () => {
		const h = makeHarness({
			ir: withImageIR({ x: 5, y: 6, width: 70, height: 80 }),
		});
		h.studioCtx.selectionStore.getState().setSelection(["img-a"]);
		const { container } = mount(h.studioCtx);
		const w = container.querySelector(
			"[data-testid='prop-crop-width']",
		) as HTMLInputElement;
		expect(w.defaultValue).toBe("70");
		const x = container.querySelector(
			"[data-testid='prop-crop-x']",
		) as HTMLInputElement;
		expect(x.defaultValue).toBe("5");
	});

	it("editing a crop field commits node.update merging the crop rect", () => {
		const h = makeHarness({
			ir: withImageIR({ x: 5, y: 6, width: 70, height: 80 }),
		});
		h.studioCtx.selectionStore.getState().setSelection(["img-a"]);
		const { container } = mount(h.studioCtx);
		const w = container.querySelector(
			"[data-testid='prop-crop-width']",
		) as HTMLInputElement;
		fireEvent.input(w, { target: { value: "120" } });
		fireEvent.blur(w);
		expect(h.commits).toHaveLength(1);
		const cmd = h.commits[0] as CanvasNodeUpdateCommand<CanvasNodeKind>;
		expect(cmd.type).toBe("node.update");
		expect((cmd.patch as { crop?: CanvasImageCrop }).crop).toEqual({
			x: 5,
			y: 6,
			width: 120,
			height: 80,
		});
	});

	it("shows a Clear crop control only when a crop exists and clears it", () => {
		const h = makeHarness({
			ir: withImageIR({ x: 5, y: 6, width: 70, height: 80 }),
		});
		h.studioCtx.selectionStore.getState().setSelection(["img-a"]);
		const { container } = mount(h.studioCtx);
		const clear = container.querySelector(
			"[data-testid='prop-crop-clear']",
		) as HTMLButtonElement;
		expect(clear).not.toBeNull();
		fireEvent.click(clear);
		expect(h.commits).toHaveLength(1);
		const cmd = h.commits[0] as CanvasNodeUpdateCommand<CanvasNodeKind>;
		expect("crop" in cmd.patch).toBe(true);
		expect((cmd.patch as { crop?: CanvasImageCrop }).crop).toBeUndefined();
	});

	it("hides the Clear crop control when there is no crop", () => {
		const h = makeHarness({ ir: withImageIR() });
		h.studioCtx.selectionStore.getState().setSelection(["img-a"]);
		const { container } = mount(h.studioCtx);
		expect(
			container.querySelector("[data-testid='prop-crop-clear']"),
		).toBeNull();
	});

	it("the Crop image button opens the interactive crop editor", () => {
		const h = makeHarness({ ir: withImageIR() });
		h.studioCtx.selectionStore.getState().setSelection(["img-a"]);
		const { container } = mount(h.studioCtx);
		const btn = container.querySelector(
			"[data-testid='prop-crop-begin']",
		) as HTMLButtonElement;
		fireEvent.click(btn);
		expect(h.studioCtx.cropStore?.getState().cropNodeId).toBe("img-a");
	});
});

function withPathIR(): CanvasIR {
	const ir = createCanvasIR({
		id: "ir-1",
		pages: [createPage({ id: "p1" })],
		now: () => FIXED_TS,
	});
	const firstPage = ir.pages[0];
	if (!firstPage) throw new Error("expected at least one page");
	firstPage.root.children = [
		createPath({
			id: "path-a",
			bounds: { width: 10, height: 10 },
			d: "M 0 0 L 10 0",
		}),
	];
	return ir;
}

describe("PropertyInspector — path", () => {
	it("edits the raw d via node.update", () => {
		const h = makeHarness({ ir: withPathIR() });
		h.studioCtx.selectionStore.getState().setSelection(["path-a"]);
		const { container } = mount(h.studioCtx);
		const input = container.querySelector(
			"[data-testid='prop-path-d']",
		) as HTMLInputElement;
		expect(input.defaultValue).toBe("M 0 0 L 10 0");
		fireEvent.input(input, { target: { value: "M 0 0 L 20 0 Z" } });
		fireEvent.blur(input);
		expect(h.commits).toHaveLength(1);
		const cmd = h.commits[0] as CanvasNodeUpdateCommand<CanvasNodeKind>;
		expect((cmd.patch as { d?: string }).d).toBe("M 0 0 L 20 0 Z");
	});

	it("the Edit points button enters path point-editing mode", () => {
		const h = makeHarness({ ir: withPathIR() });
		h.studioCtx.selectionStore.getState().setSelection(["path-a"]);
		const { container } = mount(h.studioCtx);
		const btn = container.querySelector(
			"[data-testid='prop-path-edit']",
		) as HTMLButtonElement;
		fireEvent.click(btn);
		expect(h.studioCtx.pathEditStore?.getState().editNodeId).toBe("path-a");
	});
});
