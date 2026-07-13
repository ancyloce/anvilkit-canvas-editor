import {
	type CanvasImageCrop,
	type CanvasImageReplaceCommand,
	type CanvasIR,
	type CanvasNodeCreateCommand,
	type CanvasNodeKind,
	type CanvasNodeUpdateCommand,
	createCanvasIR,
	createFrame,
	createImage,
	createPage,
	createPath,
	createPolygon,
	createRect,
	createRichText,
	createStar,
	createText,
} from "@anvilkit/canvas-core";
import { fireEvent, render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import {
	CanvasStudioContext,
	type CanvasStudioContextValue,
} from "@/context/canvas-studio-context.js";
import { makeHarness } from "@/tools/__tests__/_tool-test-helpers.js";
import type { BrandKit } from "../../brand/brand-kit.js";
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

function withPolygonIR(): CanvasIR {
	const ir = createCanvasIR({
		id: "ir-1",
		pages: [createPage({ id: "p1" })],
		now: () => FIXED_TS,
	});
	const polygon = createPolygon({
		id: "polygon-a",
		bounds: { width: 50, height: 60 },
		sides: 6,
		fill: "#ff0000",
	});
	const firstPage = ir.pages[0];
	if (!firstPage) throw new Error("expected at least one page");
	firstPage.root.children = [polygon];
	return ir;
}

function withStarIR(): CanvasIR {
	const ir = createCanvasIR({
		id: "ir-1",
		pages: [createPage({ id: "p1" })],
		now: () => FIXED_TS,
	});
	const star = createStar({
		id: "star-a",
		bounds: { width: 50, height: 60 },
		points: 6,
		innerRadiusRatio: 0.4,
		fill: "#00ff00",
	});
	const firstPage = ir.pages[0];
	if (!firstPage) throw new Error("expected at least one page");
	firstPage.root.children = [star];
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

/**
 * Fake CUSTOM (non-built-in) node kind. Named "pinwheel", not "star" — "star"
 * is now a real built-in kind (canvas-m1-011) with its own renderTypeSpecificFields
 * case, so the switch would render it before ever reaching the
 * ctx.kindInspectors fallback this test exists to exercise.
 */
function withPinwheelIR(): CanvasIR {
	const ir = createCanvasIR({
		id: "ir-1",
		pages: [createPage({ id: "p1" })],
		now: () => FIXED_TS,
	});
	const pinwheel = {
		id: "pinwheel-1",
		type: "pinwheel",
		transform: { x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1 },
		bounds: { width: 10, height: 10 },
		zIndex: 0,
		points: 5,
	};
	const firstPage = ir.pages[0];
	if (!firstPage) throw new Error("expected at least one page");
	firstPage.root.children = [pinwheel as never];
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
		const h = makeHarness({ ir: withPinwheelIR() });
		h.studioCtx.kindInspectors = {
			pinwheel: {
				kind: "pinwheel",
				render: (node) => (
					<div data-testid="pinwheel-fields">
						points:{(node as unknown as { points: number }).points}
					</div>
				),
			},
		};
		h.studioCtx.selectionStore.getState().setSelection(["pinwheel-1"]);
		const { container } = mount(h.studioCtx);
		expect(
			container.querySelector("[data-testid='pinwheel-fields']"),
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

describe("PropertyInspector — polygon selected", () => {
	it("renders the sides field seeded from the node's current value", () => {
		const h = makeHarness({ ir: withPolygonIR() });
		h.studioCtx.selectionStore.getState().setSelection(["polygon-a"]);
		const { container } = mount(h.studioCtx);
		const sides = container.querySelector(
			"[data-testid='prop-polygon-sides']",
		) as HTMLInputElement;
		expect(sides.defaultValue).toBe("6");
		expect(container.querySelector("[data-testid='prop-fill']")).not.toBeNull();
	});

	it("editing sides fires a node.update, rounded to the nearest integer", () => {
		const h = makeHarness({ ir: withPolygonIR() });
		h.studioCtx.selectionStore.getState().setSelection(["polygon-a"]);
		const { container } = mount(h.studioCtx);
		const sides = container.querySelector(
			"[data-testid='prop-polygon-sides']",
		) as HTMLInputElement;
		fireEvent.input(sides, { target: { value: "8" } });
		fireEvent.blur(sides);
		expect(h.commits).toHaveLength(1);
		const cmd = h.commits[0] as CanvasNodeUpdateCommand<"polygon">;
		expect(cmd.type).toBe("node.update");
		expect(cmd.nodeId).toBe("polygon-a");
		expect((cmd.patch as { sides?: number }).sides).toBe(8);
	});
});

describe("PropertyInspector — star selected", () => {
	it("renders points and inner-radius fields seeded from the node's current values", () => {
		const h = makeHarness({ ir: withStarIR() });
		h.studioCtx.selectionStore.getState().setSelection(["star-a"]);
		const { container } = mount(h.studioCtx);
		const points = container.querySelector(
			"[data-testid='prop-star-points']",
		) as HTMLInputElement;
		expect(points.defaultValue).toBe("6");
		const innerRadius = container.querySelector(
			"[data-testid='prop-star-inner-radius']",
		) as HTMLInputElement;
		expect(innerRadius.defaultValue).toBe("0.4");
	});

	it("editing innerRadiusRatio fires a node.update", () => {
		const h = makeHarness({ ir: withStarIR() });
		h.studioCtx.selectionStore.getState().setSelection(["star-a"]);
		const { container } = mount(h.studioCtx);
		const innerRadius = container.querySelector(
			"[data-testid='prop-star-inner-radius']",
		) as HTMLInputElement;
		fireEvent.input(innerRadius, { target: { value: "0.6" } });
		fireEvent.blur(innerRadius);
		expect(h.commits).toHaveLength(1);
		const cmd = h.commits[0] as CanvasNodeUpdateCommand<"star">;
		expect(cmd.type).toBe("node.update");
		expect(cmd.nodeId).toBe("star-a");
		expect((cmd.patch as { innerRadiusRatio?: number }).innerRadiusRatio).toBe(
			0.6,
		);
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

const TEST_BRAND_KIT: BrandKit = {
	colors: [{ id: "brand.primary", name: "Primary", value: "#2563eb" }],
	fonts: ["Inter"],
};

function withTokenTextIR(fill: unknown, fontFamily: unknown): CanvasIR {
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
	firstPage.root.children = [
		{ ...text, fill: fill as never, fontFamily: fontFamily as never },
	];
	return ir;
}

describe("PropertyInspector — brand tokens (canvas-m1-013, picker UI canvas-m2-007)", () => {
	it("resolves a color/font token against the injected brandKit as a selected picker option, with no unresolved badge", () => {
		const h = makeHarness({
			ir: withTokenTextIR(
				{ type: "brand-token", tokenType: "color", id: "brand.primary" },
				{ type: "brand-token", tokenType: "font", id: "inter" },
			),
		});
		h.studioCtx.brandKit = TEST_BRAND_KIT;
		h.studioCtx.selectionStore.getState().setSelection(["text-a"]);
		const { container } = mount(h.studioCtx);
		const fillTrigger = container.querySelector(
			"[data-testid='prop-text-fill']",
		);
		const fontTrigger = container.querySelector(
			"[data-testid='prop-font-family']",
		);
		expect(fillTrigger?.textContent).toContain("Primary");
		expect(fontTrigger?.textContent).toContain("Inter");
		expect(
			container.querySelectorAll("[data-testid='prop-token-unresolved-badge']"),
		).toHaveLength(0);
	});

	it("degrades an unresolved token to an unresolved badge, without crashing", () => {
		const h = makeHarness({
			ir: withTokenTextIR(
				{ type: "brand-token", tokenType: "color", id: "does-not-exist" },
				{ type: "brand-token", tokenType: "font", id: "does-not-exist" },
			),
		});
		h.studioCtx.brandKit = TEST_BRAND_KIT;
		h.studioCtx.selectionStore.getState().setSelection(["text-a"]);
		expect(() => mount(h.studioCtx)).not.toThrow();
		const { container } = mount(h.studioCtx);
		// Both the fill and font fields are unresolved tokens, so two badges render.
		expect(
			container.querySelectorAll("[data-testid='prop-token-unresolved-badge']"),
		).toHaveLength(2);
	});

	// Deliverable #5 (canvas-m2-007): detaching a token to a literal is now an
	// EXPLICIT action (a "Detach" button), not an implicit side effect of
	// editing a plain input — there is no plain input to edit while in token mode.
	it("detaches to a literal color via the explicit Detach action", () => {
		const h = makeHarness({
			ir: withTokenTextIR(
				{ type: "brand-token", tokenType: "color", id: "brand.primary" },
				"Georgia",
			),
		});
		h.studioCtx.brandKit = TEST_BRAND_KIT;
		h.studioCtx.selectionStore.getState().setSelection(["text-a"]);
		const { container } = mount(h.studioCtx);
		const detachButton = container.querySelector(
			"[data-testid='prop-text-fill-detach']",
		);
		expect(detachButton).not.toBeNull();
		fireEvent.click(detachButton as Element);
		expect(h.commits).toHaveLength(1);
		const cmd = h.commits[0] as CanvasNodeUpdateCommand<CanvasNodeKind>;
		expect((cmd.patch as { fill?: unknown }).fill).toBe("#2563eb");
	});

	// FillAndShadowFields (shared by rect/ellipse/polygon/star/frame) reads
	// brandKit via useBrandKit(), a separate path from renderTextFields' direct
	// ctx.brandKit read — cover it independently.
	it("resolves a rect's solid-fill color token via FillAndShadowFields", () => {
		const h = makeHarness({ ir: withRectIR() });
		h.studioCtx.brandKit = TEST_BRAND_KIT;
		const rectIR = h.ir.pages[0]?.root.children[0];
		if (!rectIR || rectIR.type !== "rect")
			throw new Error("expected the fixture rect");
		rectIR.fill = {
			type: "brand-token",
			tokenType: "color",
			id: "brand.primary",
		} as never;
		h.studioCtx.selectionStore.getState().setSelection(["rect-a"]);
		const { container } = mount(h.studioCtx);
		const fillTrigger = container.querySelector("[data-testid='prop-fill']");
		expect(fillTrigger?.textContent).toContain("Primary");
		expect(
			container.querySelectorAll("[data-testid='prop-token-unresolved-badge']"),
		).toHaveLength(0);
	});

	it("flags an unresolved rect fill token with an unresolved badge, without crashing", () => {
		const h = makeHarness({ ir: withRectIR() });
		h.studioCtx.brandKit = TEST_BRAND_KIT;
		const rectIR = h.ir.pages[0]?.root.children[0];
		if (!rectIR || rectIR.type !== "rect")
			throw new Error("expected the fixture rect");
		rectIR.fill = {
			type: "brand-token",
			tokenType: "color",
			id: "does-not-exist",
		} as never;
		h.studioCtx.selectionStore.getState().setSelection(["rect-a"]);
		expect(() => mount(h.studioCtx)).not.toThrow();
		const { container } = mount(h.studioCtx);
		expect(
			container.querySelectorAll("[data-testid='prop-token-unresolved-badge']"),
		).toHaveLength(1);
	});
});

function withRichTextIR(): CanvasIR {
	const ir = createCanvasIR({
		id: "ir-1",
		pages: [createPage({ id: "p1" })],
		now: () => FIXED_TS,
	});
	const richText = createRichText({
		id: "rt-a",
		bounds: { width: 240, height: 60 },
		paragraphs: [
			{
				align: "center",
				lineHeight: 1.5,
				spans: [
					{
						text: "First",
						fontFamily: "Georgia",
						fontSize: 20,
						fontWeight: "700",
						italic: true,
						underline: true,
						letterSpacing: 0.5,
						textTransform: "uppercase",
						fill: "#ff0000",
					},
				],
			},
			{ spans: [{ text: "Second" }] },
		],
		wrap: "character",
		overflow: "clip",
	});
	const firstPage = ir.pages[0];
	if (!firstPage) throw new Error("expected at least one page");
	firstPage.root.children = [richText];
	return ir;
}

describe("PropertyInspector — rich-text selected", () => {
	it("renders rich-text fields seeded from the node's current values", () => {
		const h = makeHarness({ ir: withRichTextIR() });
		h.studioCtx.selectionStore.getState().setSelection(["rt-a"]);
		const { container } = mount(h.studioCtx);
		const wrap = container.querySelector(
			"[data-testid='prop-rich-text-wrap']",
		) as HTMLSelectElement;
		expect(wrap.value).toBe("character");
		const overflow = container.querySelector(
			"[data-testid='prop-rich-text-overflow']",
		) as HTMLSelectElement;
		expect(overflow.value).toBe("clip");
		const align = container.querySelector(
			"[data-testid='prop-rich-text-align']",
		) as HTMLSelectElement;
		expect(align.value).toBe("center");
		const lineHeight = container.querySelector(
			"[data-testid='prop-rich-text-line-height']",
		) as HTMLInputElement;
		expect(lineHeight.defaultValue).toBe("1.5");
		const fontFamily = container.querySelector(
			"[data-testid='prop-rich-text-font-family']",
		) as HTMLInputElement;
		expect(fontFamily.defaultValue).toBe("Georgia");
		const fontSize = container.querySelector(
			"[data-testid='prop-rich-text-font-size']",
		) as HTMLInputElement;
		expect(fontSize.defaultValue).toBe("20");
	});

	it("changing wrap commits a node-level patch, not a paragraph rewrite", () => {
		const h = makeHarness({ ir: withRichTextIR() });
		h.studioCtx.selectionStore.getState().setSelection(["rt-a"]);
		const { container } = mount(h.studioCtx);
		const wrap = container.querySelector(
			"[data-testid='prop-rich-text-wrap']",
		) as HTMLSelectElement;
		fireEvent.change(wrap, { target: { value: "none" } });
		const last = h.commits.at(-1) as CanvasNodeUpdateCommand<"rich-text">;
		expect(last.type).toBe("node.update");
		expect(last.kind).toBe("rich-text");
		expect(last.patch).toEqual({ wrap: "none" });
	});

	it("changing align commits the new align onto every paragraph", () => {
		const h = makeHarness({ ir: withRichTextIR() });
		h.studioCtx.selectionStore.getState().setSelection(["rt-a"]);
		const { container } = mount(h.studioCtx);
		const align = container.querySelector(
			"[data-testid='prop-rich-text-align']",
		) as HTMLSelectElement;
		fireEvent.change(align, { target: { value: "right" } });
		const last = h.commits.at(-1) as CanvasNodeUpdateCommand<"rich-text">;
		const paragraphs = (
			last.patch as { paragraphs?: Array<{ align?: string }> }
		).paragraphs;
		expect(paragraphs).toHaveLength(2);
		expect(paragraphs?.every((p) => p.align === "right")).toBe(true);
		// The second paragraph's span text is untouched by the align commit.
		expect(
			(paragraphs as unknown as Array<{ spans: Array<{ text: string }> }>)[1]
				?.spans[0]?.text,
		).toBe("Second");
	});

	it("changing the font family commits onto every span across every paragraph", () => {
		const h = makeHarness({ ir: withRichTextIR() });
		h.studioCtx.selectionStore.getState().setSelection(["rt-a"]);
		const { container } = mount(h.studioCtx);
		const fontFamily = container.querySelector(
			"[data-testid='prop-rich-text-font-family']",
		) as HTMLInputElement;
		fireEvent.input(fontFamily, { target: { value: "Courier" } });
		fireEvent.blur(fontFamily);
		const last = h.commits.at(-1) as CanvasNodeUpdateCommand<"rich-text">;
		const paragraphs = (
			last.patch as {
				paragraphs?: Array<{ spans: Array<{ fontFamily?: string }> }>;
			}
		).paragraphs;
		expect(paragraphs?.[0]?.spans[0]?.fontFamily).toBe("Courier");
		expect(paragraphs?.[1]?.spans[0]?.fontFamily).toBe("Courier");
	});

	it("toggling italic commits true onto every span", () => {
		const h = makeHarness({ ir: withRichTextIR() });
		h.studioCtx.selectionStore.getState().setSelection(["rt-a"]);
		const { container } = mount(h.studioCtx);
		const italic = container.querySelector(
			"[data-testid='prop-rich-text-italic']",
		) as HTMLElement;
		// Fixture's first span already has italic: true — toggling flips to false.
		fireEvent.click(italic);
		const last = h.commits.at(-1) as CanvasNodeUpdateCommand<"rich-text">;
		const paragraphs = (
			last.patch as {
				paragraphs?: Array<{ spans: Array<{ italic?: boolean }> }>;
			}
		).paragraphs;
		expect(paragraphs?.[0]?.spans[0]?.italic).toBe(false);
		expect(paragraphs?.[1]?.spans[0]?.italic).toBe(false);
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

function withFrameIR(
	over: Partial<Parameters<typeof createFrame>[0]> = {},
): CanvasIR {
	const ir = createCanvasIR({
		id: "ir-1",
		pages: [createPage({ id: "p1" })],
		now: () => FIXED_TS,
	});
	const frame = createFrame({
		id: "frame-a",
		bounds: { width: 200, height: 100 },
		children: [
			createRect({
				id: "in-frame",
				bounds: { width: 10, height: 10 },
				now: () => FIXED_TS,
			}),
		],
		...over,
	});
	const firstPage = ir.pages[0];
	if (!firstPage) throw new Error("expected at least one page");
	firstPage.root.children = [frame];
	return ir;
}

describe("PropertyInspector — frame", () => {
	function mountFrame(over: Partial<Parameters<typeof createFrame>[0]> = {}) {
		const h = makeHarness({ ir: withFrameIR(over) });
		h.studioCtx.selectionStore.getState().setSelection(["frame-a"]);
		return { h, ...mount(h.studioCtx) };
	}

	it("renders the frame section instead of falling through to the custom-kind branch", () => {
		const { container } = mountFrame();
		expect(
			container.querySelector("[data-testid='prop-frame-clip']"),
		).not.toBeNull();
		expect(
			container.querySelector("[data-testid='prop-frame-radius']"),
		).not.toBeNull();
		expect(
			container.querySelector("[data-testid='prop-children-count']")
				?.textContent,
		).toBe("1");
	});

	it("toggling clip commits a node.update with clip: true", () => {
		const { h, container } = mountFrame({ clip: false });
		const toggle = container.querySelector(
			"[data-testid='prop-frame-clip']",
		) as HTMLElement;
		fireEvent.click(toggle);
		const last = h.commits.at(-1) as CanvasNodeUpdateCommand<"frame">;
		expect(last.type).toBe("node.update");
		expect(last.nodeId).toBe("frame-a");
		expect((last.patch as { clip?: boolean }).clip).toBe(true);
	});

	it("commits radius on the frame", () => {
		const { h, container } = mountFrame();
		const input = container.querySelector(
			"[data-testid='prop-frame-radius']",
		) as HTMLInputElement;
		fireEvent.change(input, { target: { value: "16" } });
		fireEvent.blur(input);
		const last = h.commits.at(-1) as CanvasNodeUpdateCommand<"frame">;
		expect((last.patch as { radius?: number }).radius).toBe(16);
	});

	// The frame's fill lives under `background`, not `fill` — this is the whole
	// reason FillAndShadowFields grew a `fillKey` seam.
	it("writes the background fill to `background`, never to `fill`", () => {
		const { h, container } = mountFrame();
		const select = container.querySelector(
			"[data-testid='prop-fill-type']",
		) as HTMLSelectElement;
		fireEvent.change(select, { target: { value: "linear" } });
		const last = h.commits.at(-1) as CanvasNodeUpdateCommand<"frame">;
		const patch = last.patch as {
			background?: { kind?: string };
			fill?: unknown;
		};
		expect(patch.background?.kind).toBe("linear");
		expect(patch.fill).toBeUndefined();
	});

	it("hides the shadow controls — a frame has no shadow field", () => {
		const { container } = mountFrame();
		expect(
			container.querySelector("[data-testid='prop-shadow-color']"),
		).toBeNull();
	});
});

function wellIR(
	over: Partial<Parameters<typeof createFrame>[0]> = {},
): CanvasIR {
	const ir = createCanvasIR({
		id: "ir-1",
		pages: [createPage({ id: "p1" })],
		now: () => FIXED_TS,
	});
	ir.assets = {
		"asset-1": { id: "asset-1", uri: "data:1", width: 400, height: 100 },
		"asset-2": { id: "asset-2", uri: "data:2", width: 400, height: 100 },
	};
	const firstPage = ir.pages[0];
	if (!firstPage) throw new Error("expected at least one page");
	firstPage.root.children = [
		createFrame({
			id: "well-a",
			bounds: { width: 200, height: 100 },
			clip: true,
			radius: 8,
			placeholder: { kind: "image" },
			...over,
		}),
	];
	return ir;
}

const filledWell = () => ({
	placeholder: { kind: "image" as const, assetId: "asset-2" },
	children: [
		createImage({
			id: "well-img",
			bounds: { width: 400, height: 100 },
			transform: { x: -100, y: 0 },
			assetId: "asset-2",
			crop: { x: 5, y: 5, width: 20, height: 20 },
			now: () => FIXED_TS,
		}),
	],
});

async function settle(): Promise<void> {
	await Promise.resolve();
	await Promise.resolve();
}

describe("PropertyInspector — frame image well", () => {
	function mountWell(over: Partial<Parameters<typeof createFrame>[0]> = {}) {
		const h = makeHarness({ ir: wellIR(over) });
		h.studioCtx.selectionStore.getState().setSelection(["well-a"]);
		return { h, ...mount(h.studioCtx) };
	}

	it("offers Add image on an EMPTY well, and no reset-crop control", () => {
		const { container } = mountWell();
		const btn = container.querySelector("[data-testid='prop-frame-replace']");
		expect(btn?.textContent).toBe("Add image");
		expect(
			container.querySelector("[data-testid='prop-frame-reset-crop']"),
		).toBeNull();
	});

	it("offers Replace image once the well is filled", () => {
		const { container } = mountWell(filledWell());
		expect(
			container.querySelector("[data-testid='prop-frame-replace']")
				?.textContent,
		).toBe("Replace image");
	});

	it("shows no image controls on a plain frame — it is not a well", () => {
		const h = makeHarness({ ir: withFrameIR() });
		h.studioCtx.selectionStore.getState().setSelection(["frame-a"]);
		const { container } = mount(h.studioCtx);
		expect(
			container.querySelector("[data-testid='prop-frame-replace']"),
		).toBeNull();
	});

	it("Add image places a cover-sized child + fills the placeholder in ONE batch", async () => {
		const { h, container } = mountWell();
		const btn = container.querySelector(
			"[data-testid='prop-frame-replace']",
		) as HTMLButtonElement;
		fireEvent.click(btn);
		await settle();

		expect(h.studioCtx.commitBatch).toHaveBeenCalledTimes(1);
		expect(h.commits.map((c) => c.type)).toEqual([
			"node.create",
			"node.update",
		]);
		const create = h.commits[0] as CanvasNodeCreateCommand;
		// Inserted INTO the frame, never as a loose sibling.
		expect(create.parentId).toBe("well-a");
		expect(create.node.type).toBe("image");
	});

	it("Replace image swaps the asset via image.replace and re-points the placeholder", async () => {
		const { h, container } = mountWell(filledWell());
		const btn = container.querySelector(
			"[data-testid='prop-frame-replace']",
		) as HTMLButtonElement;
		fireEvent.click(btn);
		await settle();

		expect(h.commits.map((c) => c.type)).toEqual([
			"image.replace",
			"node.update",
		]);
		const replace = h.commits[0] as CanvasImageReplaceCommand;
		expect(replace.nodeId).toBe("well-img");
		expect(replace.fromAssetId).toBe("asset-2");
		expect(replace.toAssetId).toBe("asset-1");
		// The frame itself is never resized or re-clipped by a replace.
		const patch = h.commits[1] as CanvasNodeUpdateCommand<"frame">;
		expect(patch.nodeId).toBe("well-a");
		expect(Object.keys(patch.patch)).toEqual(["placeholder"]);
	});

	it("Reset crop clears the well image's crop and leaves the frame alone", () => {
		const { h, container } = mountWell(filledWell());
		const btn = container.querySelector(
			"[data-testid='prop-frame-reset-crop']",
		) as HTMLButtonElement;
		fireEvent.click(btn);

		const last = h.commits.at(-1) as CanvasNodeUpdateCommand<"image">;
		expect(last.type).toBe("node.update");
		expect(last.nodeId).toBe("well-img");
		expect((last.patch as { crop?: unknown }).crop).toBeUndefined();
	});
});

describe("PropertyInspector — image replace", () => {
	it("replaces a loose image's asset with a single image.replace", async () => {
		const h = makeHarness({ ir: withImageIR() });
		// The fixture image already holds `asset-1` — the harness's default pick —
		// so point the picker somewhere else or the replace is correctly a no-op.
		h.studioCtx.pickAsset = vi.fn(() => Promise.resolve("asset-2"));
		h.studioCtx.selectionStore.getState().setSelection(["img-a"]);
		const { container } = mount(h.studioCtx);
		const btn = container.querySelector(
			"[data-testid='prop-image-replace']",
		) as HTMLButtonElement;
		fireEvent.click(btn);
		await settle();

		const last = h.commits.at(-1) as CanvasImageReplaceCommand;
		expect(last.type).toBe("image.replace");
		expect(last.nodeId).toBe("img-a");
		expect(last.fromAssetId).toBe("asset-1");
		expect(last.toAssetId).toBe("asset-2");
		// A loose image has no well, so no placeholder update and no batch.
		expect(h.commits).toHaveLength(1);
		expect(h.studioCtx.commitBatch).not.toHaveBeenCalled();
	});

	it("re-picking the asset the image already has is a no-op, not an undo step", async () => {
		const h = makeHarness({ ir: withImageIR() });
		h.studioCtx.selectionStore.getState().setSelection(["img-a"]);
		const { container } = mount(h.studioCtx);
		fireEvent.click(
			container.querySelector(
				"[data-testid='prop-image-replace']",
			) as HTMLButtonElement,
		);
		await settle();
		expect(h.commits).toHaveLength(0);
	});
});

describe("PropertyInspector — image-well toggle", () => {
	// The bridge between the frame tool (which makes plain frames) and the m1-005
	// image workflow (which needs a well). Without it, a drawn frame could never
	// become an image placeholder.
	it("turns a plain frame into an image well", () => {
		const h = makeHarness({ ir: withFrameIR() });
		h.studioCtx.selectionStore.getState().setSelection(["frame-a"]);
		const { container } = mount(h.studioCtx);
		expect(
			container.querySelector("[data-testid='prop-frame-replace']"),
		).toBeNull();

		fireEvent.click(
			container.querySelector("[data-testid='prop-frame-well']") as HTMLElement,
		);
		const last = h.commits.at(-1) as CanvasNodeUpdateCommand<"frame">;
		expect((last.patch as { placeholder?: unknown }).placeholder).toEqual({
			kind: "image",
		});
	});

	it("turning the well off is non-destructive — it only clears the placeholder", () => {
		const h = makeHarness({ ir: wellIR(filledWell()) });
		h.studioCtx.selectionStore.getState().setSelection(["well-a"]);
		const { container } = mount(h.studioCtx);
		fireEvent.click(
			container.querySelector("[data-testid='prop-frame-well']") as HTMLElement,
		);
		const last = h.commits.at(-1) as CanvasNodeUpdateCommand<"frame">;
		// The image child is untouched; only `placeholder` is dropped.
		expect(Object.keys(last.patch)).toEqual(["placeholder"]);
		expect(
			(last.patch as { placeholder?: unknown }).placeholder,
		).toBeUndefined();
	});
});
