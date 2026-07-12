import {
	type CanvasFrameNode,
	type CanvasIR,
	type CanvasNodeCreateCommand,
	createCanvasIR,
	createFrame,
	createGroup,
	createPage,
} from "@anvilkit/canvas-core";
import { describe, expect, it } from "vitest";
import { frameTool } from "../frame-tool.js";
import { makeHarness, pointerEvent } from "./_tool-test-helpers.js";

const FIXED_TS = "2026-05-20T00:00:00.000Z";

function irWith(children: CanvasFrameNode[] = []): CanvasIR {
	const page = createPage({ id: "p1" });
	page.root = createGroup({
		id: "p1-root",
		bounds: page.root.bounds,
		children,
	});
	return createCanvasIR({ id: "ir-1", pages: [page], now: () => FIXED_TS });
}

/** pointerdown → move → up, the MVP-7 gesture shape. */
function drag(
	ctx: Parameters<NonNullable<typeof frameTool.onPointerDown>>[1],
	from: [number, number],
	to: [number, number],
): void {
	frameTool.onPointerDown?.(pointerEvent(from[0], from[1]), ctx);
	frameTool.onPointerMove?.(pointerEvent(to[0], to[1]), ctx);
	frameTool.onPointerUp?.(pointerEvent(to[0], to[1]), ctx);
}

const created = (h: ReturnType<typeof makeHarness>) =>
	h.commits[0] as CanvasNodeCreateCommand;

describe("frameTool", () => {
	it("drags out a clipped frame at the drag rect", () => {
		const h = makeHarness({ ir: irWith() });
		drag(h.ctx, [10, 20], [110, 70]);

		expect(h.commits).toHaveLength(1);
		const cmd = created(h);
		expect(cmd.type).toBe("node.create");
		const node = cmd.node as CanvasFrameNode;
		expect(node.type).toBe("frame");
		expect(node.transform.x).toBe(10);
		expect(node.transform.y).toBe(20);
		expect(node.bounds).toEqual({ width: 100, height: 50 });
		// Clipping is the whole reason to reach for a frame over a group.
		expect(node.clip).toBe(true);
	});

	it("normalises a right-to-left / bottom-to-top drag", () => {
		const h = makeHarness({ ir: irWith() });
		drag(h.ctx, [110, 70], [10, 20]);
		const node = created(h).node as CanvasFrameNode;
		expect(node.transform.x).toBe(10);
		expect(node.transform.y).toBe(20);
		expect(node.bounds).toEqual({ width: 100, height: 50 });
	});

	it("starts plain, not as an image well", () => {
		const h = makeHarness({ ir: irWith() });
		drag(h.ctx, [0, 0], [100, 100]);
		expect((created(h).node as CanvasFrameNode).placeholder).toBeUndefined();
	});

	it("commits nothing for a degenerate (click-without-drag) gesture", () => {
		const h = makeHarness({ ir: irWith() });
		drag(h.ctx, [50, 50], [50, 50]);
		expect(h.commits).toHaveLength(0);
	});

	it("commits nothing during the drag — only on pointerup (MVP-7)", () => {
		const h = makeHarness({ ir: irWith() });
		frameTool.onPointerDown?.(pointerEvent(0, 0), h.ctx);
		frameTool.onPointerMove?.(pointerEvent(50, 50), h.ctx);
		expect(h.commits).toHaveLength(0);
		frameTool.onPointerUp?.(pointerEvent(50, 50), h.ctx);
		expect(h.commits).toHaveLength(1);
	});

	it("clears the draft + guides on deactivate", () => {
		const h = makeHarness({ ir: irWith() });
		frameTool.onPointerDown?.(pointerEvent(0, 0), h.ctx);
		expect(h.ctx.draftStore.getState().draft).not.toBeNull();
		frameTool.onDeactivate?.(h.ctx);
		expect(h.ctx.draftStore.getState().draft).toBeNull();
	});

	it("selects the new frame", () => {
		const h = makeHarness({ ir: irWith() });
		drag(h.ctx, [0, 0], [100, 100]);
		expect(h.ctx.selectionStore.getState().selectedIds).toEqual([
			created(h).node.id,
		]);
	});
});

describe("frameTool — nesting", () => {
	const parent = () =>
		createFrame({
			id: "parent",
			transform: { x: 100, y: 100 },
			bounds: { width: 300, height: 300 },
			clip: true,
		});

	it("nests a frame drawn inside an existing frame, rebased to the parent's space", () => {
		const h = makeHarness({ ir: irWith([parent()]) });
		// World (150,150)→(250,200) lies inside the parent at world (100,100).
		drag(h.ctx, [150, 150], [250, 200]);

		const cmd = created(h);
		expect(cmd.parentId).toBe("parent");
		const node = cmd.node as CanvasFrameNode;
		// Local to the parent: (150-100, 150-100) = (50,50).
		expect(node.transform.x).toBe(50);
		expect(node.transform.y).toBe(50);
		expect(node.bounds).toEqual({ width: 100, height: 50 });
	});

	it("rebases correctly through a SCALED parent — a world delta is not a local delta", () => {
		const scaled = createFrame({
			id: "parent",
			transform: { x: 100, y: 100, scaleX: 2, scaleY: 2 },
			bounds: { width: 300, height: 300 },
			clip: true,
		});
		const h = makeHarness({ ir: irWith([scaled]) });
		// World (200,200)→(300,300): 100×100 on screen, but the parent is 2×, so
		// the child is 50×50 in the parent's own units, at local (50,50).
		drag(h.ctx, [200, 200], [300, 300]);

		const node = created(h).node as CanvasFrameNode;
		expect(node.transform.x).toBe(50);
		expect(node.transform.y).toBe(50);
		expect(node.bounds).toEqual({ width: 50, height: 50 });
	});

	it("stays top-level when the drag starts outside every frame", () => {
		const h = makeHarness({ ir: irWith([parent()]) });
		drag(h.ctx, [10, 10], [60, 60]);
		expect(created(h).parentId).toBeUndefined();
	});

	// Only the START point decides the parent, so dragging out past the parent's
	// edge still nests rather than flipping the target mid-gesture.
	it("nests by the drag's START point even when it ends outside the parent", () => {
		const h = makeHarness({ ir: irWith([parent()]) });
		drag(h.ctx, [150, 150], [900, 900]);
		expect(created(h).parentId).toBe("parent");
	});
});
