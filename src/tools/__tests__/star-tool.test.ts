import type { CanvasNodeCreateCommand } from "@anvilkit/canvas-core";
import { describe, expect, it } from "vitest";
import { starTool } from "../star-tool.js";
import { makeHarness, pointerEvent } from "./_tool-test-helpers.js";

describe("starTool", () => {
	it("sets draft on pointerdown, updates on pointermove, commits node.create on pointerup", () => {
		const h = makeHarness();
		starTool.onPointerDown?.(pointerEvent(10, 20), h.ctx);
		const after1 = h.ctx.draftStore.getState().draft;
		expect(after1).toMatchObject({
			type: "star",
			startX: 10,
			startY: 20,
			currentX: 10,
			currentY: 20,
		});

		starTool.onPointerMove?.(pointerEvent(50, 80), h.ctx);
		const after2 = h.ctx.draftStore.getState().draft;
		expect(after2).toMatchObject({ currentX: 50, currentY: 80 });
		expect(h.commits).toHaveLength(0); // NO commit during move (MVP-7)

		starTool.onPointerUp?.(pointerEvent(50, 80), h.ctx);
		expect(h.commits).toHaveLength(1);
		const cmd = h.commits[0] as CanvasNodeCreateCommand;
		expect(cmd.type).toBe("node.create");
		expect(cmd.pageId).toBe("p1");
		expect(cmd.node.type).toBe("star");
		expect(cmd.node.transform.x).toBe(10);
		expect(cmd.node.transform.y).toBe(20);
		expect(cmd.node.bounds).toEqual({ width: 40, height: 60 });
		expect((cmd.node as { points: number }).points).toBe(5);
		expect((cmd.node as { innerRadiusRatio: number }).innerRadiusRatio).toBe(
			0.5,
		);

		expect(h.ctx.draftStore.getState().draft).toBeNull();
		expect(h.ctx.guidesStore.getState().guides).toEqual([]);
		expect(h.ctx.selectionStore.getState().selectedIds).toEqual([cmd.node.id]);
	});

	it("drawing right-to-left or bottom-to-top works (min/abs derive corner)", () => {
		const h = makeHarness();
		starTool.onPointerDown?.(pointerEvent(100, 100), h.ctx);
		starTool.onPointerUp?.(pointerEvent(30, 40), h.ctx);
		expect(h.commits).toHaveLength(1);
		const cmd = h.commits[0] as CanvasNodeCreateCommand;
		expect(cmd.node.transform.x).toBe(30);
		expect(cmd.node.transform.y).toBe(40);
		expect(cmd.node.bounds).toEqual({ width: 70, height: 60 });
	});

	it("skips commit when end point is within MIN_DIMENSION of start (degenerate click)", () => {
		const h = makeHarness();
		starTool.onPointerDown?.(pointerEvent(10, 10), h.ctx);
		starTool.onPointerUp?.(pointerEvent(10.5, 10.5), h.ctx);
		expect(h.commits).toHaveLength(0);
		expect(h.ctx.draftStore.getState().draft).toBeNull();
	});

	it("pointermove without a prior pointerdown is a no-op", () => {
		const h = makeHarness();
		expect(() =>
			starTool.onPointerMove?.(pointerEvent(10, 10), h.ctx),
		).not.toThrow();
		expect(h.ctx.draftStore.getState().draft).toBeNull();
	});

	it("onDeactivate clears draft + guides", () => {
		const h = makeHarness();
		starTool.onPointerDown?.(pointerEvent(10, 10), h.ctx);
		h.ctx.guidesStore.getState().setGuides([
			{
				axis: "x",
				position: 0,
				from: { x: 0, y: 0 },
				to: { x: 0, y: 0 },
			},
		]);
		starTool.onDeactivate?.(h.ctx);
		expect(h.ctx.draftStore.getState().draft).toBeNull();
		expect(h.ctx.guidesStore.getState().guides).toEqual([]);
	});
});
