import type { CanvasAiPlaceholderStatus } from "@anvilkit/canvas-core";
import { createStore, type StoreApi } from "zustand/vanilla";

/**
 * I1-10 transient registry for in-flight AI jobs that back an `ai-placeholder`
 * node on the canvas. The editor never runs jobs (the host does, via
 * `requestAiIntent`); it only needs a place to (a) reflect a job's status and
 * (b) reach the host's abort handle so a placeholder's on-canvas Cancel button
 * can stop it. The `AbortController` lives with whoever runs the job (the host);
 * here we hold only an `abort()` closure registered when the job starts.
 *
 * Purely ephemeral — never serialized into the IR (the placeholder node carries
 * the serializable `jobId`/`status`; this store carries the live cancel handle).
 */
export interface AiJobEntry {
	/** Correlation id shared with the placeholder node's `jobId`. */
	jobId: string;
	/** Id of the `ai-placeholder` node this job backs. */
	nodeId: string;
	status: CanvasAiPlaceholderStatus | "cancelled";
	/** Host-supplied abort handle (e.g. `() => controller.abort()`). */
	abort: () => void;
}

export interface AiJobRegistration {
	nodeId: string;
	abort: () => void;
}

export interface AiJobState {
	jobs: Record<string, AiJobEntry>;
	/** Register a job the host just started (status begins `"pending"`). */
	register: (jobId: string, registration: AiJobRegistration) => void;
	/** Cancel a pending job: fire its `abort` once and flip status to cancelled. */
	cancel: (jobId: string) => void;
	/** Drop a settled job from the registry (host calls on completion/error). */
	complete: (jobId: string) => void;
	get: (jobId: string) => AiJobEntry | undefined;
	/**
	 * Abort every still-pending job and clear the registry (P0-9). Used by
	 * `replaceDocumentSnapshot` when a document snapshot replacement may drop
	 * the `ai-placeholder` nodes these jobs back — an orphaned job left
	 * registered would have a live abort handle for a node the canvas no
	 * longer has.
	 */
	reset: () => void;
}

export type AiJobStoreApi = StoreApi<AiJobState>;

export function createAiJobStore(): AiJobStoreApi {
	return createStore<AiJobState>()((set, getState) => ({
		jobs: {},
		register(jobId, registration) {
			set((state) => ({
				jobs: {
					...state.jobs,
					[jobId]: {
						jobId,
						nodeId: registration.nodeId,
						status: "pending",
						abort: registration.abort,
					},
				},
			}));
		},
		cancel(jobId) {
			const entry = getState().jobs[jobId];
			// Only a still-pending job is cancellable; cancelling a settled or
			// already-cancelled job is a no-op so `abort` never fires twice.
			if (!entry || entry.status !== "pending") {
				return;
			}
			entry.abort();
			set((state) => ({
				jobs: {
					...state.jobs,
					[jobId]: { ...entry, status: "cancelled" },
				},
			}));
		},
		complete(jobId) {
			set((state) => {
				if (!(jobId in state.jobs)) {
					return state;
				}
				const { [jobId]: _removed, ...rest } = state.jobs;
				return { jobs: rest };
			});
		},
		get(jobId) {
			return getState().jobs[jobId];
		},
		reset() {
			for (const entry of Object.values(getState().jobs)) {
				if (entry.status === "pending") entry.abort();
			}
			set({ jobs: {} });
		},
	}));
}
