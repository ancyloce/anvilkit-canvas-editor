import {
	type CanvasIR,
	createCanvasIR,
	createGroup,
	createPage,
	createRect,
} from "@anvilkit/canvas-core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createHistoryStore } from "@/stores/history-store.js";
import { createSaveStatusStore } from "@/stores/save-status-store.js";
import { createSaveController } from "../save-controller.js";
import type { CanvasSaveInput, CanvasSaveResult } from "../types.js";

const FIXED_TS = "2026-05-20T00:00:00.000Z";

function fixtureIR(): CanvasIR {
	const page = createPage({ id: "p1" });
	page.root = createGroup({
		id: "root",
		bounds: page.root.bounds,
		children: [
			createRect({
				id: "a",
				transform: { x: 0 },
				bounds: { width: 10, height: 10 },
			}),
		],
	});
	return createCanvasIR({ id: "doc-1", pages: [page], now: () => FIXED_TS });
}

function harness(
	overrides: {
		save?: (input: CanvasSaveInput) => Promise<CanvasSaveResult>;
		autoSave?:
			| boolean
			| {
					debounceMs?: number;
					maxWaitMs?: number;
					maxRetries?: number;
					retryBaseMs?: number;
			  };
		isOnline?: () => boolean;
	} = {},
) {
	let ir = fixtureIR();
	const historyStore = createHistoryStore({ now: () => FIXED_TS });
	const saveStatusStore = createSaveStatusStore();
	const calls: CanvasSaveInput[] = [];
	const adapter = {
		save:
			overrides.save ??
			(async (input: CanvasSaveInput) => {
				calls.push(input);
				return { savedAt: FIXED_TS };
			}),
	};
	const states: string[] = [];
	const controller = createSaveController({
		adapter,
		getIR: () => ir,
		historyStore,
		saveStatusStore,
		autoSave: overrides.autoSave ?? {
			debounceMs: 100,
			maxWaitMs: 500,
			maxRetries: 2,
			retryBaseMs: 50,
		},
		onSaveStateChange: (s) => states.push(s),
		now: () => FIXED_TS,
		...(overrides.isOnline ? { isOnline: overrides.isOnline } : {}),
	});
	const edit = (x: number): void => {
		ir = historyStore.getState().commit(ir, {
			type: "node.move",
			nodeId: "a",
			from: { x: 0, y: 0 },
			to: { x, y: 0 },
		});
	};
	const undo = (): void => {
		ir = historyStore.getState().undo(ir);
	};
	return {
		historyStore,
		saveStatusStore,
		controller,
		calls,
		states,
		edit,
		undo,
	};
}

beforeEach(() => {
	vi.useFakeTimers();
});

afterEach(() => {
	vi.useRealTimers();
});

describe("history checkpoint (FR-161)", () => {
	it("commit dirties; undo back to the checkpoint is clean again", () => {
		const h = harness({ autoSave: false });
		expect(h.historyStore.getState().isAtSaveCheckpoint()).toBe(true);
		h.edit(10);
		expect(h.historyStore.getState().isAtSaveCheckpoint()).toBe(false);
		expect(h.saveStatusStore.getState().status).toBe("dirty");
		h.undo();
		expect(h.historyStore.getState().isAtSaveCheckpoint()).toBe(true);
		expect(h.saveStatusStore.getState().status).toBe("clean");
		h.controller.dispose();
	});

	it("canLeave tracks the checkpoint", () => {
		const h = harness({ autoSave: false });
		expect(h.controller.canLeave()).toBe(true);
		h.edit(5);
		expect(h.controller.canLeave()).toBe(false);
		h.controller.dispose();
	});
});

describe("manual save + auto save (FR-160/162)", () => {
	it("manual save checkpoints and reports saved", async () => {
		const h = harness({ autoSave: false });
		h.edit(10);
		const ok = await h.controller.save();
		expect(ok).toBe(true);
		expect(h.calls).toHaveLength(1);
		expect(h.calls[0]?.documentId).toBe("doc-1");
		expect(h.saveStatusStore.getState().status).toBe("saved");
		expect(h.controller.canLeave()).toBe(true);
		h.controller.dispose();
	});

	it("auto-save debounces: rapid edits collapse into one save", async () => {
		const h = harness();
		h.edit(1);
		await vi.advanceTimersByTimeAsync(50);
		h.edit(2);
		await vi.advanceTimersByTimeAsync(50);
		h.edit(3);
		expect(h.calls).toHaveLength(0);
		await vi.advanceTimersByTimeAsync(100);
		expect(h.calls).toHaveLength(1);
		expect(h.saveStatusStore.getState().status).toBe("saved");
		h.controller.dispose();
	});

	it("maxWait forces a save under continuous editing", async () => {
		const h = harness();
		for (let i = 0; i < 8; i++) {
			h.edit(i);
			await vi.advanceTimersByTimeAsync(80); // always inside the debounce
		}
		// 8 × 80ms = 640ms > maxWait 500ms → at least one forced save.
		expect(h.calls.length).toBeGreaterThanOrEqual(1);
		h.controller.dispose();
	});

	it("failed saves retry with exponential backoff and recover", async () => {
		let failures = 2;
		const inputs: CanvasSaveInput[] = [];
		const h = harness({
			save: async (input) => {
				inputs.push(input);
				if (failures > 0) {
					failures -= 1;
					throw new Error("boom");
				}
				return { savedAt: FIXED_TS };
			},
		});
		h.edit(1);
		await vi.advanceTimersByTimeAsync(100); // debounce → attempt 1 fails
		expect(h.saveStatusStore.getState().status).toBe("error");
		await vi.advanceTimersByTimeAsync(50); // retry 1 (base) fails
		await vi.advanceTimersByTimeAsync(100); // retry 2 (2×base) succeeds
		expect(inputs).toHaveLength(3);
		expect(h.saveStatusStore.getState().status).toBe("saved");
		h.controller.dispose();
	});

	it("offline reports offline and calls no adapter", async () => {
		const h = harness({ isOnline: () => false });
		h.edit(1);
		await vi.advanceTimersByTimeAsync(200);
		expect(h.calls).toHaveLength(0);
		expect(h.saveStatusStore.getState().status).toBe("offline");
		h.controller.dispose();
	});

	it("a stale slow response never moves the checkpoint backward", async () => {
		const resolvers: Array<(r: CanvasSaveResult) => void> = [];
		const h = harness({
			autoSave: false,
			save: () =>
				new Promise<CanvasSaveResult>((resolve) => {
					resolvers.push(resolve);
				}),
		});
		h.edit(1);
		const first = h.controller.save(); // snapshot rev A, stays pending
		h.edit(2);
		const second = h.controller.save(); // snapshot rev B
		resolvers[1]?.({ savedAt: FIXED_TS }); // B completes first
		await second;
		expect(h.saveStatusStore.getState().status).toBe("saved");
		expect(h.historyStore.getState().isAtSaveCheckpoint()).toBe(true);
		resolvers[0]?.({ savedAt: FIXED_TS }); // stale A completes late
		await first;
		// Checkpoint stayed at B — the document is still clean.
		expect(h.historyStore.getState().isAtSaveCheckpoint()).toBe(true);
		h.controller.dispose();
	});

	it("flush resolves immediately when clean and saves when dirty", async () => {
		const h = harness({ autoSave: false });
		await expect(h.controller.flush()).resolves.toBe(true);
		expect(h.calls).toHaveLength(0);
		h.edit(4);
		await expect(h.controller.flush()).resolves.toBe(true);
		expect(h.calls).toHaveLength(1);
		h.controller.dispose();
	});

	it("dispose cancels pending auto-saves", async () => {
		const h = harness();
		h.edit(1);
		h.controller.dispose();
		await vi.advanceTimersByTimeAsync(1000);
		expect(h.calls).toHaveLength(0);
	});

	it("adapter.save() receives a real, not-yet-aborted AbortSignal (FR-162)", async () => {
		const h = harness({ autoSave: false });
		h.edit(1);
		await h.controller.save();
		expect(h.calls[0]?.signal).toBeInstanceOf(AbortSignal);
		expect(h.calls[0]?.signal.aborted).toBe(false);
		h.controller.dispose();
	});

	it("dispose aborts an in-flight save's signal — timers alone used to miss this (FR-162)", async () => {
		let capturedSignal: AbortSignal | undefined;
		let resolveSave: (() => void) | null = null;
		const h = harness({
			autoSave: false,
			save: (input) =>
				new Promise((resolve) => {
					capturedSignal = input.signal;
					resolveSave = () => resolve({ savedAt: FIXED_TS });
				}),
		});
		h.edit(1);
		const pending = h.controller.save();
		expect(capturedSignal?.aborted).toBe(false);

		h.controller.dispose();

		expect(capturedSignal?.aborted).toBe(true);
		resolveSave?.();
		await pending;
	});

	it("dispose aborts EVERY overlapping in-flight save, not just the latest", async () => {
		const signals: AbortSignal[] = [];
		const h = harness({
			autoSave: false,
			save: (input) =>
				new Promise(() => {
					signals.push(input.signal);
				}),
		});
		h.edit(1);
		void h.controller.save(); // rev A, stays pending
		h.edit(2);
		void h.controller.save(); // rev B, also stays pending
		expect(signals).toHaveLength(2);

		h.controller.dispose();

		expect(signals.every((s) => s.aborted)).toBe(true);
	});
});

describe("unmount flush protection (FR-160)", () => {
	it("dispose immediately after flush() does NOT abort that flush's save", async () => {
		let capturedSignal: AbortSignal | undefined;
		let resolveSave: (() => void) | null = null;
		const h = harness({
			autoSave: false,
			save: (input) =>
				new Promise((resolve) => {
					capturedSignal = input.signal;
					resolveSave = () => resolve({ savedAt: FIXED_TS });
				}),
		});
		h.edit(1);
		// The standard React cleanup sequence: flush, then dispose in the same tick.
		const pending = h.controller.flush();
		h.controller.dispose();

		expect(capturedSignal).toBeInstanceOf(AbortSignal);
		expect(capturedSignal?.aborted).toBe(false);

		resolveSave?.();
		await expect(pending).resolves.toBe(true);
	});

	it("dispose still aborts a plain in-flight save while the flush save survives", async () => {
		const signals: AbortSignal[] = [];
		const h = harness({
			autoSave: false,
			save: (input) =>
				new Promise(() => {
					signals.push(input.signal);
				}),
		});
		h.edit(1);
		void h.controller.save(); // obsolete manual save, stays pending
		h.edit(2);
		void h.controller.flush(); // final flush, stays pending
		expect(signals).toHaveLength(2);

		h.controller.dispose();

		expect(signals[0]?.aborted).toBe(true);
		expect(signals[1]?.aborted).toBe(false);
	});

	it("a stale success arriving after a history reset (document replacement) cannot re-dirty the fresh document", async () => {
		let resolveSave: (() => void) | null = null;
		const h = harness({
			autoSave: false,
			save: () =>
				new Promise((resolve) => {
					resolveSave = () => resolve({ savedAt: FIXED_TS });
				}),
		});
		h.edit(1);
		const pending = h.controller.save(); // in flight for the pre-reset revision

		// Document replacement resets the history store to a fresh clean checkpoint.
		h.historyStore.getState().reset();
		expect(h.historyStore.getState().isAtSaveCheckpoint()).toBe(true);

		resolveSave?.();
		await pending;

		// The stale response must not move the checkpoint to the pre-reset
		// revision (which would flip the fresh document to dirty).
		expect(h.historyStore.getState().isAtSaveCheckpoint()).toBe(true);
		expect(h.saveStatusStore.getState().status).not.toBe("dirty");
		h.controller.dispose();
	});
});
