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
import {
	insertAssetsImpl,
	retryUploadImpl,
	uploadFilesImpl,
} from "../upload-actions.js";

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
	it("uploads through the adapter (one call per file), tracks tasks, inserts results", async () => {
		const seenBatches: number[] = [];
		const uploader: CanvasAssetUploader = {
			upload: async (files, ctx) => {
				expect(ctx.documentId).toBe("doc-1");
				expect(ctx.signal).toBeInstanceOf(AbortSignal);
				seenBatches.push(files.length);
				return files.map((f) => ({
					id: `up-${f.name}`,
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
		// Per-file invocation so progress/cancel attribute per task (FR-091).
		expect(seenBatches).toEqual([1, 1]);
		expect(h.commits.filter((c) => c.type === "asset.put")).toHaveLength(2);
		// Still ONE atomic undo entry for the whole drop.
		expect(h.studioCtx.commitBatch).toHaveBeenCalledTimes(1);
		expect(uploadStore.getState().tasks.every((t) => t.status === "done")).toBe(
			true,
		);
	});

	it("reports per-task determinate progress and ignores stale ticks after settle", async () => {
		let tick: ((fraction: number) => void) | null = null;
		let release: (() => void) | null = null;
		const uploader: CanvasAssetUploader = {
			upload: (_files, ctx) =>
				new Promise((resolve) => {
					tick = (fraction) => ctx.onProgress?.({ fileIndex: 0, fraction });
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
		const task = () => uploadStore.getState().tasks[0];
		tick?.(0.4);
		expect(task()?.progress).toBe(0.4);
		tick?.(2);
		expect(task()?.progress).toBe(1); // clamped
		release?.();
		await pending;
		expect(task()?.status).toBe("done");
		tick?.(0.1); // stale tick after settle — must not resurrect progress
		expect(task()?.progress).toBeUndefined();
	});

	it("cancelling a task aborts the adapter's signal (real cancellation)", async () => {
		let signal: AbortSignal | undefined;
		const uploader: CanvasAssetUploader = {
			upload: (_files, ctx) =>
				new Promise((_resolve, reject) => {
					signal = ctx.signal;
					ctx.signal?.addEventListener("abort", () =>
						reject(new Error("aborted")),
					);
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
		expect(signal?.aborted).toBe(true);
		await expect(pending).resolves.toEqual([]);
		// The abort-triggered rejection is the cancel path — NOT a failure.
		expect(uploadStore.getState().tasks[0]?.status).toBe("cancelled");
		expect(h.commits).toHaveLength(0);
	});

	it("a partial batch inserts only the successes, in one batch", async () => {
		const uploader: CanvasAssetUploader = {
			upload: async (files) => {
				const f = files[0];
				if (!f) throw new Error("empty batch");
				if (f.name === "bad.png") throw new Error("cdn down");
				return [{ id: `up-${f.name}`, uri: `https://cdn/${f.name}` }];
			},
		};
		const { h, uploadStore, toasts, toaster } = setup(uploader);
		const ids = await uploadFilesImpl(
			h.studioCtx,
			[file("good.png"), file("bad.png")],
			undefined,
			toaster,
		);
		expect(ids).toHaveLength(1);
		expect(h.studioCtx.commitBatch).toHaveBeenCalledTimes(1);
		expect(h.commits.filter((c) => c.type === "asset.put")).toHaveLength(1);
		const statuses = uploadStore.getState().tasks.map((t) => t.status);
		expect(statuses.sort()).toEqual(["done", "failed"]);
		expect(toasts[0]?.type).toBe("error");
	});

	it("cancelling ONE task of a batch still inserts the sibling's result", async () => {
		const releases: Array<() => void> = [];
		const uploader: CanvasAssetUploader = {
			upload: (files) =>
				new Promise((resolve) => {
					const f = files[0];
					releases.push(() =>
						resolve([{ id: `up-${f?.name}`, uri: `https://cdn/${f?.name}` }]),
					);
				}),
		};
		const { h, uploadStore, toaster } = setup(uploader);
		const pending = uploadFilesImpl(
			h.studioCtx,
			[file("a.png"), file("b.png")],
			undefined,
			toaster,
		);
		const [taskA] = uploadStore.getState().tasks;
		if (!taskA) throw new Error("no task");
		uploadStore.getState().cancel(taskA.id);
		for (const release of releases) release();
		const ids = await pending;
		// Sibling task is not stranded and its result inserts (FR-091 fix).
		expect(ids).toHaveLength(1);
		const byStatus = uploadStore.getState().tasks.map((t) => t.status);
		expect(byStatus.sort()).toEqual(["cancelled", "done"]);
	});

	it("an upload resolving after a store reset (document replacement) inserts nothing", async () => {
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
		uploadStore.getState().reset();
		release?.();
		await expect(pending).resolves.toEqual([]);
		expect(h.commits).toHaveLength(0);
		expect(uploadStore.getState().tasks).toHaveLength(0);
	});

	it("does not insert an EARLIER success into a document replaced mid-batch (E-6)", async () => {
		const releases: Array<() => void> = [];
		const uploader: CanvasAssetUploader = {
			upload: (files) => {
				const f = files[0];
				// "a.png" settles immediately — well before any replacement.
				if (f?.name === "a.png") {
					return Promise.resolve([{ id: "up-a", uri: "https://cdn/a.png" }]);
				}
				return new Promise((resolve) => {
					releases.push(() =>
						resolve([{ id: `up-${f?.name}`, uri: `https://cdn/${f?.name}` }]),
					);
				});
			},
		};
		const { h, uploadStore, toaster } = setup(uploader);
		const pending = uploadFilesImpl(
			h.studioCtx,
			[file("a.png"), file("b.png")],
			undefined,
			toaster,
		);
		// Let "a.png"'s upload -> settled() -> succeed() chain fully run — its
		// OWN check correctly passes here, before anything has reset.
		await Promise.resolve();
		await Promise.resolve();
		expect(
			uploadStore.getState().tasks.find((t) => t.file.name === "a.png")?.status,
		).toBe("done");

		// The document is replaced while "b.png" is still in flight — a real
		// `replaceDocumentSnapshot` resets the upload store AND swaps the IR.
		uploadStore.getState().reset();
		h.setIR(
			createCanvasIR({
				id: "doc-2",
				pages: [createPage({ id: "p2" })],
				now: () => FIXED_TS,
			}),
		);
		const releaseB = releases[0];
		if (!releaseB) throw new Error("no release for b.png");
		releaseB();

		const ids = await pending;
		// "a.png"'s already-succeeded upload must NOT land in the replaced
		// document, even though its own settled() check passed.
		expect(ids).toEqual([]);
		expect(h.commits).toHaveLength(0);
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

describe("retryUploadImpl (FR-091 retry)", () => {
	it("resubmits the SAME failed task's original file without a new task entry", async () => {
		let attempt = 0;
		const uploader: CanvasAssetUploader = {
			upload: async (files) => {
				attempt += 1;
				if (attempt === 1) throw new Error("cdn down");
				return files.map((f) => ({ id: "up-1", uri: `https://cdn/${f.name}` }));
			},
		};
		const { h, uploadStore, toaster } = setup(uploader);
		await uploadFilesImpl(h.studioCtx, [file("a.png")], undefined, toaster);
		const failedTask = uploadStore.getState().tasks[0];
		if (!failedTask) throw new Error("no task");
		expect(failedTask.status).toBe("failed");

		const ids = await retryUploadImpl(h.studioCtx, failedTask.id, toaster);

		expect(ids).toHaveLength(1);
		expect(uploadStore.getState().tasks).toHaveLength(1); // same id, not a new task
		expect(uploadStore.getState().tasks[0]).toMatchObject({
			id: failedTask.id,
			status: "done",
			// E-16: the retry path used to call `succeed(taskId)` with no asset
			// id — the task showed "Done" but its `assetId` stayed unset, so it
			// could never be dragged onto the canvas (FR-093).
			assetId: "up-1",
		});
	});

	it("re-failing keeps the task failed with the new error", async () => {
		const uploader: CanvasAssetUploader = {
			upload: async () => {
				throw new Error("still down");
			},
		};
		const { h, uploadStore, toaster } = setup(uploader);
		await uploadFilesImpl(h.studioCtx, [file("a.png")], undefined, toaster);
		const failedTask = uploadStore.getState().tasks[0];
		if (!failedTask) throw new Error("no task");

		const ids = await retryUploadImpl(h.studioCtx, failedTask.id, toaster);

		expect(ids).toEqual([]);
		expect(uploadStore.getState().tasks[0]).toMatchObject({
			status: "failed",
			error: "still down",
		});
	});

	it("is a no-op for an unknown task id or a task that isn't failed", async () => {
		const uploader: CanvasAssetUploader = {
			upload: async (files) =>
				files.map((f) => ({ id: "up", uri: `https://cdn/${f.name}` })),
		};
		const { h, uploadStore, toaster } = setup(uploader);
		expect(await retryUploadImpl(h.studioCtx, "missing", toaster)).toEqual([]);
		await uploadFilesImpl(h.studioCtx, [file("a.png")], undefined, toaster);
		const doneTask = uploadStore.getState().tasks[0];
		if (!doneTask) throw new Error("no task");
		expect(doneTask.status).toBe("done");
		expect(await retryUploadImpl(h.studioCtx, doneTask.id, toaster)).toEqual(
			[],
		);
	});

	it("without an uploader: no-op (no crash)", async () => {
		const { h, uploadStore, toaster } = setup();
		const taskId = uploadStore.getState().begin(file("a.png"));
		uploadStore.getState().fail(taskId, "x");
		h.studioCtx.assetUploader = undefined;
		expect(await retryUploadImpl(h.studioCtx, taskId, toaster)).toEqual([]);
	});
});
