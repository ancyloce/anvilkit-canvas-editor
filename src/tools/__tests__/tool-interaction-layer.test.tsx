import { act, render } from "@testing-library/react";
import type Konva from "konva";
import { beforeEach, describe, expect, it, vi } from "vitest";
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
import { ToolInteractionLayer } from "../ToolInteractionLayer.js";
import type { Tool, ToolRegistry } from "../tool-types.js";

type Listener = (e: Konva.KonvaEventObject<PointerEvent>) => void;

function makeMockStage() {
	const listeners: Record<string, Listener[]> = {};
	const container = document.createElement("div");
	const stage = {
		on: (name: string, h: Listener) => {
			(listeners[name] ??= []).push(h);
		},
		off: (name: string, h: Listener) => {
			listeners[name] = (listeners[name] ?? []).filter((x) => x !== h);
		},
		container: () => container,
		getPointerPosition: () => ({ x: 100, y: 50 }),
		getAbsoluteTransform: () => ({
			copy: () => ({
				invert: () => ({
					point: (p: { x: number; y: number }) => p,
				}),
			}),
		}),
	} as unknown as Konva.Stage;
	return {
		stage,
		container,
		fire(name: string, e: Partial<Konva.KonvaEventObject<PointerEvent>>) {
			for (const h of listeners[name] ?? []) {
				h(e as Konva.KonvaEventObject<PointerEvent>);
			}
		},
		listenerCount(name: string) {
			return (listeners[name] ?? []).length;
		},
	};
}

function makeCtx(
	stage: Konva.Stage | null,
	pickAsset: () => Promise<string> = () => Promise.resolve("a1"),
): CanvasStudioContextValue {
	return {
		historyStore: createHistoryStore(),
		toolStore: createToolStore(),
		selectionStore: createSelectionStore(),
		viewportStore: createViewportStore(),
		guidesStore: createGuidesStore(),
		draftStore: createDraftStore(),
		editingStore: createEditingStore(),
		pagesStore: createPagesStore({ initialActivePageId: "p1" }),
		getIR: () =>
			({
				version: "1",
				id: "ir",
				title: "ir",
				pages: [],
				assets: {},
				metadata: { createdAt: "", updatedAt: "" },
			}) as never,
		commit: vi.fn(() => ({}) as never),
		pickAsset,
		stage,
		activePageId: "p1",
		ir: {} as never,
	};
}

function Harness({
	ctx,
	registry,
}: {
	ctx: CanvasStudioContextValue;
	registry: ToolRegistry;
}) {
	return (
		<CanvasStudioContext.Provider value={ctx}>
			<ToolInteractionLayer registry={registry} />
		</CanvasStudioContext.Provider>
	);
}

describe("ToolInteractionLayer", () => {
	let mock: ReturnType<typeof makeMockStage>;
	let ctx: CanvasStudioContextValue;
	let registry: ToolRegistry;
	let select: Tool;
	let rect: Tool;

	beforeEach(() => {
		mock = makeMockStage();
		ctx = makeCtx(mock.stage);
		select = {
			id: "select",
			cursor: "default",
			onActivate: vi.fn(),
			onDeactivate: vi.fn(),
			onPointerDown: vi.fn(),
			onPointerMove: vi.fn(),
			onPointerUp: vi.fn(),
		};
		rect = {
			id: "rect",
			cursor: "crosshair",
			onActivate: vi.fn(),
			onDeactivate: vi.fn(),
			onPointerDown: vi.fn(),
		};
		registry = { select, rect };
	});

	it("renders no DOM (returns null)", () => {
		const { container } = render(<Harness ctx={ctx} registry={registry} />);
		expect(container.innerHTML).toBe("");
	});

	it("does nothing while stage is null", () => {
		const nullCtx = makeCtx(null);
		render(<Harness ctx={nullCtx} registry={registry} />);
		expect(select.onActivate).not.toHaveBeenCalled();
	});

	it("activates the initial tool and sets cursor", () => {
		render(<Harness ctx={ctx} registry={registry} />);
		expect(select.onActivate).toHaveBeenCalledTimes(1);
		expect(mock.container.style.cursor).toBe("default");
	});

	it("dispatches pointerdown to the active tool with world coords", () => {
		render(<Harness ctx={ctx} registry={registry} />);
		const evt = { shiftKey: true } as PointerEvent;
		mock.fire("pointerdown", {
			evt,
			target: { id: "node-1" } as never,
		});
		expect(select.onPointerDown).toHaveBeenCalledTimes(1);
		const [args] = (select.onPointerDown as ReturnType<typeof vi.fn>).mock
			.calls[0];
		expect(args.point).toEqual({ x: 100, y: 50 });
		expect(args.screenPoint).toEqual({ x: 100, y: 50 });
		expect(args.shiftKey).toBe(true);
	});

	it("dispatches pointermove and pointerup", () => {
		render(<Harness ctx={ctx} registry={registry} />);
		mock.fire("pointermove", { evt: {} as PointerEvent, target: {} as never });
		mock.fire("pointerup", { evt: {} as PointerEvent, target: {} as never });
		expect(select.onPointerMove).toHaveBeenCalledTimes(1);
		expect(select.onPointerUp).toHaveBeenCalledTimes(1);
	});

	it("switches tools — deactivate old, activate new, update cursor", () => {
		render(<Harness ctx={ctx} registry={registry} />);
		expect(select.onActivate).toHaveBeenCalledTimes(1);

		act(() => {
			ctx.toolStore.getState().setActiveTool("rect");
		});

		expect(select.onDeactivate).toHaveBeenCalledTimes(1);
		expect(rect.onActivate).toHaveBeenCalledTimes(1);
		expect(mock.container.style.cursor).toBe("crosshair");

		// pointerdown now goes to rect, not select.
		mock.fire("pointerdown", { evt: {} as PointerEvent, target: {} as never });
		expect(rect.onPointerDown).toHaveBeenCalledTimes(1);
		expect(select.onPointerDown).not.toHaveBeenCalled();
	});

	it("ignores events when active tool is missing a handler", () => {
		// rect has no onPointerMove / onPointerUp
		act(() => {
			ctx.toolStore.getState().setActiveTool("rect");
		});
		render(<Harness ctx={ctx} registry={registry} />);
		mock.fire("pointermove", { evt: {} as PointerEvent, target: {} as never });
		mock.fire("pointerup", { evt: {} as PointerEvent, target: {} as never });
		// Should not throw, and rect's missing handlers should be a no-op.
		expect(rect.onPointerDown).not.toHaveBeenCalled();
	});

	it("ignores events when active tool is not in registry", () => {
		render(<Harness ctx={ctx} registry={{}} />);
		mock.fire("pointerdown", { evt: {} as PointerEvent, target: {} as never });
		// no throw, no handler called
		expect(select.onPointerDown).not.toHaveBeenCalled();
	});

	it("detaches stage listeners on unmount + fires final deactivate", () => {
		const { unmount } = render(<Harness ctx={ctx} registry={registry} />);
		expect(mock.listenerCount("pointerdown")).toBe(1);
		unmount();
		expect(mock.listenerCount("pointerdown")).toBe(0);
		expect(mock.listenerCount("pointermove")).toBe(0);
		expect(mock.listenerCount("pointerup")).toBe(0);
		expect(select.onDeactivate).toHaveBeenCalledTimes(1);
	});
});
