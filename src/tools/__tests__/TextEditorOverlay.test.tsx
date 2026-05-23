import type { CanvasIR, CanvasNodeUpdateCommand } from "@anvilkit/canvas-core";
import {
	createCanvasIR,
	createGroup,
	createPage,
	createText,
} from "@anvilkit/canvas-core";
import { act, fireEvent, render } from "@testing-library/react";
import type Konva from "konva";
import { describe, expect, it, vi } from "vitest";
import {
	CanvasStudioContext,
	type CanvasStudioContextValue,
} from "../../context/canvas-studio-context.js";
import { createDraftStore } from "../../stores/draft-store.js";
import { createEditingStore } from "../../stores/editing-store.js";
import { createGuidesStore } from "../../stores/guides-store.js";
import { createHistoryStore } from "../../stores/history-store.js";
import { createPagesStore } from "../../stores/pages-store.js";
import { createSelectionStore } from "../../stores/selection-store.js";
import { createToolStore } from "../../stores/tool-store.js";
import { createViewportStore } from "../../stores/viewport-store.js";
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
});
