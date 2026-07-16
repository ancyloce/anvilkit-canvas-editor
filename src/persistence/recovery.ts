import type { CanvasIR } from "@anvilkit/canvas-core";
import type { HistoryStoreApi } from "../stores/history-store.js";
import type { SaveStatusStoreApi } from "../stores/save-status-store.js";

/**
 * @file FR-164 local recovery (C-10). The editor owns WHEN snapshots are
 * written (debounced after each commit) and cleared (successful save /
 * discard); the adapter owns WHERE they live. A ready-made IndexedDB
 * adapter is provided for the common host.
 */

export interface CanvasRecoverySnapshot {
	documentId: string;
	ir: CanvasIR;
	/** History state id at snapshot time. */
	revision: number;
	/** ISO timestamp of the write. */
	savedAt: string;
}

export interface CanvasRecoveryAdapter {
	write(snapshot: CanvasRecoverySnapshot): Promise<void>;
	read(documentId: string): Promise<CanvasRecoverySnapshot | null>;
	clear(documentId: string): Promise<void>;
}

const DEFAULT_DB_NAME = "anvilkit-canvas-recovery";
const DEFAULT_STORE = "snapshots";

function openDb(dbName: string, storeName: string): Promise<IDBDatabase> {
	return new Promise((resolve, reject) => {
		const request = indexedDB.open(dbName, 1);
		request.onupgradeneeded = () => {
			if (!request.result.objectStoreNames.contains(storeName)) {
				request.result.createObjectStore(storeName);
			}
		};
		request.onsuccess = () => resolve(request.result);
		request.onerror = () => reject(request.error ?? new Error("indexedDB"));
	});
}

function requestToPromise<T>(request: IDBRequest<T>): Promise<T> {
	return new Promise((resolve, reject) => {
		request.onsuccess = () => resolve(request.result);
		request.onerror = () => reject(request.error ?? new Error("indexedDB"));
	});
}

/**
 * FR-164 default adapter: one snapshot per document id in IndexedDB. Every
 * method opens/closes its own connection — recovery traffic is low-volume
 * and this keeps the adapter free of connection lifecycle state. Throws
 * where IndexedDB is unavailable (SSR/jsdom); the recovery controller treats
 * adapter failures as best-effort and never breaks editing.
 */
export function createIndexedDbRecoveryAdapter(
	options: { dbName?: string; storeName?: string } = {},
): CanvasRecoveryAdapter {
	const dbName = options.dbName ?? DEFAULT_DB_NAME;
	const storeName = options.storeName ?? DEFAULT_STORE;
	const withStore = async <T>(
		mode: IDBTransactionMode,
		run: (store: IDBObjectStore) => IDBRequest<T>,
	): Promise<T> => {
		const db = await openDb(dbName, storeName);
		try {
			return await requestToPromise(
				run(db.transaction(storeName, mode).objectStore(storeName)),
			);
		} finally {
			db.close();
		}
	};
	return {
		write: (snapshot) =>
			withStore("readwrite", (store) =>
				store.put(snapshot, snapshot.documentId),
			).then(() => undefined),
		read: (documentId) =>
			withStore<CanvasRecoverySnapshot | undefined>("readonly", (store) =>
				store.get(documentId),
			).then((snapshot) => snapshot ?? null),
		clear: (documentId) =>
			withStore("readwrite", (store) => store.delete(documentId)).then(
				() => undefined,
			),
	};
}

export interface CreateRecoveryControllerOptions {
	adapter: CanvasRecoveryAdapter;
	getIR: () => CanvasIR;
	historyStore: HistoryStoreApi;
	/** When present, a successful save clears the snapshot (server has it). */
	saveStatusStore?: SaveStatusStoreApi;
	/** Quiet period after the last change before a snapshot writes. */
	debounceMs?: number;
	now?: () => string;
	setTimeoutFn?: typeof setTimeout;
	clearTimeoutFn?: typeof clearTimeout;
}

export interface RecoveryController {
	dispose(): void;
}

export const DEFAULT_RECOVERY_DEBOUNCE_MS = 2000;

/**
 * Watches the history store and mirrors the document into the recovery
 * adapter, debounced; clears the snapshot once a real save succeeds.
 * Best-effort throughout — adapter failures are swallowed (recovery must
 * never take editing down with it).
 */
export function createRecoveryController(
	options: CreateRecoveryControllerOptions,
): RecoveryController {
	const debounceMs = options.debounceMs ?? DEFAULT_RECOVERY_DEBOUNCE_MS;
	const now = options.now ?? (() => new Date().toISOString());
	const setT = options.setTimeoutFn ?? setTimeout;
	const clearT = options.clearTimeoutFn ?? clearTimeout;
	let disposed = false;
	let timer: ReturnType<typeof setTimeout> | null = null;
	let lastWrittenRevision = options.historyStore.getState().getStateId();

	const writeSnapshot = (): void => {
		timer = null;
		if (disposed) return;
		const ir = options.getIR();
		const revision = options.historyStore.getState().getStateId();
		lastWrittenRevision = revision;
		void options.adapter
			.write({ documentId: ir.id, ir, revision, savedAt: now() })
			.catch(() => {
				// Best-effort: storage quota / private-mode failures never surface.
			});
	};

	const unsubscribeHistory = options.historyStore.subscribe(() => {
		if (disposed) return;
		if (options.historyStore.getState().getStateId() === lastWrittenRevision)
			return;
		if (timer !== null) clearT(timer);
		timer = setT(writeSnapshot, debounceMs);
	});

	const unsubscribeStatus = options.saveStatusStore?.subscribe((state) => {
		if (disposed || state.status !== "saved") return;
		void options.adapter.clear(options.getIR().id).catch(() => {
			// Best-effort, as above.
		});
	});

	return {
		dispose() {
			disposed = true;
			if (timer !== null) clearT(timer);
			unsubscribeHistory();
			unsubscribeStatus?.();
		},
	};
}
