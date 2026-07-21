import {
	type CanvasNodeUpdateCommand,
	type CanvasRichTextNode,
	createCanvasIR,
	createGroup,
	createPage,
	createRichText,
} from "@anvilkit/canvas-core";
import { cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
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
