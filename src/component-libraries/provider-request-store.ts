import { createStore, type StoreApi } from "zustand/vanilla";

import type {
	CanvasComponentCatalogEntry,
	CanvasComponentProvider,
	CanvasComponentSearchQuery,
} from "./component-provider.js";
import {
	type CanvasProviderRequestStatus,
	classifyProviderError,
	isAbortRejection,
} from "./provider-errors.js";

/**
 * @file Provider search state with cancellation (plan 0021 T-019, TD 0016 §7.3).
 *
 * ## The bug this store exists to prevent
 *
 * Library search is typed into. Keystrokes produce overlapping requests, and
 * network latency does not respect their order — so a slow response to "b" can
 * land *after* a fast response to "button" and repaint the panel with results
 * for a query the user has already moved past. Two independent guards:
 *
 * 1. **Abort**: issuing a query aborts the previous request's `AbortController`,
 *    so the host can stop work it no longer needs.
 * 2. **Request-id match**: a response is applied only if its id is still the
 *    current one. Abort alone is not sufficient — an in-flight response may
 *    already be resolving when the abort fires, and a host is free to ignore
 *    the signal entirely.
 *
 * The second guard is the load-bearing one. The test that matters resolves the
 * superseded request LAST and asserts its results never appear.
 */

export interface CanvasProviderRequestState {
	readonly status: CanvasProviderRequestStatus;
	readonly entries: readonly CanvasComponentCatalogEntry[];
	/** Cursor for the next page, when the provider reported one. */
	readonly nextCursor: string | undefined;
	readonly total: number | undefined;
	/** The query the current `entries` belong to. */
	readonly query: CanvasComponentSearchQuery;
	/** True while a `loadMore` is in flight, so the list can stay rendered. */
	readonly loadingMore: boolean;

	/** Run a fresh search, replacing any in-flight one. */
	search(
		provider: CanvasComponentProvider,
		query: CanvasComponentSearchQuery,
	): Promise<void>;
	/** Append the next page of the CURRENT query. No-op without a cursor. */
	loadMore(provider: CanvasComponentProvider): Promise<void>;
	/** Abort anything in flight and return to `idle`. */
	reset(): void;
}

export type CanvasProviderRequestStoreApi =
	StoreApi<CanvasProviderRequestState>;

export function createProviderRequestStore(): CanvasProviderRequestStoreApi {
	// Request identity and the live controller are module-local rather than
	// store state: they are not rendered, and putting them in the store would
	// make every keystroke publish a state change no subscriber cares about.
	let requestSeq = 0;
	let currentRequestId = 0;
	let controller: AbortController | undefined;

	const beginRequest = (): { id: number; signal: AbortSignal } => {
		controller?.abort();
		controller = new AbortController();
		requestSeq += 1;
		currentRequestId = requestSeq;
		return { id: requestSeq, signal: controller.signal };
	};

	return createStore<CanvasProviderRequestState>()((set, get) => ({
		status: "idle",
		entries: [],
		nextCursor: undefined,
		total: undefined,
		query: {},
		loadingMore: false,

		async search(provider, query) {
			const { id, signal } = beginRequest();
			set({ status: "loading", query, loadingMore: false });

			try {
				const result = await provider.search(query, { signal });
				// Superseded while in flight: drop it silently. Not an error — the
				// user simply typed another character.
				if (id !== currentRequestId) return;
				set({
					status: result.entries.length === 0 ? "empty" : "ready",
					entries: result.entries,
					nextCursor: result.nextCursor,
					total: result.total,
				});
			} catch (error) {
				if (id !== currentRequestId) return;
				// An abort is the user moving on, never a visible failure.
				if (isAbortRejection(error)) return;
				set({
					status: classifyProviderError(error),
					entries: [],
					nextCursor: undefined,
					total: undefined,
				});
			}
		},

		async loadMore(provider) {
			const { nextCursor, query, entries, loadingMore } = get();
			if (nextCursor === undefined || loadingMore) return;

			const { id, signal } = beginRequest();
			set({ loadingMore: true });
			try {
				const result = await provider.search(
					{ ...query, cursor: nextCursor },
					{ signal },
				);
				if (id !== currentRequestId) return;
				set({
					status: "ready",
					// Append, never replace: pagination extends the list the user is
					// already looking at.
					entries: [...entries, ...result.entries],
					nextCursor: result.nextCursor,
					total: result.total ?? get().total,
					loadingMore: false,
				});
			} catch (error) {
				if (id !== currentRequestId) return;
				if (isAbortRejection(error)) {
					set({ loadingMore: false });
					return;
				}
				// A failed page keeps the results already on screen — dropping them
				// would punish the user for scrolling.
				set({ status: classifyProviderError(error), loadingMore: false });
			}
		},

		reset() {
			controller?.abort();
			controller = undefined;
			// Bump the id so any response still in flight fails its identity check.
			requestSeq += 1;
			currentRequestId = requestSeq;
			set({
				status: "idle",
				entries: [],
				nextCursor: undefined,
				total: undefined,
				query: {},
				loadingMore: false,
			});
		},
	}));
}
