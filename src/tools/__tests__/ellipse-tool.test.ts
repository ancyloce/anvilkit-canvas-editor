import type { CanvasNodeCreateCommand } from "@anvilkit/canvas-core";
import { describe, expect, it } from "vitest";
import { ellipseTool } from "../ellipse-tool.js";
import { makeHarness, pointerEvent } from "./_tool-test-helpers.js";

describe("ellipseTool", () => {
	it("commits an ellipse node sized to the bounding box", () => {
		const h = makeHarness();
		ellipseTool.onPointerDown?.(pointerEvent(50, 50), h.ctx);
		ellipseTool.onPointerMove?.(pointerEvent(150, 130), h.ctx);
		expect(h.commits).toHaveLength(0);
		ellipseTool.onPointerUp?.(pointerEvent(150, 130), h.ctx);
		expect(h.commits).toHaveLength(1);
		const cmd = h.commits[0] as CanvasNodeCreateCommand;
		expect(cmd.node.type).toBe("ellipse");
		expect(cmd.node.transform.x).toBe(50);
		expect(cmd.node.transform.y).toBe(50);
		expect(cmd.node.bounds).toEqual({ width: 100, height: 80 });
	});

	it("skips commit on degenerate click", () => {
		const h = makeHarness();
		ellipseTool.onPointerDown?.(pointerEvent(10, 10), h.ctx);
		ellipseTool.onPointerUp?.(pointerEvent(10, 10), h.ctx);
		expect(h.commits).toHaveLength(0);
	});

	it("onDeactivate clears draft", () => {
		const h = makeHarness();
		ellipseTool.onPointerDown?.(pointerEvent(0, 0), h.ctx);
		ellipseTool.onDeactivate?.(h.ctx);
		expect(h.ctx.draftStore.getState().draft).toBeNull();
	});
});
