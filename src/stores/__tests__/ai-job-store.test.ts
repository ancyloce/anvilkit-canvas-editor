import { describe, expect, it, vi } from "vitest";
import { createAiJobStore } from "../ai-job-store.js";

describe("createAiJobStore", () => {
	it("registers a job as pending and exposes it via get", () => {
		const store = createAiJobStore();
		const abort = vi.fn();
		store.getState().register("job-1", { nodeId: "node-1", abort });

		const entry = store.getState().get("job-1");
		expect(entry).toMatchObject({
			jobId: "job-1",
			nodeId: "node-1",
			status: "pending",
		});
		expect(abort).not.toHaveBeenCalled();
	});

	it("cancel fires abort once and flips status to cancelled", () => {
		const store = createAiJobStore();
		const abort = vi.fn();
		store.getState().register("job-1", { nodeId: "node-1", abort });

		store.getState().cancel("job-1");
		expect(abort).toHaveBeenCalledTimes(1);
		expect(store.getState().get("job-1")?.status).toBe("cancelled");

		// Idempotent — a second cancel does not re-abort a settled job.
		store.getState().cancel("job-1");
		expect(abort).toHaveBeenCalledTimes(1);
	});

	it("cancel on a missing job is a no-op", () => {
		const store = createAiJobStore();
		expect(() => store.getState().cancel("nope")).not.toThrow();
		expect(store.getState().get("nope")).toBeUndefined();
	});

	it("complete drops the entry from the registry", () => {
		const store = createAiJobStore();
		store.getState().register("job-1", { nodeId: "node-1", abort: vi.fn() });
		store.getState().complete("job-1");
		expect(store.getState().get("job-1")).toBeUndefined();
		// Completing an unknown job is a harmless no-op.
		expect(() => store.getState().complete("job-1")).not.toThrow();
	});

	it("keeps multiple jobs independent", () => {
		const store = createAiJobStore();
		const abortA = vi.fn();
		const abortB = vi.fn();
		store.getState().register("a", { nodeId: "na", abort: abortA });
		store.getState().register("b", { nodeId: "nb", abort: abortB });

		store.getState().cancel("a");
		expect(abortA).toHaveBeenCalledTimes(1);
		expect(abortB).not.toHaveBeenCalled();
		expect(store.getState().get("b")?.status).toBe("pending");
	});
});
