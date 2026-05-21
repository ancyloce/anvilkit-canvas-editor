import {
	type CanvasIR,
	createCanvasIR,
	createGroup,
	createPage,
	createRect,
} from "@anvilkit/canvas-core";
import type Konva from "konva";
import { describe, expect, it } from "vitest";
import { selectTool } from "../select-tool.js";
import { makeHarness, pointerEvent } from "./_tool-test-helpers.js";

const FIXED_TS = "2026-05-20T00:00:00.000Z";

function fixtureIR(): CanvasIR {
	const page = createPage({ id: "p1" });
	page.root = createGroup({
		id: "p1-root",
		bounds: page.root.bounds,
		children: [
			createRect({
				id: "rectA",
				bounds: { width: 100, height: 50 },
				transform: { x: 10, y: 20 },
			}),
			createRect({
				id: "rectB",
				bounds: { width: 80, height: 40 },
				transform: { x: 200, y: 300 },
			}),
			createRect({
				id: "rectC",
				bounds: { width: 50, height: 50 },
				transform: { x: 500, y: 500 },
			}),
		],
	});
	return createCanvasIR({ id: "ir-1", pages: [page], now: () => FIXED_TS });
}

const emptyTarget: Konva.Node = {
	name: () => "",
	getParent: () => null,
} as unknown as Konva.Node;

describe("selectTool — marquee", () => {
	it("empty-stage pointerdown starts a marquee draft (does not clear yet)", () => {
		const h = makeHarness();
		h.ctx.getIR = () => fixtureIR();
		h.ctx.selectionStore.getState().setSelection(["rectA"]);
		selectTool.onPointerDown?.(
			pointerEvent(0, 0, { target: emptyTarget }),
			h.ctx,
		);
		expect(h.ctx.draftStore.getState().draft?.type).toBe("marquee");
		// Selection NOT yet cleared.
		expect(h.ctx.selectionStore.getState().selectedIds).toEqual(["rectA"]);
	});

	it("degenerate marquee click clears selection", () => {
		const h = makeHarness();
		h.ctx.getIR = () => fixtureIR();
		h.ctx.selectionStore.getState().setSelection(["rectA"]);
		selectTool.onPointerDown?.(
			pointerEvent(0, 0, { target: emptyTarget }),
			h.ctx,
		);
		selectTool.onPointerUp?.(pointerEvent(0.5, 0.5), h.ctx);
		expect(h.ctx.selectionStore.getState().selectedIds).toEqual([]);
		expect(h.ctx.draftStore.getState().draft).toBeNull();
	});

	it("marquee dragged over two rects sets selection to those two", () => {
		const h = makeHarness();
		h.ctx.getIR = () => fixtureIR();
		selectTool.onPointerDown?.(
			pointerEvent(0, 0, { target: emptyTarget }),
			h.ctx,
		);
		// rectA is at (10,20) 100x50; rectB at (200,300) 80x40. A marquee
		// from (0,0) to (290, 350) covers both but not rectC at (500,500).
		selectTool.onPointerMove?.(pointerEvent(290, 350), h.ctx);
		selectTool.onPointerUp?.(pointerEvent(290, 350), h.ctx);
		expect(h.ctx.selectionStore.getState().selectedIds.sort()).toEqual([
			"rectA",
			"rectB",
		]);
		expect(h.ctx.draftStore.getState().draft).toBeNull();
	});

	it("marquee with shift extends existing selection", () => {
		const h = makeHarness();
		h.ctx.getIR = () => fixtureIR();
		h.ctx.selectionStore.getState().setSelection(["rectC"]);
		selectTool.onPointerDown?.(
			pointerEvent(0, 0, { target: emptyTarget, shiftKey: true }),
			h.ctx,
		);
		// Marquee covers rectA only.
		selectTool.onPointerMove?.(pointerEvent(120, 80), h.ctx);
		selectTool.onPointerUp?.(pointerEvent(120, 80, { shiftKey: true }), h.ctx);
		expect(h.ctx.selectionStore.getState().selectedIds.sort()).toEqual([
			"rectA",
			"rectC",
		]);
	});

	it("marquee with no intersection clears selection (non-shift)", () => {
		const h = makeHarness();
		h.ctx.getIR = () => fixtureIR();
		h.ctx.selectionStore.getState().setSelection(["rectA"]);
		selectTool.onPointerDown?.(
			pointerEvent(1000, 1000, { target: emptyTarget }),
			h.ctx,
		);
		selectTool.onPointerUp?.(pointerEvent(1100, 1100), h.ctx);
		expect(h.ctx.selectionStore.getState().selectedIds).toEqual([]);
	});
});
