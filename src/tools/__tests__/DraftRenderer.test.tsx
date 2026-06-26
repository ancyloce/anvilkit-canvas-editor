import { act, render } from "@testing-library/react";
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
import { DraftRenderer } from "../DraftRenderer.js";

const calls: Array<{ type: string; props: Record<string, unknown> }> = [];

vi.mock("react-konva", () => {
	const mock = (type: string) => (props: Record<string, unknown>) => {
		calls.push({ type, props });
		return null;
	};
	return {
		Rect: mock("Rect"),
		Ellipse: mock("Ellipse"),
		Line: mock("Line"),
	};
});

function makeCtx(): CanvasStudioContextValue {
	return {
		historyStore: createHistoryStore(),
		toolStore: createToolStore(),
		selectionStore: createSelectionStore(),
		viewportStore: createViewportStore(),
		guidesStore: createGuidesStore(),
		draftStore: createDraftStore(),
		editingStore: createEditingStore(),
		pagesStore: createPagesStore({ initialActivePageId: "p1" }),
		getIR: () => ({}) as never,
		commit: vi.fn(() => ({}) as never),
		pickAsset: () => Promise.resolve(""),
		stage: null,
		activePageId: "p1",
		ir: {} as never,
	};
}

describe("DraftRenderer", () => {
	it("renders nothing without a draft", () => {
		calls.length = 0;
		const ctx = makeCtx();
		render(
			<CanvasStudioContext.Provider value={ctx}>
				<DraftRenderer />
			</CanvasStudioContext.Provider>,
		);
		expect(calls).toHaveLength(0);
	});

	it("renders a Rect for a rect draft using min/abs corners", () => {
		calls.length = 0;
		const ctx = makeCtx();
		ctx.draftStore.getState().setDraft({
			type: "rect",
			startX: 100,
			startY: 100,
			currentX: 50,
			currentY: 80,
		});
		render(
			<CanvasStudioContext.Provider value={ctx}>
				<DraftRenderer />
			</CanvasStudioContext.Provider>,
		);
		const rect = calls.find((c) => c.type === "Rect");
		expect(rect?.props).toMatchObject({
			x: 50,
			y: 80,
			width: 50,
			height: 20,
			listening: false,
		});
	});

	it("renders an Ellipse with center+radii", () => {
		calls.length = 0;
		const ctx = makeCtx();
		ctx.draftStore.getState().setDraft({
			type: "ellipse",
			startX: 0,
			startY: 0,
			currentX: 100,
			currentY: 60,
		});
		render(
			<CanvasStudioContext.Provider value={ctx}>
				<DraftRenderer />
			</CanvasStudioContext.Provider>,
		);
		const e = calls.find((c) => c.type === "Ellipse");
		expect(e?.props).toMatchObject({
			x: 50,
			y: 30,
			radiusX: 50,
			radiusY: 30,
			listening: false,
		});
	});

	it("renders a Line for a line draft", () => {
		calls.length = 0;
		const ctx = makeCtx();
		ctx.draftStore.getState().setDraft({
			type: "line",
			startX: 10,
			startY: 20,
			currentX: 100,
			currentY: 200,
		});
		render(
			<CanvasStudioContext.Provider value={ctx}>
				<DraftRenderer />
			</CanvasStudioContext.Provider>,
		);
		const line = calls.find((c) => c.type === "Line");
		expect(line?.props).toMatchObject({
			points: [10, 20, 100, 200],
			listening: false,
		});
	});

	it("re-renders when draft updates", () => {
		calls.length = 0;
		const ctx = makeCtx();
		render(
			<CanvasStudioContext.Provider value={ctx}>
				<DraftRenderer />
			</CanvasStudioContext.Provider>,
		);
		expect(calls).toHaveLength(0);
		act(() => {
			ctx.draftStore.getState().setDraft({
				type: "rect",
				startX: 0,
				startY: 0,
				currentX: 10,
				currentY: 10,
			});
		});
		expect(calls.some((c) => c.type === "Rect")).toBe(true);
	});
});
