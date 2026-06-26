import {
	type CanvasIR,
	type CanvasNodeUpdateCommand,
	createCanvasIR,
	createImage,
	createPage,
	createRect,
} from "@anvilkit/canvas-core";
import { describe, expect, it } from "vitest";
import type { CropRect } from "@/stores/crop-store.js";
import { makeHarness } from "@/tools/__tests__/_tool-test-helpers.js";
import {
	beginCrop,
	cancelCrop,
	commitCrop,
	computeCropDrag,
} from "../crop-actions.js";

function imageIR(): CanvasIR {
	const page = createPage({ id: "p1" });
	page.root.children = [
		createImage({
			id: "img-a",
			bounds: { width: 200, height: 100 },
			assetId: "asset-1",
		}),
		createRect({ id: "rect-a", bounds: { width: 10, height: 10 } }),
	];
	return createCanvasIR({ id: "ir", pages: [page] });
}

describe("beginCrop", () => {
	it("opens the crop editor for an image node", () => {
		const h = makeHarness({ ir: imageIR() });
		expect(beginCrop(h.studioCtx, "img-a")).toBe(true);
		expect(h.studioCtx.cropStore?.getState().cropNodeId).toBe("img-a");
	});

	it("is a no-op for a non-image node", () => {
		const h = makeHarness({ ir: imageIR() });
		expect(beginCrop(h.studioCtx, "rect-a")).toBe(false);
		expect(h.studioCtx.cropStore?.getState().cropNodeId).toBeNull();
	});
});

describe("commitCrop", () => {
	it("commits a node.update with the draft crop and closes the editor", () => {
		const h = makeHarness({ ir: imageIR() });
		const store = h.studioCtx.cropStore;
		if (!store) throw new Error("crop store missing");
		store.getState().begin("img-a");
		const draft: CropRect = { x: 10, y: 20, width: 80, height: 40 };
		store.getState().setDraft(draft);
		commitCrop(h.studioCtx);
		expect(h.commits).toHaveLength(1);
		const cmd = h.commits[0] as CanvasNodeUpdateCommand<"image">;
		expect(cmd.type).toBe("node.update");
		expect(cmd.kind).toBe("image");
		expect((cmd.patch as { crop?: CropRect }).crop).toEqual(draft);
		expect(store.getState().cropNodeId).toBeNull();
	});

	it("discards a zero-area draft without committing", () => {
		const h = makeHarness({ ir: imageIR() });
		const store = h.studioCtx.cropStore;
		if (!store) throw new Error("crop store missing");
		store.getState().begin("img-a");
		store.getState().setDraft({ x: 0, y: 0, width: 0, height: 50 });
		commitCrop(h.studioCtx);
		expect(h.commits).toHaveLength(0);
		expect(store.getState().cropNodeId).toBeNull();
	});
});

describe("cancelCrop", () => {
	it("closes the editor without committing", () => {
		const h = makeHarness({ ir: imageIR() });
		const store = h.studioCtx.cropStore;
		if (!store) throw new Error("crop store missing");
		store.getState().begin("img-a");
		store.getState().setDraft({ x: 1, y: 2, width: 3, height: 4 });
		cancelCrop(h.studioCtx);
		expect(h.commits).toHaveLength(0);
		expect(store.getState().cropNodeId).toBeNull();
		expect(store.getState().draft).toBeNull();
	});
});

describe("computeCropDrag", () => {
	const start: CropRect = { x: 20, y: 20, width: 60, height: 40 };

	it("moves the rect and clamps within the image bounds", () => {
		expect(computeCropDrag("move", start, 10, 10, 200, 100)).toEqual({
			x: 30,
			y: 30,
			width: 60,
			height: 40,
		});
		// Clamp: cannot move past the right/bottom edge.
		expect(computeCropDrag("move", start, 1000, 1000, 200, 100)).toEqual({
			x: 140,
			y: 60,
			width: 60,
			height: 40,
		});
	});

	it("nw handle adjusts the left+top edges", () => {
		expect(computeCropDrag("nw", start, 10, 5, 200, 100)).toEqual({
			x: 30,
			y: 25,
			width: 50,
			height: 35,
		});
	});

	it("se handle adjusts the right+bottom edges and clamps to the image", () => {
		expect(computeCropDrag("se", start, 1000, 1000, 200, 100)).toEqual({
			x: 20,
			y: 20,
			width: 180,
			height: 80,
		});
	});

	it("keeps a minimum size when a handle is dragged past the opposite edge", () => {
		const r = computeCropDrag("nw", start, 1000, 1000, 200, 100);
		expect(r.width).toBe(1);
		expect(r.height).toBe(1);
	});
});
