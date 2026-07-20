import type { CanvasIR } from "@anvilkit/canvas-core";
import type { HistoryStoreApi } from "../stores/history-store.js";
import type {
	CanvasSaveState,
	SaveStatusStoreApi,
} from "../stores/save-status-store.js";
import {
	type CanvasAutoSaveOptions,
	type CanvasPersistenceAdapter,
	DEFAULT_AUTO_SAVE,
} from "./types.js";

export interface CreateSaveControllerOptions {
	adapter: CanvasPersistenceAdapter;
	getIR: () => CanvasIR;
	historyStore: HistoryStoreApi;
	saveStatusStore: SaveStatusStoreApi;
	/** `false` disables auto-save (manual `save()`/`flush()` still work). */
	autoSave?: boolean | CanvasAutoSaveOptions;
	onSaveStateChange?: (state: CanvasSaveState) => void;
	/** Injectable clocks/timers for tests. */
	now?: () => string;
	setTimeoutFn?: typeof setTimeout;
	clearTimeoutFn?: typeof clearTimeout;
	/** Injectable online probe (default `navigator.onLine`, true when absent). */
	isOnline?: () => boolean;
}

export interface SaveController {
	/** Manual save (FR-160). Resolves when THIS attempt settles. */
	save(): Promise<boolean>;
	/**
	 * Save immediately when dirty (unmount/route-leave flush). The save this
	 * starts is protected: a subsequent `dispose()` does NOT abort it, so the
	 * standard `flush(); dispose();` teardown cannot cancel its own final
	 * save. Hosts that need certainty should `await` the returned promise
	 * before tearing down their route.
	 */
	flush(): Promise<boolean>;
	/** FR-163: safe to leave = not dirty and nothing in flight. */
	canLeave(): boolean;
	/**
	 * Stops timers, unsubscribes, and aborts obsolete in-flight saves.
	 * Flush-initiated saves are exempt (see {@link SaveController.flush}).
	 */
	dispose(): void;
}

/**
 * FR-160/161/162 save orchestration (B-08). Subscribes to the history store's
 * state identity: any change away from the save checkpoint marks the document
 * dirty and (when enabled) schedules a debounced auto-save with a max-wait
 * ceiling; failures retry with exponential backoff; responses that lose a
 * race checkpoint the revision they actually saved so a stale success never
 * marks a newer state clean. Undoing back to the checkpoint returns the
 * status to clean without touching the adapter.
 */
export function createSaveController(
	options: CreateSaveControllerOptions,
): SaveController {
	const auto =
		options.autoSave === false
			? null
			: {
					...DEFAULT_AUTO_SAVE,
					...(options.autoSave === true ? {} : options.autoSave),
				};
	const now = options.now ?? (() => new Date().toISOString());
	const setT = options.setTimeoutFn ?? setTimeout;
	const clearT = options.clearTimeoutFn ?? clearTimeout;
	const isOnline =
		options.isOnline ??
		(() => typeof navigator === "undefined" || navigator.onLine !== false);
	const status = options.saveStatusStore;
	const history = options.historyStore;

	let disposed = false;
	let saveSeq = 0;
	let lastCheckpointed = -1;
	let inFlight = 0;
	let retryCount = 0;
	let debounceTimer: ReturnType<typeof setTimeout> | null = null;
	let maxWaitTimer: ReturnType<typeof setTimeout> | null = null;
	let retryTimer: ReturnType<typeof setTimeout> | null = null;
	// FR-162: every in-flight save's controller, so `dispose()` can abort
	// whichever ones haven't settled yet — plural because overlapping saves
	// (a new commit while one is already in flight) are already a normal,
	// supported case here (see the `seq`/`saveSeq` staleness guard below).
	// Flush-initiated saves are deliberately NOT tracked here (FR-160): a
	// flush means "this snapshot must reach the adapter", and the standard
	// unmount sequence is `flush()` immediately followed by `dispose()` — the
	// disposal must not abort the final flush it was paired with.
	const inFlightAbortControllers = new Set<AbortController>();

	const clearTimers = (): void => {
		if (debounceTimer !== null) clearT(debounceTimer);
		if (maxWaitTimer !== null) clearT(maxWaitTimer);
		if (retryTimer !== null) clearT(retryTimer);
		debounceTimer = null;
		maxWaitTimer = null;
		retryTimer = null;
	};

	const emit = (): void => {
		options.onSaveStateChange?.(status.getState().status);
	};

	const performSave = async (options2?: {
		/**
		 * FR-160: a protected (flush-initiated) save survives `dispose()` — its
		 * signal is never aborted by teardown, so `flush(); dispose();` cannot
		 * cancel the very save it just started.
		 */
		protected?: boolean;
	}): Promise<boolean> => {
		if (disposed) return false;
		if (!isOnline()) {
			status.getState().setStatus("offline");
			emit();
			return false;
		}
		const seq = ++saveSeq;
		const revision = history.getState().getStateId();
		const ir = options.getIR();
		inFlight += 1;
		const abortController = new AbortController();
		if (!options2?.protected) inFlightAbortControllers.add(abortController);
		status.getState().setStatus("saving");
		emit();
		try {
			const result = await options.adapter.save({
				ir,
				documentId: ir.id,
				revision,
				signal: abortController.signal,
			});
			if (disposed) return true;
			// Checkpoint the revision that was ACTUALLY persisted — but only ever
			// FORWARD: a slow response for an old snapshot must not move the
			// checkpoint back past a newer completed save (stale-response guard).
			if (revision > lastCheckpointed) {
				history.getState().markSaveCheckpoint(revision);
				lastCheckpointed = revision;
			}
			retryCount = 0;
			if (seq === saveSeq) {
				if (history.getState().isAtSaveCheckpoint()) {
					status.getState().recordSaved(result.savedAt ?? now());
				} else {
					status.getState().setStatus("dirty");
				}
				emit();
			}
			return true;
		} catch (err) {
			if (disposed) return false;
			if (seq === saveSeq) {
				status
					.getState()
					.recordError(err instanceof Error ? err.message : String(err));
				emit();
				if (auto && retryCount < auto.maxRetries) {
					const delay = auto.retryBaseMs * 2 ** retryCount;
					retryCount += 1;
					retryTimer = setT(() => {
						retryTimer = null;
						void performSave();
					}, delay);
				}
			}
			return false;
		} finally {
			inFlight -= 1;
			inFlightAbortControllers.delete(abortController);
		}
	};

	const scheduleAutoSave = (): void => {
		if (!auto || disposed) return;
		if (debounceTimer !== null) clearT(debounceTimer);
		debounceTimer = setT(() => {
			debounceTimer = null;
			if (maxWaitTimer !== null) {
				clearT(maxWaitTimer);
				maxWaitTimer = null;
			}
			void performSave();
		}, auto.debounceMs);
		if (maxWaitTimer === null) {
			maxWaitTimer = setT(() => {
				maxWaitTimer = null;
				if (debounceTimer !== null) {
					clearT(debounceTimer);
					debounceTimer = null;
				}
				void performSave();
			}, auto.maxWaitMs);
		}
	};

	const onHistoryChange = (): void => {
		if (disposed) return;
		const h = history.getState();
		if (h.isAtSaveCheckpoint()) {
			// Undo-to-clean (FR-161): back at the saved state — cancel pending
			// auto-saves and report clean/saved.
			//
			// Also advance the stale-response floor to the CURRENT state id.
			// `replaceDocumentSnapshot` resets the history store to a fresh,
			// clean checkpoint whose id is larger than every pre-replacement
			// revision; without this, a slow success for a pre-replacement save
			// would pass the forward-only guard below and re-dirty the freshly
			// replaced document by moving its checkpoint to a stale revision.
			lastCheckpointed = Math.max(lastCheckpointed, h.getStateId());
			clearTimers();
			retryCount = 0;
			const current = status.getState().status;
			if (current !== "saving") {
				status
					.getState()
					.setStatus(status.getState().lastSavedAt ? "saved" : "clean");
				emit();
			}
			return;
		}
		if (status.getState().status !== "saving") {
			status.getState().setStatus("dirty");
			emit();
		}
		scheduleAutoSave();
	};

	const unsubscribe = history.subscribe(onHistoryChange);

	return {
		save: () => {
			clearTimers();
			return performSave();
		},
		flush: () => {
			clearTimers();
			if (history.getState().isAtSaveCheckpoint() && inFlight === 0) {
				return Promise.resolve(true);
			}
			return performSave({ protected: true });
		},
		canLeave: () => history.getState().isAtSaveCheckpoint() && inFlight === 0,
		dispose: () => {
			disposed = true;
			clearTimers();
			// FR-162: abort every save still in flight — previously only pending
			// TIMERS were cancelled; an in-flight `adapter.save()` call ran to
			// completion for nothing.
			for (const controller of inFlightAbortControllers) controller.abort();
			inFlightAbortControllers.clear();
			unsubscribe();
		},
	};
}
