import { createStore, type StoreApi } from "zustand/vanilla";

export type UploadTaskStatus = "uploading" | "done" | "failed" | "cancelled";

export interface UploadTask {
	id: string;
	fileName: string;
	status: UploadTaskStatus;
	error?: string;
	/**
	 * FR-091 determinate progress: 0–1 completed fraction, present only while
	 * the adapter reports it. Absent → the UI shows indeterminate progress.
	 */
	progress?: number;
	/**
	 * FR-091 retry: the original File, retained so a failed task can be
	 * resubmitted without the user re-selecting it. Not serialized anywhere —
	 * this store is transient, in-memory only.
	 */
	file: File;
	/**
	 * FR-093: the `ir.assets` id the completed upload registered — what a
	 * done task drags onto the canvas to insert or replace without
	 * re-uploading. Present only on "done" tasks.
	 */
	assetId?: string;
}

export interface UploadState {
	tasks: UploadTask[];
	begin: (file: File) => string;
	succeed: (id: string, assetId?: string) => void;
	fail: (id: string, error: string) => void;
	/**
	 * FR-092: cancel a single task. Flips it to "cancelled" AND aborts its
	 * transport via the abort registered with {@link UploadState.registerAbort}
	 * (real cancellation for adapters that honor the AbortSignal; logical
	 * cancellation — the result is discarded — for adapters that ignore it).
	 */
	cancel: (id: string) => void;
	isCancelled: (id: string) => boolean;
	/** True while the task exists in this store (false after {@link UploadState.reset}). */
	has: (id: string) => boolean;
	/**
	 * FR-091: per-task determinate progress (0–1, clamped). Ignored unless the
	 * task is still "uploading", so a stale tick from a settled, cancelled, or
	 * pre-reset task can never repaint the bar.
	 */
	setProgress: (id: string, fraction: number) => void;
	/** Register the aborter for an in-flight task (idempotent per task). */
	registerAbort: (id: string, abort: () => void) => void;
	/**
	 * FR-091 retry: reset a failed task back to "uploading" in place (same id,
	 * clears `error` and `progress`) — the caller re-invokes the uploader with
	 * `task.file`. No-op for any status other than "failed".
	 */
	retry: (id: string) => void;
	clearFinished: () => void;
	/**
	 * FR-091/160: document replacement / unmount cleanup. Aborts every
	 * in-flight task's transport and empties the list; uploads that later
	 * resolve find their task gone (`has()` is false) and insert nothing.
	 */
	reset: () => void;
}

export type UploadStoreApi = StoreApi<UploadState>;

let uploadTaskCounter = 0;

export function createUploadStore(): UploadStoreApi {
	/** Abort callbacks live OUTSIDE state — they are not renderable data. */
	const aborters = new Map<string, () => void>();
	const abortTask = (id: string): void => {
		const abort = aborters.get(id);
		aborters.delete(id);
		abort?.();
	};
	return createStore<UploadState>()((set, get) => ({
		tasks: [],
		begin(file) {
			const id = `upload-${++uploadTaskCounter}`;
			set((s) => ({
				tasks: [
					...s.tasks,
					{ id, fileName: file.name, status: "uploading" as const, file },
				],
			}));
			return id;
		},
		succeed(id, assetId) {
			aborters.delete(id);
			set((s) => ({
				tasks: s.tasks.map((task) =>
					task.id === id && task.status === "uploading"
						? {
								...task,
								status: "done" as const,
								progress: undefined,
								...(assetId !== undefined ? { assetId } : {}),
							}
						: task,
				),
			}));
		},
		fail(id, error) {
			aborters.delete(id);
			set((s) => ({
				tasks: s.tasks.map((task) =>
					task.id === id && task.status === "uploading"
						? {
								...task,
								status: "failed" as const,
								error,
								progress: undefined,
							}
						: task,
				),
			}));
		},
		cancel(id) {
			abortTask(id);
			set((s) => ({
				tasks: s.tasks.map((task) =>
					task.id === id && task.status === "uploading"
						? { ...task, status: "cancelled" as const, progress: undefined }
						: task,
				),
			}));
		},
		isCancelled(id) {
			return get().tasks.some(
				(task) => task.id === id && task.status === "cancelled",
			);
		},
		has(id) {
			return get().tasks.some((task) => task.id === id);
		},
		setProgress(id, fraction) {
			const clamped = Math.max(0, Math.min(1, fraction));
			set((s) => ({
				tasks: s.tasks.map((task) =>
					task.id === id && task.status === "uploading"
						? { ...task, progress: clamped }
						: task,
				),
			}));
		},
		registerAbort(id, abort) {
			// Only in-flight tasks may register; a cancel that already happened
			// (cancel-before-register race) aborts immediately.
			const task = get().tasks.find((t) => t.id === id);
			if (!task) return;
			if (task.status === "uploading") aborters.set(id, abort);
			else if (task.status === "cancelled") abort();
		},
		retry(id) {
			set((s) => ({
				tasks: s.tasks.map((task) =>
					task.id === id && task.status === "failed"
						? {
								...task,
								status: "uploading" as const,
								error: undefined,
								progress: undefined,
							}
						: task,
				),
			}));
		},
		clearFinished() {
			set((s) => ({
				tasks: s.tasks.filter((task) => task.status === "uploading"),
			}));
		},
		reset() {
			for (const id of [...aborters.keys()]) abortTask(id);
			set({ tasks: [] });
		},
	}));
}
