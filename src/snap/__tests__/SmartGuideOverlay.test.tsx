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
import { SmartGuideOverlay } from "../SmartGuideOverlay.js";
import type { SmartGuide } from "../snap-types.js";

const lineCalls: Array<{ props: Record<string, unknown> }> = [];

vi.mock("react-konva", () => ({
	Line: (props: Record<string, unknown>) => {
		lineCalls.push({ props });
		return null;
	},
}));

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

const guideX: SmartGuide = {
	axis: "x",
	position: 100,
	from: { x: 100, y: 0 },
	to: { x: 100, y: 200 },
};
const guideY: SmartGuide = {
	axis: "y",
	position: 50,
	from: { x: 0, y: 50 },
	to: { x: 300, y: 50 },
};

describe("SmartGuideOverlay", () => {
	it("renders nothing when no guides are set", () => {
		lineCalls.length = 0;
		const ctx = makeCtx();
		render(
			<CanvasStudioContext.Provider value={ctx}>
				<SmartGuideOverlay />
			</CanvasStudioContext.Provider>,
		);
		expect(lineCalls).toHaveLength(0);
	});

	it("renders one <Line> per guide with dashed stroke + listening=false", () => {
		lineCalls.length = 0;
		const ctx = makeCtx();
		ctx.guidesStore.getState().setGuides([guideX, guideY]);
		render(
			<CanvasStudioContext.Provider value={ctx}>
				<SmartGuideOverlay />
			</CanvasStudioContext.Provider>,
		);
		expect(lineCalls).toHaveLength(2);
		for (const call of lineCalls) {
			expect(call.props.listening).toBe(false);
			expect(call.props.dash).toEqual([4, 4]);
		}
		expect(lineCalls[0]?.props.points).toEqual([100, 0, 100, 200]);
		expect(lineCalls[1]?.props.points).toEqual([0, 50, 300, 50]);
	});

	it("re-renders when guides change in the store", () => {
		lineCalls.length = 0;
		const ctx = makeCtx();
		render(
			<CanvasStudioContext.Provider value={ctx}>
				<SmartGuideOverlay />
			</CanvasStudioContext.Provider>,
		);
		expect(lineCalls).toHaveLength(0);
		act(() => {
			ctx.guidesStore.getState().setGuides([guideX]);
		});
		expect(lineCalls).toHaveLength(1);
		act(() => {
			ctx.guidesStore.getState().clearGuides();
		});
		// After clear, returns null again — the previous lineCalls remain in
		// the array but no new ones should be appended.
		const countAfterClear = lineCalls.length;
		act(() => {
			ctx.guidesStore.getState().clearGuides();
		});
		expect(lineCalls.length).toBe(countAfterClear);
	});
});
