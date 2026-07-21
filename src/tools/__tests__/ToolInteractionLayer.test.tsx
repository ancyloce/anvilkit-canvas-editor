import { render } from "@testing-library/react";
import type Konva from "konva";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CanvasStudioContext } from "@/context/canvas-studio-context.js";
import { ToolInteractionLayer } from "../ToolInteractionLayer.js";
import type { Tool, ToolRegistry } from "../tool-types.js";
import { makeHarness } from "./_tool-test-helpers.js";

afterEach(() => {
	vi.restoreAllMocks();
});

/** A fake Konva.Stage whose `.on`/`.off` actually store handlers, so a test
 * can `fire()` a Konva-style pointer event the way the real stage would. */
function makeEventfulStage(): {
	stage: Konva.Stage;
	fire: (type: string, evt: PointerEvent, target?: Konva.Node) => void;
} {
	const listeners = new Map<
		string,
		Set<(e: Konva.KonvaEventObject<PointerEvent>) => void>
	>();
	const container = document.createElement("div");
	const stage = {
		on: (type: string, handler: (e: unknown) => void) => {
			if (!listeners.has(type)) listeners.set(type, new Set());
			listeners
				.get(type)
				?.add(handler as (e: Konva.KonvaEventObject<PointerEvent>) => void);
		},
		off: (type: string, handler: (e: unknown) => void) => {
			listeners
				.get(type)
				?.delete(handler as (e: Konva.KonvaEventObject<PointerEvent>) => void);
		},
		container: () => container,
		getPointerPosition: () => ({ x: 10, y: 10 }),
		getAbsoluteTransform: () => ({
			copy: () => ({
				invert: () => ({
					point: (p: { x: number; y: number }) => p,
				}),
			}),
		}),
	} as unknown as Konva.Stage;
	const fire = (
		type: string,
		evt: PointerEvent,
		target: Konva.Node = {} as Konva.Node,
	) => {
		for (const handler of listeners.get(type) ?? []) {
			handler({ evt, target } as Konva.KonvaEventObject<PointerEvent>);
		}
	};
	return { stage, fire };
}

function makeFakeTool(): {
	tool: Tool;
	downCount: () => number;
	upCount: () => number;
} {
	let downs = 0;
	let ups = 0;
	const tool: Tool = {
		id: "fake",
		cursor: "default",
		onPointerDown() {
			downs++;
		},
		onPointerUp() {
			ups++;
		},
	};
	return { tool, downCount: () => downs, upCount: () => ups };
}

describe("ToolInteractionLayer — pointerup outside the stage (E-5)", () => {
	it("dispatches onPointerUp via the normal Konva pointerup when released inside the stage", () => {
		const { stage, fire } = makeEventfulStage();
		const { tool, downCount, upCount } = makeFakeTool();
		const registry: ToolRegistry = { select: tool };
		const h = makeHarness();
		const ctx = { ...h.studioCtx, stage };
		render(
			<CanvasStudioContext.Provider value={ctx}>
				<ToolInteractionLayer registry={registry} />
			</CanvasStudioContext.Provider>,
		);
		fire("pointerdown", { shiftKey: false } as PointerEvent);
		expect(downCount()).toBe(1);
		fire("pointerup", { shiftKey: false } as PointerEvent);
		expect(upCount()).toBe(1);
		// The window fallback must not ALSO fire for an in-stage release.
		window.dispatchEvent(new Event("pointerup"));
		expect(upCount()).toBe(1);
	});

	it("flush-dispatches onPointerUp via the window fallback when released outside the stage (E-5)", () => {
		const { stage, fire } = makeEventfulStage();
		const { tool, downCount, upCount } = makeFakeTool();
		const registry: ToolRegistry = { select: tool };
		const h = makeHarness();
		const ctx = { ...h.studioCtx, stage };
		render(
			<CanvasStudioContext.Provider value={ctx}>
				<ToolInteractionLayer registry={registry} />
			</CanvasStudioContext.Provider>,
		);
		fire("pointerdown", { shiftKey: false } as PointerEvent);
		expect(downCount()).toBe(1);
		expect(upCount()).toBe(0);
		// Released outside the stage: Konva's own container-bound listener
		// never fires (nothing simulates it here) — only `window` sees it.
		// Before the fix, the tool's "down" state stayed stuck forever.
		window.dispatchEvent(
			new PointerEvent("pointerup", { bubbles: true, cancelable: true }),
		);
		expect(upCount()).toBe(1);
	});

	it("also flush-dispatches onPointerUp on a window pointercancel", () => {
		const { stage, fire } = makeEventfulStage();
		const { tool, upCount } = makeFakeTool();
		const registry: ToolRegistry = { select: tool };
		const h = makeHarness();
		const ctx = { ...h.studioCtx, stage };
		render(
			<CanvasStudioContext.Provider value={ctx}>
				<ToolInteractionLayer registry={registry} />
			</CanvasStudioContext.Provider>,
		);
		fire("pointerdown", { shiftKey: false } as PointerEvent);
		window.dispatchEvent(
			new PointerEvent("pointercancel", { bubbles: true, cancelable: true }),
		);
		expect(upCount()).toBe(1);
	});

	it("does not dispatch a phantom up from a stray window pointerup with no gesture in progress", () => {
		const { stage } = makeEventfulStage();
		const { tool, upCount } = makeFakeTool();
		const registry: ToolRegistry = { select: tool };
		const h = makeHarness();
		const ctx = { ...h.studioCtx, stage };
		render(
			<CanvasStudioContext.Provider value={ctx}>
				<ToolInteractionLayer registry={registry} />
			</CanvasStudioContext.Provider>,
		);
		window.dispatchEvent(
			new PointerEvent("pointerup", { bubbles: true, cancelable: true }),
		);
		expect(upCount()).toBe(0);
	});
});
