import {
	applyCommand,
	type CanvasBatchCommand,
	type CanvasCommand,
	type CanvasIR,
	type CommandApplyOptions,
} from "@anvilkit/canvas-core";
import { createStore, type StoreApi } from "zustand/vanilla";

export const DEFAULT_HISTORY_LIMIT = 100;
const DEFAULT_MERGE_WINDOW_MS = 400;

export interface CreateHistoryStoreOptions {
	/**
	 * Maximum number of inverse commands kept in `past`. When exceeded, the
	 * oldest entry is dropped. `future` is bounded by `past` (it can never be
	 * longer than the most recent run of undos), so a single `limit` suffices.
	 */
	limit?: number;
	/** Optional deterministic clock plumbed into every applyCommand call. */
	now?: () => string;
	/**
	 * Time window (ms) within which a `commitCoalesced` call sharing the previous
	 * call's merge key folds into the same undo entry. Default 400.
	 */
	mergeWindowMs?: number;
	/** Injectable millisecond clock for coalescing (default `Date.now`). */
	nowMs?: () => number;
}

export interface HistoryState {
	past: CanvasCommand[];
	future: CanvasCommand[];
	limit: number;
	commit: (ir: CanvasIR, cmd: CanvasCommand) => CanvasIR;
	/**
	 * Apply many commands as ONE undo entry (a composite `batch` inverse). An
	 * empty `commands` array is a no-op and records nothing.
	 */
	commitBatch: (
		ir: CanvasIR,
		commands: readonly CanvasCommand[],
		label?: string,
	) => CanvasIR;
	/**
	 * Apply a command, folding it into the previous undo entry when it shares
	 * `mergeKey` with the prior commit within the merge window (e.g. a drag or a
	 * held arrow key). Intended for single-target edits whose inverse restores an
	 * absolute value (move/rotate/resize/update) — not for structural commands.
	 */
	commitCoalesced: (
		ir: CanvasIR,
		cmd: CanvasCommand,
		mergeKey: string,
	) => CanvasIR;
	undo: (ir: CanvasIR) => CanvasIR;
	redo: (ir: CanvasIR) => CanvasIR;
	reset: () => void;
	canUndo: () => boolean;
	canRedo: () => boolean;
}

export type HistoryStoreApi = StoreApi<HistoryState>;

export function createHistoryStore(
	options: CreateHistoryStoreOptions = {},
): HistoryStoreApi {
	const limit = options.limit ?? DEFAULT_HISTORY_LIMIT;
	const mergeWindowMs = options.mergeWindowMs ?? DEFAULT_MERGE_WINDOW_MS;
	const nowMs = options.nowMs ?? (() => Date.now());
	const applyOptions: CommandApplyOptions = options.now
		? { now: options.now }
		: {};

	// Coalescing run state — not reactive, so it lives in the closure rather than
	// the store. Any non-coalesced action (commit/batch/undo/redo/reset) ends a run.
	let lastMergeKey: string | null = null;
	let lastMergeTime = 0;

	return createStore<HistoryState>()((set, get) => ({
		past: [],
		future: [],
		limit,
		commit(ir, cmd) {
			lastMergeKey = null;
			const result = applyCommand(ir, cmd, applyOptions);
			set((state) => {
				const past = [...state.past, result.inverse];
				while (past.length > state.limit) {
					past.shift();
				}
				return { past, future: [] };
			});
			return result.ir;
		},
		commitBatch(ir, commands, label) {
			if (commands.length === 0) return ir;
			lastMergeKey = null;
			const batch: CanvasBatchCommand = {
				type: "batch",
				...(label !== undefined ? { label } : {}),
				commands: [...commands],
			};
			const result = applyCommand(ir, batch, applyOptions);
			set((state) => {
				const past = [...state.past, result.inverse];
				while (past.length > state.limit) {
					past.shift();
				}
				return { past, future: [] };
			});
			return result.ir;
		},
		commitCoalesced(ir, cmd, mergeKey) {
			const result = applyCommand(ir, cmd, applyOptions);
			const t = nowMs();
			const merge =
				lastMergeKey === mergeKey &&
				t - lastMergeTime <= mergeWindowMs &&
				get().past.length > 0 &&
				get().future.length === 0;
			lastMergeKey = mergeKey;
			lastMergeTime = t;
			if (merge) {
				// Keep the existing top inverse: for absolute-restoring commands it
				// already returns the node to the pre-burst state, so the whole run
				// collapses to a single undo step. Redo re-derives correctly because
				// each inverse is recomputed from the live state at undo time.
				return result.ir;
			}
			set((state) => {
				const past = [...state.past, result.inverse];
				while (past.length > state.limit) {
					past.shift();
				}
				return { past, future: [] };
			});
			return result.ir;
		},
		undo(ir) {
			lastMergeKey = null;
			const state = get();
			if (state.past.length === 0) return ir;
			const inverseCmd = state.past[state.past.length - 1];
			if (!inverseCmd) return ir;
			const result = applyCommand(ir, inverseCmd, applyOptions);
			set((s) => ({
				past: s.past.slice(0, -1),
				future: [...s.future, result.inverse],
			}));
			return result.ir;
		},
		redo(ir) {
			lastMergeKey = null;
			const state = get();
			if (state.future.length === 0) return ir;
			const forwardCmd = state.future[state.future.length - 1];
			if (!forwardCmd) return ir;
			const result = applyCommand(ir, forwardCmd, applyOptions);
			set((s) => {
				const past = [...s.past, result.inverse];
				while (past.length > s.limit) {
					past.shift();
				}
				return {
					past,
					future: s.future.slice(0, -1),
				};
			});
			return result.ir;
		},
		reset() {
			lastMergeKey = null;
			lastMergeTime = 0;
			set({ past: [], future: [] });
		},
		canUndo() {
			return get().past.length > 0;
		},
		canRedo() {
			return get().future.length > 0;
		},
	}));
}
