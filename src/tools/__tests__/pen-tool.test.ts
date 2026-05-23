import type { CanvasNodeCreateCommand } from "@anvilkit/canvas-core";
import { beforeEach, describe, expect, it } from "vitest";
import { cancelPenPath, commitPenPath } from "../pen-actions.js";
import { penTool } from "../pen-tool.js";
import {
	makeHarness,
	pointerEvent,
	type TestHarness,
} from "./_tool-test-helpers.js";

let h: TestHarness;
beforeEach(() => {
	h = makeHarness();
	// Reset the module-level drag flag between tests.
	penTool.onDeactivate?.(h.ctx);
});

function click(x: number, y: number) {
	penTool.onPointerDown?.(pointerEvent(x, y), h.ctx);
	penTool.onPointerUp?.(pointerEvent(x, y), h.ctx);
}

describe("penTool", () => {
	it("accumulates an anchor per click without committing", () => {
		click(0, 0);
		click(100, 0);
		click(100, 100);
		expect(h.ctx.penStore.getState().anchors).toHaveLength(3);
		expect(h.commits).toHaveLength(0);
	});

	it("a drag after a click pulls out a symmetric bezier handle", () => {
		penTool.onPointerDown?.(pointerEvent(0, 0), h.ctx);
		penTool.onPointerMove?.(pointerEvent(10, 10), h.ctx);
		penTool.onPointerUp?.(pointerEvent(10, 10), h.ctx);
		expect(h.ctx.penStore.getState().anchors[0]).toEqual({
			x: 0,
			y: 0,
			hx: 10,
			hy: 10,
		});
	});

	it("pointermove without an active drag is a no-op", () => {
		penTool.onPointerMove?.(pointerEvent(5, 5), h.ctx);
		expect(h.ctx.penStore.getState().anchors).toHaveLength(0);
	});

	it("clicking the first anchor closes the path and commits node.create", () => {
		click(0, 0);
		click(100, 0);
		click(100, 100);
		// Click back on the first anchor (within CLOSE_THRESHOLD) → close + commit.
		penTool.onPointerDown?.(pointerEvent(0, 0), h.ctx);
		expect(h.commits).toHaveLength(1);
		const cmd = h.commits[0] as CanvasNodeCreateCommand;
		expect(cmd.type).toBe("node.create");
		expect(cmd.node.type).toBe("path");
		if (cmd.node.type === "path") {
			expect(cmd.node.d).toBe("M 0 0 L 100 0 L 100 100 Z");
		}
		expect(cmd.node.transform.x).toBe(0);
		expect(cmd.node.bounds).toEqual({ width: 100, height: 100 });
		expect(h.ctx.penStore.getState().anchors).toHaveLength(0);
		expect(h.ctx.selectionStore.getState().selectedIds).toEqual([cmd.node.id]);
	});

	it("onDeactivate resets the in-progress path", () => {
		click(10, 10);
		click(20, 20);
		penTool.onDeactivate?.(h.ctx);
		expect(h.ctx.penStore.getState().anchors).toHaveLength(0);
	});
});

describe("commitPenPath", () => {
	it("translates d to bounds-local coordinates", () => {
		h.ctx.penStore.getState().addAnchor({ x: 20, y: 20, hx: 20, hy: 20 });
		h.ctx.penStore.getState().addAnchor({ x: 60, y: 20, hx: 60, hy: 20 });
		h.ctx.penStore.getState().addAnchor({ x: 60, y: 60, hx: 60, hy: 60 });
		const id = commitPenPath(h.ctx, true);
		expect(id).not.toBeNull();
		const cmd = h.commits[0] as CanvasNodeCreateCommand;
		if (cmd.node.type === "path") {
			expect(cmd.node.d).toBe("M 0 0 L 40 0 L 40 40 Z");
		}
		expect(cmd.node.transform).toMatchObject({ x: 20, y: 20 });
		expect(cmd.node.bounds).toEqual({ width: 40, height: 40 });
	});

	it("is a no-op (and resets) with fewer than two anchors", () => {
		h.ctx.penStore.getState().addAnchor({ x: 0, y: 0, hx: 0, hy: 0 });
		expect(commitPenPath(h.ctx, false)).toBeNull();
		expect(h.commits).toHaveLength(0);
		expect(h.ctx.penStore.getState().anchors).toHaveLength(0);
	});
});

describe("cancelPenPath", () => {
	it("resets without committing", () => {
		h.ctx.penStore.getState().addAnchor({ x: 0, y: 0, hx: 0, hy: 0 });
		h.ctx.penStore.getState().addAnchor({ x: 5, y: 5, hx: 5, hy: 5 });
		cancelPenPath(h.ctx);
		expect(h.commits).toHaveLength(0);
		expect(h.ctx.penStore.getState().anchors).toHaveLength(0);
	});
});
