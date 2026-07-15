import { createStore, type StoreApi } from "zustand/vanilla";

export type UploadTaskStatus = "uploading" | "done" | "failed" | "cancelled";

export interface UploadTask {
	id: string;
	fileName: string;
	status: UploadTaskStatus;
	error?: string;
}

export interface UploadState {
	tasks: UploadTask[];
	begin: (fileName: string) => string;
	succeed: (id: string) => void;
	fail: (id: string, error: string) => void;
	/** FR-092: cancelled uploads never create nodes when they later resolve. */
	cancel: (id: string) => void;
	isCancelled: (id: string) => boolean;
	clearFinished: () => void;
}

export type UploadStoreApi = StoreApi<UploadState>;

let uploadTaskCounter = 0;

export function createUploadStore(): UploadStoreApi {
	return createStore<UploadState>()((set, get) => ({
		tasks: [],
		begin(fileName) {
			const id = `upload-${++uploadTaskCounter}`;
			set((s) => ({
				tasks: [...s.tasks, { id, fileName, status: "uploading" as const }],
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
		clearFinished() {
			set((s) => ({
				tasks: s.tasks.filter((task) => task.status === "uploading"),
			}));
		},
	}));
}
