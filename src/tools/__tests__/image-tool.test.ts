import type { CanvasNodeCreateCommand } from "@anvilkit/canvas-core";
import { describe, expect, it, vi } from "vitest";
import { imageTool } from "../image-tool.js";
import { makeHarness, pointerEvent } from "./_tool-test-helpers.js";

describe("imageTool", () => {
	it("places an image node after pickAsset resolves", async () => {
		const h = makeHarness();
		h.ctx.pickAsset = vi.fn(() => Promise.resolve("asset-42"));
		imageTool.onPointerDown?.(pointerEvent(100, 200), h.ctx);
		// pickAsset is async — wait a microtask.
		await Promise.resolve();
		await Promise.resolve();
		expect(h.ctx.pickAsset).toHaveBeenCalledTimes(1);
		expect(h.commits).toHaveLength(1);
		const cmd = h.commits[0] as CanvasNodeCreateCommand;
		expect(cmd.type).toBe("node.create");
		expect(cmd.node.type).toBe("image");
		expect(cmd.node.transform.x).toBe(100);
		expect(cmd.node.transform.y).toBe(200);
		expect((cmd.node as { assetId: string }).assetId).toBe("asset-42");
		expect(h.ctx.selectionStore.getState().selectedIds).toEqual([cmd.node.id]);
	});

	it("does not commit when pickAsset rejects (user cancelled)", async () => {
		const h = makeHarness();
		h.ctx.pickAsset = vi.fn(() => Promise.reject(new Error("cancelled")));
		imageTool.onPointerDown?.(pointerEvent(0, 0), h.ctx);
		await Promise.resolve();
		await Promise.resolve();
		expect(h.commits).toHaveLength(0);
	});

	it("does not commit when pickAsset resolves with an empty string", async () => {
		const h = makeHarness();
		h.ctx.pickAsset = vi.fn(() => Promise.resolve(""));
		imageTool.onPointerDown?.(pointerEvent(0, 0), h.ctx);
		await Promise.resolve();
		await Promise.resolve();
		expect(h.commits).toHaveLength(0);
	});

	it("pointermove / pointerup are undefined", () => {
		expect(imageTool.onPointerMove).toBeUndefined();
		expect(imageTool.onPointerUp).toBeUndefined();
	});
});
