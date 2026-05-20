import {
	applyCommand,
	type CanvasCommand,
	type CanvasIR,
	type CommandApplyOptions,
} from "@anvilkit/canvas-core";
import { createStore, type StoreApi } from "zustand/vanilla";

export const DEFAULT_HISTORY_LIMIT = 100;

export interface CreateHistoryStoreOptions {
	/**
	 * Maximum number of inverse commands kept in `past`. When exceeded, the
	 * oldest entry is dropped. `future` is bounded by `past` (it can never be
	 * longer than the most recent run of undos), so a single `limit` suffices.
	 */
	limit?: number;
	/** Optional deterministic clock plumbed into every applyCommand call. */
	now?: () => string;
}

export interface HistoryState {
	past: CanvasCommand[];
	future: CanvasCommand[];
	limit: number;
	commit: (ir: CanvasIR, cmd: CanvasCommand) => CanvasIR;
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
	const applyOptions: CommandApplyOptions = options.now
		? { now: options.now }
		: {};
	return createStore<HistoryState>()((set, get) => ({
		past: [],
		future: [],
		limit,
		commit(ir, cmd) {
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
		undo(ir) {
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
