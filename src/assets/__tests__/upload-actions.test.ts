import {
	type CanvasAssetPutCommand,
	type CanvasIR,
	type CanvasNodeCreateCommand,
	createCanvasIR,
	createPage,
} from "@anvilkit/canvas-core";
import { describe, expect, it } from "vitest";
import type { CanvasToastInput } from "@/context/toast-context.js";
import { createUploadStore } from "@/stores/upload-store.js";
import { makeHarness } from "@/tools/__tests__/_tool-test-helpers.js";
import type { CanvasAssetUploader } from "../adapter-types.js";
import { insertAssetsImpl, uploadFilesImpl } from "../upload-actions.js";

const FIXED_TS = "2026-05-20T00:00:00.000Z";

function fixtureIR(): CanvasIR {
	return createCanvasIR({
		id: "doc-1",
		pages: [createPage({ id: "p1", size: { width: 800, height: 600 } })],
		now: () => FIXED_TS,
	});
}

function setup(uploader?: CanvasAssetUploader) {
	const h = makeHarness({ ir: fixtureIR() });
	const uploadStore = createUploadStore();
	h.studioCtx.uploadStore = uploadStore;
	if (uploader) h.studioCtx.assetUploader = uploader;
	const toasts: CanvasToastInput[] = [];
	const toaster = { add: (input: CanvasToastInput) => toasts.push(input) };
	return { h, uploadStore, toasts, toaster };
}

const file = (name: string): File =>
	new File(["x"], name, { type: "image/png" });

describe("insertAssetsImpl (B-10)", () => {
	it("inserts asset.put + node.create pairs as ONE batch, grid-arranged, selected", () => {
		const { h } = setup();
		const ids = insertAssetsImpl(h.studioCtx, [
			{ id: "a1", uri: "https://x/1.png", width: 100, height: 50 },
			{ id: "a2", uri: "https://x/2.png" },
		]);
		expect(h.studioCtx.commitBatch).toHaveBeenCalledTimes(1);
		expect(h.commits.map((c) => c.type)).toEqual([
			"asset.put",
			"node.create",
			"asset.put",
			"node.create",
		]);
		const firstPut = h.commits[0] as CanvasAssetPutCommand;
		expect(firstPut.asset).toMatchObject({ id: "a1", width: 100 });
		const firstNode = h.commits[1] as CanvasNodeCreateCommand;
		// Centered: (800-100)/2 = 350.
		expect(firstNode.node.transform.x).toBe(350);
		const secondNode = h.commits[3] as CanvasNodeCreateCommand;
		// Grid step for the second item.
		expect(secondNode.node.transform.x).toBeGreaterThan((800 - 240) / 2);
		expect(h.studioCtx.selectionStore.getState().selectedIds).toEqual(ids);
	});

	it("anchors to the given position when it falls within the active page", () => {
		const { h } = setup();
		insertAssetsImpl(
			h.studioCtx,
			[{ id: "a1", uri: "https://x/1.png", width: 100, height: 50 }],
			{ x: 40, y: 60 },
		);
		const node = h.commits[1] as CanvasNodeCreateCommand;
		expect(node.node.transform).toMatchObject({ x: 40, y: 60 });
	});

	it("falls back to centering when the given position is outside the page", () => {
		const { h } = setup();
		// Page is 800x600; (-50, 900) is outside on both axes.
		insertAssetsImpl(
			h.studioCtx,
			[{ id: "a1", uri: "https://x/1.png", width: 100, height: 50 }],
			{ x: -50, y: 900 },
		);
		const node = h.commits[1] as CanvasNodeCreateCommand;
		// Centered: (800-100)/2 = 350, (600-50)/2 = 275.
		expect(node.node.transform).toMatchObject({ x: 350, y: 275 });
	});

	it("grid-arranges multiple assets around the real (in-page) anchor, not page center", () => {
		const { h } = setup();
		insertAssetsImpl(
			h.studioCtx,
			[
				{ id: "a1", uri: "https://x/1.png", width: 100, height: 50 },
				{ id: "a2", uri: "https://x/2.png", width: 100, height: 50 },
			],
			{ x: 40, y: 60 },
		);
		const first = h.commits[1] as CanvasNodeCreateCommand;
		const second = h.commits[3] as CanvasNodeCreateCommand;
		expect(first.node.transform).toMatchObject({ x: 40, y: 60 });
		// GRID_STEP = 24, GRID_COLUMNS = 3: second item offsets on x only.
		expect(second.node.transform).toMatchObject({ x: 64, y: 60 });
	});
});

describe("uploadFilesImpl (B-10, FR-091/092)", () => {
	it("uploads through the adapter, tracks tasks, inserts results", async () => {
		const uploader: CanvasAssetUploader = {
			upload: async (files, ctx) => {
				expect(ctx.documentId).toBe("doc-1");
				return files.map((f, i) => ({
					id: `up-${i}`,
					uri: `https://cdn/${f.name}`,
				}));
			},
		};
		const { h, uploadStore, toaster } = setup(uploader);
		const ids = await uploadFilesImpl(
			h.studioCtx,
			[file("a.png"), file("b.png")],
			undefined,
			toaster,
		);
		expect(ids).toHaveLength(2);
		expect(h.commits.filter((c) => c.type === "asset.put")).toHaveLength(2);
		expect(uploadStore.getState().tasks.every((t) => t.status === "done")).toBe(
			true,
		);
	});

	it("failed uploads create NO nodes, mark tasks failed, toast the error", async () => {
		const uploader: CanvasAssetUploader = {
			upload: async () => {
				throw new Error("cdn down");
			},
		};
		const { h, uploadStore, toasts, toaster } = setup(uploader);
		const ids = await uploadFilesImpl(
			h.studioCtx,
			[file("a.png")],
			undefined,
			toaster,
		);
		expect(ids).toEqual([]);
		expect(h.commits).toHaveLength(0);
		expect(uploadStore.getState().tasks[0]).toMatchObject({
			status: "failed",
			error: "cdn down",
		});
		expect(toasts[0]?.type).toBe("error");
	});

	it("a task cancelled mid-flight drops the results silently", async () => {
		let release: (() => void) | null = null;
		const uploader: CanvasAssetUploader = {
			upload: () =>
				new Promise((resolve) => {
					release = () => resolve([{ id: "up", uri: "https://x" }]);
				}),
		};
		const { h, uploadStore, toaster } = setup(uploader);
		const pending = uploadFilesImpl(
			h.studioCtx,
			[file("a.png")],
			undefined,
			toaster,
		);
		const task = uploadStore.getState().tasks[0];
		if (!task) throw new Error("no task");
		uploadStore.getState().cancel(task.id);
		release?.();
		await expect(pending).resolves.toEqual([]);
		expect(h.commits).toHaveLength(0);
	});

	it("without an uploader: info toast, nothing else", async () => {
		const { h, toasts, toaster } = setup();
		const ids = await uploadFilesImpl(
			h.studioCtx,
			[file("a.png")],
			undefined,
			toaster,
		);
		expect(ids).toEqual([]);
		expect(h.commits).toHaveLength(0);
		expect(toasts[0]?.type).toBe("info");
	});
});
