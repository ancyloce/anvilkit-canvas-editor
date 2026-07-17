import { createStore, type StoreApi } from "zustand/vanilla";

export type UploadTaskStatus = "uploading" | "done" | "failed" | "cancelled";

export interface UploadTask {
	id: string;
	fileName: string;
	status: UploadTaskStatus;
	error?: string;
	/**
	 * FR-091 retry: the original File, retained so a failed task can be
	 * resubmitted without the user re-selecting it. Not serialized anywhere —
	 * this store is transient, in-memory only.
	 */
	file: File;
}

export interface UploadState {
	tasks: UploadTask[];
	begin: (file: File) => string;
	succeed: (id: string) => void;
	fail: (id: string, error: string) => void;
	/** FR-092: cancelled uploads never create nodes when they later resolve. */
	cancel: (id: string) => void;
	isCancelled: (id: string) => boolean;
	/**
	 * FR-091 retry: reset a failed task back to "uploading" in place (same id,
	 * clears `error`) — the caller re-invokes the uploader with `task.file`.
	 * No-op for any status other than "failed".
	 */
	retry: (id: string) => void;
	clearFinished: () => void;
}

export type UploadStoreApi = StoreApi<UploadState>;

let uploadTaskCounter = 0;

export function createUploadStore(): UploadStoreApi {
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
		succeed(id) {
			set((s) => ({
				tasks: s.tasks.map((task) =>
					task.id === id && task.status === "uploading"
						? { ...task, status: "done" as const }
						: task,
				),
			}));
		},
		fail(id, error) {
			set((s) => ({
				tasks: s.tasks.map((task) =>
					task.id === id && task.status === "uploading"
						? { ...task, status: "failed" as const, error }
						: task,
				),
			}));
		},
		cancel(id) {
			set((s) => ({
				tasks: s.tasks.map((task) =>
					task.id === id && task.status === "uploading"
						? { ...task, status: "cancelled" as const }
						: task,
				),
			}));
		},
		isCancelled(id) {
			return get().tasks.some(
				(task) => task.id === id && task.status === "cancelled",
			);
		},
		retry(id) {
			set((s) => ({
				tasks: s.tasks.map((task) =>
					task.id === id && task.status === "failed"
						? { ...task, status: "uploading" as const, error: undefined }
						: task,
				),
			}));
		},
		clearFinished() {
			set((s) => ({
				tasks: s.tasks.filter((task) => task.status === "uploading"),
			}));
		},
	}));
}
