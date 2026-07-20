import { describe, expect, it, vi } from "vitest";
import { createUploadStore } from "../upload-store.js";

/**
 * FR-091/092 upload store: progress, per-task abort registry, retry, and the
 * document-replacement reset.
 */

const file = (name: string): File =>
	new File(["x"], name, { type: "image/png" });

describe("upload-store (FR-091/092)", () => {
	it("tracks determinate progress only while uploading, clamped to 0-1", () => {
		const store = createUploadStore();
		const id = store.getState().begin(file("a.png"));
		store.getState().setProgress(id, 0.5);
		expect(store.getState().tasks[0]?.progress).toBe(0.5);
		store.getState().setProgress(id, -1);
		expect(store.getState().tasks[0]?.progress).toBe(0);
		store.getState().setProgress(id, 7);
		expect(store.getState().tasks[0]?.progress).toBe(1);
		store.getState().succeed(id);
		store.getState().setProgress(id, 0.2); // stale tick after settle
		expect(store.getState().tasks[0]?.progress).toBeUndefined();
	});

	it("cancel invokes the registered abort exactly once and clears progress", () => {
		const store = createUploadStore();
		const id = store.getState().begin(file("a.png"));
		const abort = vi.fn();
		store.getState().registerAbort(id, abort);
		store.getState().setProgress(id, 0.9);
		store.getState().cancel(id);
		store.getState().cancel(id);
		expect(abort).toHaveBeenCalledTimes(1);
		expect(store.getState().tasks[0]).toMatchObject({
			status: "cancelled",
			progress: undefined,
		});
	});

	it("registering an abort AFTER a cancel aborts immediately (race guard)", () => {
		const store = createUploadStore();
		const id = store.getState().begin(file("a.png"));
		store.getState().cancel(id);
		const abort = vi.fn();
		store.getState().registerAbort(id, abort);
		expect(abort).toHaveBeenCalledTimes(1);
	});

	it("succeed/fail drop the abort registration (no abort on later reset)", () => {
		const store = createUploadStore();
		const id = store.getState().begin(file("a.png"));
		const abort = vi.fn();
		store.getState().registerAbort(id, abort);
		store.getState().succeed(id);
		store.getState().reset();
		expect(abort).not.toHaveBeenCalled();
	});

	it("retry resets error and progress in place", () => {
		const store = createUploadStore();
		const id = store.getState().begin(file("a.png"));
		store.getState().setProgress(id, 0.7);
		store.getState().fail(id, "cdn down");
		store.getState().retry(id);
		expect(store.getState().tasks[0]).toMatchObject({
			id,
			status: "uploading",
			error: undefined,
			progress: undefined,
		});
	});

	it("reset aborts every in-flight task and empties the list (has() goes false)", () => {
		const store = createUploadStore();
		const a = store.getState().begin(file("a.png"));
		const b = store.getState().begin(file("b.png"));
		const abortA = vi.fn();
		const abortB = vi.fn();
		store.getState().registerAbort(a, abortA);
		store.getState().registerAbort(b, abortB);
		expect(store.getState().has(a)).toBe(true);
		store.getState().reset();
		expect(abortA).toHaveBeenCalledTimes(1);
		expect(abortB).toHaveBeenCalledTimes(1);
		expect(store.getState().tasks).toHaveLength(0);
		expect(store.getState().has(a)).toBe(false);
	});

	it("clearFinished keeps only uploading tasks", () => {
		const store = createUploadStore();
		const a = store.getState().begin(file("a.png"));
		const b = store.getState().begin(file("b.png"));
		store.getState().succeed(a);
		store.getState().clearFinished();
		expect(store.getState().tasks.map((t) => t.id)).toEqual([b]);
	});
});
