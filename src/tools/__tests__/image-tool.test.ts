import {
	type CanvasNodeCreateCommand,
	createCanvasIR,
	createPage,
} from "@anvilkit/canvas-core";
import { describe, expect, it, vi } from "vitest";
import { imageTool } from "../image-tool.js";
import { makeHarness, pointerEvent } from "./_tool-test-helpers.js";

const FIXED_TS = "2026-05-20T00:00:00.000Z";

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

	it("no-ops (no crash, no commit) when the active page is removed while the picker is open (E-17)", async () => {
		const h = makeHarness();
		const pageRemovedIR = createCanvasIR({
			id: "ir-2",
			pages: [createPage({ id: "p2" })],
			now: () => FIXED_TS,
		});
		h.ctx.pickAsset = vi.fn(async () => {
			// The gesture's `ctx.activePageId` still says "p1" — simulate the
			// active page having been deleted while this await was pending.
			h.setIR(pageRemovedIR);
			return "asset-42";
		});
		expect(() =>
			imageTool.onPointerDown?.(pointerEvent(100, 200), h.ctx),
		).not.toThrow();
		await Promise.resolve();
		await Promise.resolve();
		expect(h.commits).toHaveLength(0);
	});
});

describe("imageTool multi-select (FR-090, pickAssets)", () => {
	it("grid-arranges every picked image as ONE batch when more than one is picked", async () => {
		const h = makeHarness();
		h.ctx.pickAssets = vi.fn(() =>
			Promise.resolve([
				{ id: "a1", uri: "data:1" },
				{ id: "a2", uri: "data:2" },
			]),
		);
		imageTool.onPointerDown?.(pointerEvent(100, 200), h.ctx);
		await Promise.resolve();
		await Promise.resolve();
		expect(h.ctx.pickAssets).toHaveBeenCalledTimes(1);
		expect(h.commits).toHaveLength(4); // asset.put + node.create per asset
		expect(h.commits.map((c) => c.type)).toEqual([
			"asset.put",
			"node.create",
			"asset.put",
			"node.create",
		]);
		const nodeIds = h.commits
			.filter((c) => c.type === "node.create")
			.map((c) => (c as CanvasNodeCreateCommand).node.id);
		expect(h.ctx.selectionStore.getState().selectedIds).toEqual(nodeIds);
	});

	it("keeps the exact single-asset legacy shape when pickAssets resolves with only one", async () => {
		const h = makeHarness();
		h.ctx.pickAssets = vi.fn(() =>
			Promise.resolve([{ id: "asset-42", uri: "data:1" }]),
		);
		imageTool.onPointerDown?.(pointerEvent(100, 200), h.ctx);
		await Promise.resolve();
		await Promise.resolve();
		// Exactly one node.create, no asset.put — unchanged from the pickAsset path.
		expect(h.commits).toHaveLength(1);
		const cmd = h.commits[0] as CanvasNodeCreateCommand;
		expect(cmd.type).toBe("node.create");
		expect((cmd.node as { assetId: string }).assetId).toBe("asset-42");
	});

	it("does not commit when pickAssets resolves with an empty array", async () => {
		const h = makeHarness();
		h.ctx.pickAssets = vi.fn(() => Promise.resolve([]));
		imageTool.onPointerDown?.(pointerEvent(0, 0), h.ctx);
		await Promise.resolve();
		await Promise.resolve();
		expect(h.commits).toHaveLength(0);
	});

	it("does not commit when pickAssets rejects (user cancelled)", async () => {
		const h = makeHarness();
		h.ctx.pickAssets = vi.fn(() => Promise.reject(new Error("cancelled")));
		imageTool.onPointerDown?.(pointerEvent(0, 0), h.ctx);
		await Promise.resolve();
		await Promise.resolve();
		expect(h.commits).toHaveLength(0);
	});
});
