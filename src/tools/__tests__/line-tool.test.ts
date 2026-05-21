import type { CanvasNodeCreateCommand } from "@anvilkit/canvas-core";
import { describe, expect, it } from "vitest";
import { lineTool } from "../line-tool.js";
import { makeHarness, pointerEvent } from "./_tool-test-helpers.js";

describe("lineTool", () => {
	it("commits a line node with relative points + transform at start", () => {
		const h = makeHarness();
		lineTool.onPointerDown?.(pointerEvent(20, 30), h.ctx);
		lineTool.onPointerMove?.(pointerEvent(120, 80), h.ctx);
		expect(h.commits).toHaveLength(0);
		lineTool.onPointerUp?.(pointerEvent(120, 80), h.ctx);
		const cmd = h.commits[0] as CanvasNodeCreateCommand;
		expect(cmd.node.type).toBe("line");
		expect(cmd.node.transform.x).toBe(20);
		expect(cmd.node.transform.y).toBe(30);
		// CanvasLineNode has points; access via cast
		const points = (cmd.node as { points: number[] }).points;
		expect(points).toEqual([0, 0, 100, 50]);
	});

	it("skips commit on degenerate click", () => {
		const h = makeHarness();
		lineTool.onPointerDown?.(pointerEvent(10, 10), h.ctx);
		lineTool.onPointerUp?.(pointerEvent(10, 10), h.ctx);
		expect(h.commits).toHaveLength(0);
	});
});
