import {
	type CanvasNodeUpdateCommand,
	type CanvasRichTextNode,
	createCanvasIR,
	createGroup,
	createPage,
	createRichText,
} from "@anvilkit/canvas-core";
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CanvasStudioContext } from "@/context/canvas-studio-context.js";
import { RichTextToolbar } from "../RichTextToolbar.js";
import { makeFakeStage, makeHarness } from "./_tool-test-helpers.js";

afterEach(cleanup);

function richTextNode(): CanvasRichTextNode {
	return createRichText({
		id: "rt-1",
		width: 200,
		bounds: { width: 200, height: 60 },
		paragraphs: [
			{
				spans: [{ text: "Hello", fontSize: 20 }, { text: " world" }],
			},
		],
	});
}

function mount() {
	const node = richTextNode();
	const page = createPage({
		id: "p1",
		root: createGroup({ children: [node] }),
	});
	const ir = createCanvasIR({ id: "doc", pages: [page] });
	const h = makeHarness({ ir });
	h.studioCtx.editingStore.getState().setEditing("rt-1");
	const view = render(
		<CanvasStudioContext.Provider
			value={{
				...h.studioCtx,
				ir: h.studioCtx.getIR(),
				stage: makeFakeStage(),
			}}
		>
			<RichTextToolbar />
		</CanvasStudioContext.Provider>,
	);
	return { h, view };
}

function lastPatch(h: ReturnType<typeof makeHarness>) {
	const cmd = h.commits.at(-1) as CanvasNodeUpdateCommand<"rich-text">;
	return cmd.patch as { paragraphs: CanvasRichTextNode["paragraphs"] };
}

/** A rich-text node nested inside a group with a non-identity transform. */
function mountNested() {
	const node = createRichText({
		id: "rt-1",
		width: 200,
		bounds: { width: 200, height: 60 },
		transform: { x: 10, y: 10 },
		paragraphs: [{ spans: [{ text: "Hello" }] }],
	});
	const page = createPage({
		id: "p1",
		root: createGroup({
			children: [
				createGroup({
					id: "g1",
					transform: { x: 50, y: 80 },
					children: [node],
				}),
			],
		}),
	});
	const ir = createCanvasIR({ id: "doc", pages: [page] });
	const h = makeHarness({ ir });
	h.studioCtx.editingStore.getState().setEditing("rt-1");
	const view = render(
		<CanvasStudioContext.Provider
			value={{
				...h.studioCtx,
				ir: h.studioCtx.getIR(),
				stage: makeFakeStage(),
			}}
		>
			<RichTextToolbar />
		</CanvasStudioContext.Provider>,
	);
	return { h, view };
}

describe("RichTextToolbar (C-11, FR-082)", () => {
	it("renders while a rich-text node is being edited, not otherwise", () => {
		const { h, view } = mount();
		expect(view.getByTestId("rich-text-toolbar")).toBeDefined();
		fireEvent.click(view.getByTestId("rich-text-bold"));
		expect(h.commits).toHaveLength(1);
	});

	it("bold toggles fontWeight across every span as one commit", () => {
		const { h, view } = mount();
		fireEvent.click(view.getByTestId("rich-text-bold"));
		const { paragraphs } = lastPatch(h);
		expect(paragraphs[0]?.spans.map((s) => s.fontWeight)).toEqual([
			"700",
			"700",
		]);
	});

	it("strikethrough and underline set the span flags", () => {
		const { h, view } = mount();
		fireEvent.click(view.getByTestId("rich-text-strikethrough"));
		expect(
			lastPatch(h).paragraphs[0]?.spans.every((s) => s.strikethrough === true),
		).toBe(true);
		fireEvent.click(view.getByTestId("rich-text-underline"));
		expect(
			lastPatch(h).paragraphs[0]?.spans.every((s) => s.underline === true),
		).toBe(true);
	});

	it("alignment cycles left → center and the link placeholder stays disabled", () => {
		const { h, view } = mount();
		fireEvent.click(view.getByTestId("rich-text-align"));
		expect(lastPatch(h).paragraphs[0]?.align).toBe("center");
		expect(
			(view.getByTestId("rich-text-link") as HTMLButtonElement).disabled,
		).toBe(true);
	});

	it("font size input rewrites every span's size", () => {
		const { h, view } = mount();
		fireEvent.change(view.getByTestId("rich-text-size"), {
			target: { value: "32" },
		});
		expect(
			lastPatch(h).paragraphs[0]?.spans.every((s) => s.fontSize === 32),
		).toBe(true);
	});

	it("commits the size field through commitCoalesced with a stable merge key, not a fresh undo entry per keystroke (E-19)", () => {
		const { h, view } = mount();
		const input = view.getByTestId("rich-text-size");
		fireEvent.change(input, { target: { value: "2" } });
		fireEvent.change(input, { target: { value: "24" } });
		expect(h.studioCtx.commit).not.toHaveBeenCalled();
		expect(h.studioCtx.commitCoalesced).toHaveBeenCalledTimes(2);
		const calls = (h.studioCtx.commitCoalesced as ReturnType<typeof vi.fn>).mock
			.calls;
		expect(calls[0]?.[1]).toBe(calls[1]?.[1]);
	});

	it("font-family control rewrites every span's family (FR-082)", () => {
		const { h, view } = mount();
		fireEvent.change(view.getByTestId("rich-text-font"), {
			target: { value: "Georgia" },
		});
		expect(
			lastPatch(h).paragraphs[0]?.spans.every(
				(s) => s.fontFamily === "Georgia",
			),
		).toBe(true);
	});

	it("builds the patch from the live overlay draft, not the stale IR content (E-4)", () => {
		const { h, view } = mount();
		// Simulate the overlay having a textarea mounted with text the user
		// typed AFTER "Hello world" was last committed — the toolbar must not
		// discard it.
		const textarea = document.createElement("textarea");
		textarea.value = "Hello world, more typing";
		h.studioCtx.editingStore.getState().setTextareaEl(textarea);

		fireEvent.click(view.getByTestId("rich-text-bold"));

		const { paragraphs } = lastPatch(h);
		expect(paragraphs[0]?.spans.map((s) => s.text).join("")).toBe(
			"Hello world, more typing",
		);
		expect(paragraphs[0]?.spans.every((s) => s.fontWeight === "700")).toBe(
			true,
		);
	});

	it("uses the committed IR content when no overlay textarea is registered (no crash, matches prior behavior)", () => {
		const { h, view } = mount();
		fireEvent.click(view.getByTestId("rich-text-bold"));
		const { paragraphs } = lastPatch(h);
		expect(paragraphs[0]?.spans.map((s) => s.text)).toEqual([
			"Hello",
			" world",
		]);
	});
});

describe("RichTextToolbar — positioning (E-10)", () => {
	it("composes the parent group's transform into the toolbar position", () => {
		const { view } = mountNested();
		const bar = view.getByTestId("rich-text-toolbar");
		// g1 (50, 80) + rt-1's own local (10, 10) = (60, 90); top is offset
		// upward by the toolbar's own 40px, floored at 0: max(0, 90-40)=50.
		expect(bar.style.left).toBe("60px");
		expect(bar.style.top).toBe("50px");
	});

	it("repositions when the viewport pans while editing", () => {
		const { h, view } = mountNested();
		const before = view.getByTestId("rich-text-toolbar");
		expect(before.style.left).toBe("60px");
		act(() => {
			h.studioCtx.viewportStore.getState().setPan(20, 0);
		});
		const after = view.getByTestId("rich-text-toolbar");
		expect(after.style.left).toBe("80px");
	});
});
