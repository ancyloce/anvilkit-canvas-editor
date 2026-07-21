import type { CanvasIR, CanvasNodeUpdateCommand } from "@anvilkit/canvas-core";
import {
	createCanvasIR,
	createFrame,
	createGroup,
	createPage,
	createRichText,
	createText,
} from "@anvilkit/canvas-core";
import { act, fireEvent, render } from "@testing-library/react";
import type Konva from "konva";
import { describe, expect, it, vi } from "vitest";
import {
	CanvasStudioContext,
	type CanvasStudioContextValue,
} from "@/context/canvas-studio-context.js";
import { createDraftStore } from "@/stores/draft-store.js";
import { createEditingStore } from "@/stores/editing-store.js";
import { createGuidesStore } from "@/stores/guides-store.js";
import { createHistoryStore } from "@/stores/history-store.js";
import { createPagesStore } from "@/stores/pages-store.js";
import { createSelectionStore } from "@/stores/selection-store.js";
import { createToolStore } from "@/stores/tool-store.js";
import { createViewportStore } from "@/stores/viewport-store.js";
import { RichTextToolbar } from "../RichTextToolbar.js";
import { TextEditorOverlay } from "../TextEditorOverlay.js";

const FIXED_TS = "2026-05-20T00:00:00.000Z";

function fixtureIR(): CanvasIR {
	const page = createPage({ id: "p1" });
	page.root = createGroup({
		id: "p1-root",
		bounds: page.root.bounds,
		children: [
			createText({
				id: "text1",
				bounds: { width: 100, height: 36 },
				transform: { x: 50, y: 100 },
				text: "Hello",
				fontFamily: "Inter",
				fontSize: 16,
				fill: "#000000",
			}),
		],
	});
	return createCanvasIR({ id: "ir-1", pages: [page], now: () => FIXED_TS });
}

/** A text node nested inside a frame — not a top-level child of the page root. */
function fixtureIRWithNestedText(): CanvasIR {
	const page = createPage({ id: "p1" });
	page.root = createGroup({
		id: "p1-root",
		bounds: page.root.bounds,
		children: [
			createFrame({
				id: "frame1",
				bounds: { width: 300, height: 200 },
				children: [
					createText({
						id: "nested-text1",
						bounds: { width: 100, height: 36 },
						transform: { x: 10, y: 10 },
						text: "Nested",
						fontFamily: "Inter",
						fontSize: 16,
						fill: "#000000",
					}),
				],
			}),
		],
	});
	return createCanvasIR({ id: "ir-1", pages: [page], now: () => FIXED_TS });
}

/** A rich-text node with two distinctly-styled paragraphs. */
function fixtureIRWithRichText(): CanvasIR {
	const page = createPage({ id: "p1" });
	page.root = createGroup({
		id: "p1-root",
		bounds: page.root.bounds,
		children: [
			createRichText({
				id: "rt1",
				bounds: { width: 240, height: 60 },
				transform: { x: 20, y: 30 },
				paragraphs: [
					{
						align: "center",
						lineHeight: 1.5,
						spans: [
							{
								text: "First",
								fontFamily: "Georgia",
								fontSize: 20,
								fill: "#ff0000",
							},
						],
					},
					{
						spans: [{ text: "Second", fontFamily: "Arial", fontSize: 14 }],
					},
				],
			}),
		],
	});
	return createCanvasIR({ id: "ir-1", pages: [page], now: () => FIXED_TS });
}

function makeFakeStage(): Konva.Stage {
	const container = document.createElement("div");
	document.body.appendChild(container);
	return {
		container: () => container,
	} as unknown as Konva.Stage;
}

/**
 * A stage whose `container()` reads `this` (like real Konva, which delegates to
 * `this.getContainer()`). Calling it unbound throws "reading 'getContainer'" —
 * the bug the default `this`-less fake stage above could never catch.
 */
function konvaLikeStage(): Konva.Stage {
	const el = document.createElement("div");
	document.body.appendChild(el);
	return {
		container(this: { getContainer: () => HTMLElement }) {
			return this.getContainer();
		},
		getContainer: () => el,
	} as unknown as Konva.Stage;
}

function makeCtx(
	ir: CanvasIR,
	stage: Konva.Stage | null,
): { ctx: CanvasStudioContextValue; commits: unknown[] } {
	const commits: unknown[] = [];
	return {
		commits,
		ctx: {
			historyStore: createHistoryStore(),
			toolStore: createToolStore(),
			selectionStore: createSelectionStore(),
			viewportStore: createViewportStore(),
			guidesStore: createGuidesStore(),
			draftStore: createDraftStore(),
			editingStore: createEditingStore(),
			pagesStore: createPagesStore({ initialActivePageId: "p1" }),
			getIR: () => ir,
			commit: vi.fn((cmd) => {
				commits.push(cmd);
				return ir;
			}),
			pickAsset: () => Promise.resolve(""),
			stage,
			activePageId: "p1",
			ir,
		},
	};
}

describe("TextEditorOverlay", () => {
	it("renders nothing when no node is being edited", () => {
		const ir = fixtureIR();
		const { ctx } = makeCtx(ir, makeFakeStage());
		render(
			<CanvasStudioContext.Provider value={ctx}>
				<TextEditorOverlay />
			</CanvasStudioContext.Provider>,
		);
		expect(
			document.querySelector("[data-testid=text-editor-overlay]"),
		).toBeNull();
	});

	it("renders a textarea when editingNodeId points at a text node", () => {
		const ir = fixtureIR();
		const { ctx } = makeCtx(ir, makeFakeStage());
		ctx.editingStore.getState().setEditing("text1");
		render(
			<CanvasStudioContext.Provider value={ctx}>
				<TextEditorOverlay />
			</CanvasStudioContext.Provider>,
		);
		const ta = document.querySelector(
			"[data-testid=text-editor-overlay]",
		) as HTMLTextAreaElement | null;
		expect(ta).not.toBeNull();
		expect(ta?.value).toBe("Hello");
	});

	it("renders a textarea for a text node nested inside a frame (container-aware lookup)", () => {
		const ir = fixtureIRWithNestedText();
		const { ctx } = makeCtx(ir, makeFakeStage());
		ctx.editingStore.getState().setEditing("nested-text1");
		// Scoped to this render's own container (not global `document`): earlier
		// tests in this file render via global `document.querySelector` without
		// RTL cleanup between them, so a global query here could match a stale
		// textarea left over from an earlier test.
		const { container } = render(
			<CanvasStudioContext.Provider value={ctx}>
				<TextEditorOverlay />
			</CanvasStudioContext.Provider>,
		);
		const ta = container.querySelector(
			"[data-testid=text-editor-overlay]",
		) as HTMLTextAreaElement | null;
		expect(ta).not.toBeNull();
		expect(ta?.value).toBe("Nested");
	});

	it("calls stage.container() bound to the stage (no 'getContainer' crash)", () => {
		// Regression: the overlay used to extract `const fn = stage.container`
		// and call `fn()` unbound, which threw against a real Konva stage.
		const ir = fixtureIR();
		const { ctx } = makeCtx(ir, konvaLikeStage());
		ctx.editingStore.getState().setEditing("text1");
		expect(() => {
			render(
				<CanvasStudioContext.Provider value={ctx}>
					<TextEditorOverlay />
				</CanvasStudioContext.Provider>,
			);
		}).not.toThrow();
		expect(
			document.querySelector("[data-testid=text-editor-overlay]"),
		).not.toBeNull();
	});

	it("sanity: simple textarea onBlur fires under fireEvent.blur", () => {
		const onBlur = vi.fn();
		render(<textarea data-testid="sanity-ta" onBlur={onBlur} />);
		const ta = document.querySelector(
			"[data-testid=sanity-ta]",
		) as HTMLTextAreaElement;
		fireEvent.blur(ta);
		expect(onBlur).toHaveBeenCalled();
	});

	it("commits node.update on blur if text changed", () => {
		const ir = fixtureIR();
		const { ctx, commits } = makeCtx(ir, makeFakeStage());
		ctx.editingStore.getState().setEditing("text1");
		const { container } = render(
			<CanvasStudioContext.Provider value={ctx}>
				<TextEditorOverlay />
			</CanvasStudioContext.Provider>,
		);
		const ta = container.querySelector(
			"[data-testid=text-editor-overlay]",
		) as HTMLTextAreaElement;
		expect(ta).not.toBeNull();
		fireEvent.change(ta, { target: { value: "Updated" } });
		fireEvent.blur(ta);
		expect(commits).toHaveLength(1);
		const cmd = commits[0] as CanvasNodeUpdateCommand<"text">;
		expect(cmd).toMatchObject({
			type: "node.update",
			nodeId: "text1",
			kind: "text",
			patch: { text: "Updated" },
		});
		expect(ctx.editingStore.getState().editingNodeId).toBeNull();
	});

	it("emptying a text node deletes it on blur (FR-080 empty-node cleanup)", () => {
		const ir = fixtureIR();
		const { ctx, commits } = makeCtx(ir, makeFakeStage());
		ctx.editingStore.getState().setEditing("text1");
		const { container } = render(
			<CanvasStudioContext.Provider value={ctx}>
				<TextEditorOverlay />
			</CanvasStudioContext.Provider>,
		);
		const ta = container.querySelector(
			"[data-testid=text-editor-overlay]",
		) as HTMLTextAreaElement;
		fireEvent.change(ta, { target: { value: "   " } });
		fireEvent.blur(ta);
		expect(commits).toHaveLength(1);
		expect(commits[0]).toMatchObject({ type: "node.delete", nodeId: "text1" });
		expect(ctx.editingStore.getState().editingNodeId).toBeNull();
	});

	it("blur with unchanged text closes overlay but does not commit", () => {
		const ir = fixtureIR();
		const { ctx, commits } = makeCtx(ir, makeFakeStage());
		ctx.editingStore.getState().setEditing("text1");
		const { container } = render(
			<CanvasStudioContext.Provider value={ctx}>
				<TextEditorOverlay />
			</CanvasStudioContext.Provider>,
		);
		const ta = container.querySelector(
			"[data-testid=text-editor-overlay]",
		) as HTMLTextAreaElement;
		fireEvent.blur(ta);
		expect(commits).toHaveLength(0);
		expect(ctx.editingStore.getState().editingNodeId).toBeNull();
	});

	it("Escape discards changes and closes overlay (no commit)", () => {
		const ir = fixtureIR();
		const { ctx, commits } = makeCtx(ir, makeFakeStage());
		ctx.editingStore.getState().setEditing("text1");
		const { container } = render(
			<CanvasStudioContext.Provider value={ctx}>
				<TextEditorOverlay />
			</CanvasStudioContext.Provider>,
		);
		const ta = container.querySelector(
			"[data-testid=text-editor-overlay]",
		) as HTMLTextAreaElement;
		fireEvent.change(ta, { target: { value: "Will be discarded" } });
		fireEvent.keyDown(ta, { key: "Escape" });
		expect(commits).toHaveLength(0);
		expect(ctx.editingStore.getState().editingNodeId).toBeNull();
	});

	describe("rich-text nodes", () => {
		it("flattens paragraphs into newline-joined draft text", () => {
			const ir = fixtureIRWithRichText();
			const { ctx } = makeCtx(ir, makeFakeStage());
			ctx.editingStore.getState().setEditing("rt1");
			const { container } = render(
				<CanvasStudioContext.Provider value={ctx}>
					<TextEditorOverlay />
				</CanvasStudioContext.Provider>,
			);
			const ta = container.querySelector(
				"[data-testid=text-editor-overlay]",
			) as HTMLTextAreaElement | null;
			expect(ta).not.toBeNull();
			expect(ta?.value).toBe("First\nSecond");
		});

		it("commits node.update (kind rich-text) on blur, preserving each paragraph's style and adding a new line styled like the last paragraph", () => {
			const ir = fixtureIRWithRichText();
			const { ctx, commits } = makeCtx(ir, makeFakeStage());
			ctx.editingStore.getState().setEditing("rt1");
			const { container } = render(
				<CanvasStudioContext.Provider value={ctx}>
					<TextEditorOverlay />
				</CanvasStudioContext.Provider>,
			);
			const ta = container.querySelector(
				"[data-testid=text-editor-overlay]",
			) as HTMLTextAreaElement;
			fireEvent.change(ta, { target: { value: "First\nSecond\nThird" } });
			fireEvent.blur(ta);
			expect(commits).toHaveLength(1);
			const cmd = commits[0] as CanvasNodeUpdateCommand<"rich-text">;
			expect(cmd.type).toBe("node.update");
			expect(cmd.nodeId).toBe("rt1");
			expect(cmd.kind).toBe("rich-text");
			expect(cmd.patch.paragraphs).toEqual([
				{
					align: "center",
					lineHeight: 1.5,
					spans: [
						{
							text: "First",
							fontFamily: "Georgia",
							fontSize: 20,
							fill: "#ff0000",
						},
					],
				},
				{
					spans: [{ text: "Second", fontFamily: "Arial", fontSize: 14 }],
				},
				// New third line inherits the last original paragraph's style.
				{
					spans: [{ text: "Third", fontFamily: "Arial", fontSize: 14 }],
				},
			]);
			expect(ctx.editingStore.getState().editingNodeId).toBeNull();
		});

		it("blur with unchanged text closes overlay but does not commit", () => {
			const ir = fixtureIRWithRichText();
			const { ctx, commits } = makeCtx(ir, makeFakeStage());
			ctx.editingStore.getState().setEditing("rt1");
			const { container } = render(
				<CanvasStudioContext.Provider value={ctx}>
					<TextEditorOverlay />
				</CanvasStudioContext.Provider>,
			);
			const ta = container.querySelector(
				"[data-testid=text-editor-overlay]",
			) as HTMLTextAreaElement;
			fireEvent.blur(ta);
			expect(commits).toHaveLength(0);
			expect(ctx.editingStore.getState().editingNodeId).toBeNull();
		});

		it("Escape discards changes and closes overlay (no commit)", () => {
			const ir = fixtureIRWithRichText();
			const { ctx, commits } = makeCtx(ir, makeFakeStage());
			ctx.editingStore.getState().setEditing("rt1");
			const { container } = render(
				<CanvasStudioContext.Provider value={ctx}>
					<TextEditorOverlay />
				</CanvasStudioContext.Provider>,
			);
			const ta = container.querySelector(
				"[data-testid=text-editor-overlay]",
			) as HTMLTextAreaElement;
			fireEvent.change(ta, { target: { value: "Will be discarded" } });
			fireEvent.keyDown(ta, { key: "Escape" });
			expect(commits).toHaveLength(0);
			expect(ctx.editingStore.getState().editingNodeId).toBeNull();
		});
	});
});

describe("TextEditorOverlay + RichTextToolbar integration (E-4)", () => {
	it("a toolbar click while the textarea is focused preserves uncommitted typing and does not reset the draft", () => {
		const ir = fixtureIRWithRichText();
		const { ctx, commits } = makeCtx(ir, makeFakeStage());
		ctx.editingStore.getState().setEditing("rt1");
		const { container, rerender } = render(
			<CanvasStudioContext.Provider value={ctx}>
				<TextEditorOverlay />
				<RichTextToolbar />
			</CanvasStudioContext.Provider>,
		);
		const ta = container.querySelector(
			"[data-testid=text-editor-overlay]",
		) as HTMLTextAreaElement;
		expect(ta.value).toBe("First\nSecond");

		// The user types more content than what's currently committed, then
		// clicks a toolbar button without blurring (the toolbar's onMouseDown
		// preventDefault is meant to keep focus in the textarea).
		fireEvent.change(ta, { target: { value: "First\nSecond EXTRA" } });
		ta.focus();
		expect(document.activeElement).toBe(ta);
		fireEvent.click(
			container.querySelector('[data-testid="rich-text-bold"]') as Element,
		);

		// The commit must carry the user's typed content, not the stale
		// pre-edit "Second" — this is the actual data-loss fix.
		expect(commits).toHaveLength(1);
		const cmd = commits[0] as CanvasNodeUpdateCommand<"rich-text">;
		expect(
			cmd.patch.paragraphs?.map((p) => p.spans.map((s) => s.text).join("")),
		).toEqual(["First", "Second EXTRA"]);
		expect(
			cmd.patch.paragraphs?.[1]?.spans.every((s) => s.fontWeight === "700"),
		).toBe(true);

		// Simulate the commit landing in the IR (a genuinely new node identity,
		// same editing target) and re-render, reusing the SAME stores so
		// editingNodeId/textareaEl survive — exactly what a real commit does.
		const committedIr: CanvasIR = {
			...ir,
			pages: ir.pages.map((p) =>
				p.id !== "p1"
					? p
					: {
							...p,
							root: {
								...p.root,
								children: p.root.children.map((n) =>
									n.id !== "rt1"
										? n
										: { ...n, paragraphs: cmd.patch.paragraphs },
								),
							} as typeof p.root,
						},
			),
		};
		const nextCtx = { ...ctx, getIR: () => committedIr, ir: committedIr };
		rerender(
			<CanvasStudioContext.Provider value={nextCtx}>
				<TextEditorOverlay />
				<RichTextToolbar />
			</CanvasStudioContext.Provider>,
		);
		const taAfter = container.querySelector(
			"[data-testid=text-editor-overlay]",
		) as HTMLTextAreaElement;
		// Still focused, still showing the user's live typing — not reverted
		// and not re-selected out from under them.
		expect(taAfter.value).toBe("First\nSecond EXTRA");
		expect(document.activeElement).toBe(taAfter);
	});
});
