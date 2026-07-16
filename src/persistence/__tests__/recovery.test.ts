import { createCanvasIR, createPage } from "@anvilkit/canvas-core";
import { describe, expect, it, vi } from "vitest";
import { createHistoryStore } from "@/stores/history-store.js";
import { createSaveStatusStore } from "@/stores/save-status-store.js";
import {
	type CanvasRecoveryAdapter,
	type CanvasRecoverySnapshot,
	createRecoveryController,
} from "../recovery.js";

const FIXED_TS = "2026-07-15T00:00:00.000Z";

function makeIR() {
	return createCanvasIR({
		id: "doc-1",
		pages: [createPage({ id: "p1" })],
		now: () => FIXED_TS,
	});
}

function memoryAdapter() {
	const store = new Map<string, CanvasRecoverySnapshot>();
	const adapter: CanvasRecoveryAdapter = {
		write: (snapshot) => {
			store.set(snapshot.documentId, snapshot);
			return Promise.resolve();
		},
		read: (id) => Promise.resolve(store.get(id) ?? null),
		clear: (id) => {
			store.delete(id);
			return Promise.resolve();
		},
	};
	return { adapter, store };
}

/** Manual timer harness: capture the debounce callback, fire on demand. */
function manualTimers() {
	const pending: Array<() => void> = [];
	const setTimeoutFn = ((cb: () => void) => {
		pending.push(cb);
		return pending.length as unknown as ReturnType<typeof setTimeout>;
	}) as typeof setTimeout;
	const clearTimeoutFn = (() => {
		// The controller replaces the pending callback on every change; the
		// harness just keeps the latest.
		pending.length = 0;
	}) as typeof clearTimeout;
	return {
		pending,
		setTimeoutFn,
		clearTimeoutFn,
		flush: () => pending.splice(0).forEach((cb) => cb()),
	};
}

describe("createRecoveryController (C-10, FR-164)", () => {
	it("writes a debounced snapshot after a history change", () => {
		const { adapter, store } = memoryAdapter();
		const history = createHistoryStore();
		const ir = makeIR();
		const timers = manualTimers();
		createRecoveryController({
			adapter,
			getIR: () => ir,
			historyStore: history,
			now: () => FIXED_TS,
			setTimeoutFn: timers.setTimeoutFn,
			clearTimeoutFn: timers.clearTimeoutFn,
		});
		history.getState().commit(ir, {
			type: "page.rename",
			pageId: "p1",
			from: undefined,
			to: "Renamed",
		} as never);
		expect(store.size).toBe(0); // debounced, not yet written
		timers.flush();
		expect(store.get("doc-1")).toMatchObject({
			documentId: "doc-1",
			savedAt: FIXED_TS,
		});
	});

	it("clears the snapshot when a save succeeds and stops after dispose", () => {
		const { adapter, store } = memoryAdapter();
		const history = createHistoryStore();
		const status = createSaveStatusStore();
		const ir = makeIR();
		const timers = manualTimers();
		const controller = createRecoveryController({
			adapter,
			getIR: () => ir,
			historyStore: history,
			saveStatusStore: status,
			now: () => FIXED_TS,
			setTimeoutFn: timers.setTimeoutFn,
			clearTimeoutFn: timers.clearTimeoutFn,
		});
		store.set("doc-1", {
			documentId: "doc-1",
			ir,
			revision: 1,
			savedAt: FIXED_TS,
		});
		status.getState().recordSaved(FIXED_TS);
		expect(store.has("doc-1")).toBe(false);

		controller.dispose();
		history.getState().commit(ir, {
			type: "page.rename",
			pageId: "p1",
			from: undefined,
			to: "Again",
		} as never);
		timers.flush();
		expect(store.size).toBe(0);
	});

	it("adapter failures are swallowed (best-effort)", () => {
		const history = createHistoryStore();
		const ir = makeIR();
		const timers = manualTimers();
		const failing: CanvasRecoveryAdapter = {
			write: vi.fn(() => Promise.reject(new Error("quota"))),
			read: () => Promise.resolve(null),
			clear: () => Promise.reject(new Error("quota")),
		};
		createRecoveryController({
			adapter: failing,
			getIR: () => ir,
			historyStore: history,
			setTimeoutFn: timers.setTimeoutFn,
			clearTimeoutFn: timers.clearTimeoutFn,
		});
		history.getState().commit(ir, {
			type: "page.rename",
			pageId: "p1",
			from: undefined,
			to: "Again",
		} as never);
		expect(() => timers.flush()).not.toThrow();
		expect(failing.write).toHaveBeenCalled();
	});
});
