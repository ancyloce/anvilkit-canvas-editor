/**
 * @file cp1-001 (PLAN-0035 §5 P1) — browser-local blob storage, the floor the
 * zero-config asset ingress path sits on. Today a host mounting
 * `<CanvasStudio>` with no `assetUploader` cannot get an image onto the canvas
 * by any route: `uploadSingleFile` returns `{ ok: false }` immediately
 * (`upload-actions.ts:127`), `uploadFilesImpl` toasts "no upload service
 * configured" (`upload-actions.ts:183`), and the image tool is gated off
 * (`CanvasStudio.tsx:1278`). The default uploader (`cp1-002`) and picker
 * (`cp1-003`) both write here; rehydration (`cp1-005`) and export portability
 * (`cp1-006`) both read from here.
 *
 * ## Why IndexedDB blobs and not data URIs
 *
 * Settled in PLAN-0035 §5 P1 / PLAN-0029 §3, and this module must not
 * undermine it: a 4 MB photo is ~5.5 MB of base64, and a data URI lives inside
 * the IR — so it would be copied into **every autosave and every undo
 * snapshot**. Plain object URLs have the opposite problem: they do not survive
 * a reload. So bytes live in IndexedDB and object URLs are minted on read
 * (`cp1-005` owns the mint/revoke lifecycle; this module deliberately does
 * not, so that the store stays usable from a worker or a test with no
 * `URL.createObjectURL`).
 *
 * ## Degradation, not failure
 *
 * IndexedDB fails in three distinct ways and all three land on the same
 * in-memory `Map`, with one console warning per store instance and **never** a
 * throw:
 *
 * 1. **Absent** — SSR, jsdom, a worker without the global. Even *reading*
 *    `globalThis.indexedDB` can throw in a sandboxed iframe, hence the guard.
 * 2. **Present but unopenable** — Safari/Firefox private browsing throw from
 *    `open()` or fire `onerror`; a blocked version upgrade in another tab
 *    would otherwise hang forever, so `onblocked` is treated as a failure too.
 * 3. **Open, then the transaction fails** — quota exhaustion, a corrupted
 *    store, or a connection force-closed by another tab. Caught per operation:
 *    the store degrades and the operation is retried against memory.
 *
 * Degradation is one-way for the lifetime of a connection. `close()` drops the
 * connection so a later call can try IndexedDB again.
 *
 * ## Caps
 *
 * The caps are *ours*, enforced before any write, and exist so a user gets a
 * typed, actionable error instead of an opaque `QuotaExceededError` after
 * silently filling their disk quota. The browser's own quota is the backstop,
 * not the contract — see {@link DEFAULT_MAX_ASSET_BYTES} and
 * {@link DEFAULT_MAX_TOTAL_BYTES} for the numbers and why they are those.
 *
 * ## Single-instance assumption
 *
 * Asset **metadata** is cached in memory (hydrated once per connection from a
 * blob-free object store) so `list()`, `has()`, `usage()` and the cap check
 * cost nothing and cannot be made to read every blob back. That cache is
 * per-instance, so two instances over one database would drift. Use
 * {@link getSharedLocalAssetStore} — `cp1-004` wires exactly one store for the
 * uploader and the picker, which is also what "adapters are constructed once,
 * not per render" requires.
 *
 * No new dependency: `indexedDB`, `Blob` and `Map` are platform built-ins, and
 * an IndexedDB wrapper library would buy nothing over the ~40 lines of
 * promisification here.
 */

/** Storage actually in use for a given store instance. */
export type LocalAssetStoreBackend = "indexeddb" | "memory";

/**
 * Failure modes callers are expected to handle. Both are cap breaches — every
 * *environmental* failure degrades to memory instead of surfacing an error.
 */
export type LocalAssetStoreErrorCode = "asset-too-large" | "store-full";

/**
 * The typed error `put()` rejects with when a cap would be exceeded.
 *
 * Prefer {@link isLocalAssetStoreError} over `instanceof`: this package ships
 * dual ESM/CJS builds, so a consumer can hold two copies of the class and
 * `instanceof` then silently reports `false`.
 */
export class LocalAssetStoreError extends Error {
	readonly code: LocalAssetStoreErrorCode;
	/** Asset the rejected write was for. */
	readonly assetId: string;
	/** Size of the blob that was rejected. */
	readonly byteSize: number;
	/** Cap that would have been exceeded, in bytes. */
	readonly limitBytes: number;

	constructor(init: {
		code: LocalAssetStoreErrorCode;
		assetId: string;
		byteSize: number;
		limitBytes: number;
		message: string;
	}) {
		super(init.message);
		this.name = "LocalAssetStoreError";
		this.code = init.code;
		this.assetId = init.assetId;
		this.byteSize = init.byteSize;
		this.limitBytes = init.limitBytes;
	}
}

/** Realm-safe narrowing for {@link LocalAssetStoreError}. */
export function isLocalAssetStoreError(
	value: unknown,
): value is LocalAssetStoreError {
	if (value instanceof LocalAssetStoreError) return true;
	if (typeof value !== "object" || value === null) return false;
	const candidate = value as { name?: unknown; code?: unknown };
	return (
		candidate.name === "LocalAssetStoreError" &&
		(candidate.code === "asset-too-large" || candidate.code === "store-full")
	);
}

/**
 * Everything known about a stored asset except its bytes. Deliberately a
 * superset of what `CanvasAssetRef` needs minus `uri`, because the URI is
 * minted per session by `cp1-005` and must never be persisted.
 */
export interface LocalAssetMeta {
	readonly id: string;
	readonly mimeType: string;
	readonly byteSize: number;
	/** Epoch milliseconds at write time. */
	readonly createdAt: number;
	readonly width?: number;
	readonly height?: number;
	/** Original file name, when the ingress path knew one. */
	readonly name?: string;
}

/** Caller-supplied metadata for {@link LocalAssetStore.put}. */
export interface LocalAssetPutMeta {
	/** Defaults to `blob.type`, then `application/octet-stream`. */
	mimeType?: string;
	width?: number;
	height?: number;
	name?: string;
	/** Defaults to the store's clock. Provided for deterministic tests. */
	createdAt?: number;
}

/** Snapshot of consumption against the configured caps. */
export interface LocalAssetStoreUsage {
	count: number;
	totalBytes: number;
	maxAssetBytes: number;
	maxTotalBytes: number;
}

export interface LocalAssetStoreOptions {
	/** IndexedDB database name. Defaults to {@link DEFAULT_LOCAL_ASSET_DB_NAME}. */
	databaseName?: string;
	/** Per-asset cap. Defaults to {@link DEFAULT_MAX_ASSET_BYTES}. */
	maxAssetBytes?: number;
	/** Whole-store cap. Defaults to {@link DEFAULT_MAX_TOTAL_BYTES}. */
	maxTotalBytes?: number;
	/**
	 * IndexedDB implementation to use. Omit to read `globalThis.indexedDB`;
	 * pass `null` to force the in-memory backend (an ephemeral store, and how
	 * tests exercise the degraded path deterministically).
	 */
	indexedDB?: IDBFactory | null;
	/** Degradation reporter. Defaults to a single `console.warn`. */
	warn?: (message: string, cause?: unknown) => void;
	/** Clock for `createdAt`. Defaults to `Date.now`. */
	now?: () => number;
}

/**
 * Browser-local blob storage. Every method resolves — the only rejections are
 * {@link LocalAssetStoreError} cap breaches from `put()`.
 */
export interface LocalAssetStore {
	/**
	 * Store `blob` under `id`, replacing any existing asset with that id.
	 * Rejects with {@link LocalAssetStoreError} when a cap would be exceeded;
	 * nothing is written in that case.
	 */
	put(
		id: string,
		blob: Blob,
		meta?: LocalAssetPutMeta,
	): Promise<LocalAssetMeta>;
	/** Bytes for `id`, or `undefined` when it is not stored. */
	get(id: string): Promise<Blob | undefined>;
	/** Remove `id`. Resolves whether or not it was present. */
	delete(id: string): Promise<void>;
	/** Metadata for every stored asset, in insertion order. Loads no blobs. */
	list(): Promise<LocalAssetMeta[]>;
	/** Whether `id` is stored, without reading its bytes. */
	has(id: string): Promise<boolean>;
	/** Current consumption and the configured caps. */
	usage(): Promise<LocalAssetStoreUsage>;
	/** Remove every stored asset. The recovery path from a full store. */
	clear(): Promise<void>;
	/**
	 * Which backend this instance settled on, connecting if it has not yet.
	 * `"memory"` means nothing survives a reload — `cp1-006` uses this to
	 * decide whether an export is portable.
	 */
	backend(): Promise<LocalAssetStoreBackend>;
	/**
	 * Release the IndexedDB connection; the next call reconnects. A no-op on
	 * the memory backend, where the cache IS the data.
	 */
	close(): void;
}

const DB_VERSION = 1;
const BLOB_STORE = "blobs";
const META_STORE = "meta";

export const DEFAULT_LOCAL_ASSET_DB_NAME = "anvilkit-canvas-assets";

/**
 * 25 MiB per asset. Matches the per-image upload ceiling mainstream design
 * tools converge on, and is ~2.5x a 25 MP JPEG — generous for photography,
 * while still rejecting the accidental video-file drop that would otherwise
 * consume the whole store in one write.
 */
export const DEFAULT_MAX_ASSET_BYTES = 25 * 1024 * 1024;

/**
 * 200 MiB total. Chosen against the *smallest* realistic origin quota rather
 * than the largest: Chromium grants ~60% of free disk and Safari ~1 GB, so
 * 200 MiB stays inside every one of them without prompting. It is also the
 * ceiling on the memory fallback, where the whole store is resident in the
 * tab — which is the constraint that actually binds.
 */
export const DEFAULT_MAX_TOTAL_BYTES = 200 * 1024 * 1024;

type Connection =
	| { readonly kind: "indexeddb"; readonly db: IDBDatabase }
	| { readonly kind: "memory" };

function requestDone<T>(request: IDBRequest<T>): Promise<T> {
	return new Promise<T>((resolve, reject) => {
		request.onsuccess = () => resolve(request.result);
		request.onerror = () =>
			reject(request.error ?? new Error("IndexedDB request failed"));
	});
}

function transactionDone(tx: IDBTransaction): Promise<void> {
	return new Promise<void>((resolve, reject) => {
		tx.oncomplete = () => resolve();
		tx.onabort = () =>
			reject(tx.error ?? new Error("IndexedDB transaction aborted"));
		tx.onerror = () =>
			reject(tx.error ?? new Error("IndexedDB transaction failed"));
	});
}

/**
 * Resolves to `null` for every open failure rather than throwing: a synchronous
 * throw (Safari private mode), an `error` event (Firefox private browsing), and
 * a `blocked` event (another tab holding an older version open — which would
 * otherwise never settle) are all the same outcome to a caller.
 */
function openDatabase(
	factory: IDBFactory,
	name: string,
): Promise<IDBDatabase | null> {
	let request: IDBOpenDBRequest;
	try {
		request = factory.open(name, DB_VERSION);
	} catch {
		return Promise.resolve(null);
	}
	return new Promise<IDBDatabase | null>((resolve) => {
		let settled = false;
		const finish = (db: IDBDatabase | null) => {
			if (settled) {
				// A `blocked` open that later succeeds must not leak its handle.
				db?.close();
				return;
			}
			settled = true;
			resolve(db);
		};
		request.onupgradeneeded = () => {
			const db = request.result;
			if (!db.objectStoreNames.contains(BLOB_STORE)) {
				db.createObjectStore(BLOB_STORE, { keyPath: "id" });
			}
			if (!db.objectStoreNames.contains(META_STORE)) {
				db.createObjectStore(META_STORE, { keyPath: "id" });
			}
		};
		request.onsuccess = () => finish(request.result);
		request.onerror = () => finish(null);
		request.onblocked = () => finish(null);
	});
}

function readBlob(record: unknown): Blob | undefined {
	if (typeof record !== "object" || record === null) return undefined;
	const { blob } = record as { blob?: unknown };
	return blob instanceof Blob ? blob : undefined;
}

function readMeta(record: unknown): LocalAssetMeta | undefined {
	if (typeof record !== "object" || record === null) return undefined;
	const candidate = record as Partial<LocalAssetMeta>;
	if (typeof candidate.id !== "string") return undefined;
	if (typeof candidate.byteSize !== "number") return undefined;
	return candidate as LocalAssetMeta;
}

/**
 * Create a store. Nothing is opened until the first operation, so this is safe
 * to call during module evaluation, on the server, and in a test.
 */
export function createLocalAssetStore(
	options: LocalAssetStoreOptions = {},
): LocalAssetStore {
	const databaseName = options.databaseName ?? DEFAULT_LOCAL_ASSET_DB_NAME;
	const maxAssetBytes = options.maxAssetBytes ?? DEFAULT_MAX_ASSET_BYTES;
	const maxTotalBytes = options.maxTotalBytes ?? DEFAULT_MAX_TOTAL_BYTES;
	const now = options.now ?? Date.now;
	const warn =
		options.warn ??
		((message: string, cause?: unknown) => {
			if (cause === undefined) console.warn(`[canvas-editor] ${message}`);
			else console.warn(`[canvas-editor] ${message}`, cause);
		});

	/** Blob-free metadata for every stored asset. See the file header. */
	const metaIndex = new Map<string, LocalAssetMeta>();
	/** Bytes, on the memory backend only. */
	const memoryBlobs = new Map<string, Blob>();

	let connection: Connection | null = null;
	let connecting: Promise<Connection> | null = null;
	let warned = false;

	function warnOnce(message: string, cause?: unknown): void {
		if (warned) return;
		warned = true;
		warn(message, cause);
	}

	function closeDb(): void {
		if (connection?.kind !== "indexeddb") return;
		try {
			connection.db.close();
		} catch {
			// A connection already force-closed by the agent throws here; the
			// point of the call was to end up closed either way.
		}
	}

	/** Failure mode 3: give up on IndexedDB for the rest of this connection. */
	function degrade(message: string, cause?: unknown): Connection {
		closeDb();
		connection = { kind: "memory" };
		connecting = null;
		warnOnce(message, cause);
		return connection;
	}

	function resolveFactory(): IDBFactory | null {
		if (options.indexedDB !== undefined) return options.indexedDB;
		try {
			return (globalThis as { indexedDB?: IDBFactory }).indexedDB ?? null;
		} catch {
			// Failure mode 1, hostile variant: a sandboxed iframe can throw on
			// the property access itself.
			return null;
		}
	}

	async function connect(): Promise<Connection> {
		const factory = resolveFactory();
		if (factory === null) {
			return degrade(
				"IndexedDB is unavailable; local assets are kept in memory and will not survive a reload.",
			);
		}
		const db = await openDatabase(factory, databaseName);
		if (db === null) {
			return degrade(
				"IndexedDB could not be opened (private browsing, or another tab is blocking an upgrade); local assets are kept in memory and will not survive a reload.",
			);
		}
		// Another tab upgrading the database force-closes this connection.
		// Dropping it here means the next operation reconnects rather than
		// failing every subsequent transaction.
		db.onversionchange = () => {
			db.close();
			if (connection?.kind === "indexeddb" && connection.db === db) {
				connection = null;
				metaIndex.clear();
			}
		};
		const opened: Connection = { kind: "indexeddb", db };
		connection = opened;
		connecting = null;
		try {
			const tx = db.transaction(META_STORE, "readonly");
			const done = transactionDone(tx);
			void done.catch(() => undefined);
			const records: unknown = await requestDone(
				tx.objectStore(META_STORE).getAll(),
			);
			await done;
			metaIndex.clear();
			for (const record of Array.isArray(records) ? records : []) {
				const meta = readMeta(record);
				if (meta) metaIndex.set(meta.id, meta);
			}
		} catch (cause) {
			return degrade(
				"IndexedDB opened but could not be read; local assets are kept in memory and will not survive a reload.",
				cause,
			);
		}
		return opened;
	}

	function ensure(): Promise<Connection> {
		if (connection) return Promise.resolve(connection);
		connecting ??= connect();
		return connecting;
	}

	/**
	 * Run `op` in one transaction, degrading to `onMemory` on any IndexedDB
	 * failure. `op` may only await IndexedDB requests — awaiting anything else
	 * lets the transaction auto-commit underneath it.
	 */
	async function withDb<T>(
		stores: string | string[],
		mode: IDBTransactionMode,
		op: (tx: IDBTransaction) => Promise<T>,
		onMemory: () => T,
		failure: string,
	): Promise<T> {
		const conn = await ensure();
		if (conn.kind === "memory") return onMemory();
		try {
			const tx = conn.db.transaction(stores, mode);
			const done = transactionDone(tx);
			// The transaction aborts when a request fails, so both promises
			// reject. Attaching the handler up front keeps the loser of that
			// race from surfacing as an unhandled rejection.
			void done.catch(() => undefined);
			const result = await op(tx);
			await done;
			return result;
		} catch (cause) {
			degrade(failure, cause);
			return onMemory();
		}
	}

	function totalBytes(): number {
		let total = 0;
		for (const meta of metaIndex.values()) total += meta.byteSize;
		return total;
	}

	function enforceCaps(meta: LocalAssetMeta): void {
		if (meta.byteSize > maxAssetBytes) {
			throw new LocalAssetStoreError({
				code: "asset-too-large",
				assetId: meta.id,
				byteSize: meta.byteSize,
				limitBytes: maxAssetBytes,
				message: `Asset ${meta.id} is ${meta.byteSize} bytes, over the ${maxAssetBytes}-byte per-asset limit.`,
			});
		}
		// A replacement frees the bytes it overwrites, so charge only the delta.
		const replaced = metaIndex.get(meta.id)?.byteSize ?? 0;
		const projected = totalBytes() - replaced + meta.byteSize;
		if (projected > maxTotalBytes) {
			throw new LocalAssetStoreError({
				code: "store-full",
				assetId: meta.id,
				byteSize: meta.byteSize,
				limitBytes: maxTotalBytes,
				message: `Storing asset ${meta.id} would use ${projected} bytes, over the ${maxTotalBytes}-byte local asset limit.`,
			});
		}
	}

	return {
		async put(id, blob, meta) {
			const record: LocalAssetMeta = {
				id,
				mimeType: meta?.mimeType ?? (blob.type || "application/octet-stream"),
				byteSize: blob.size,
				createdAt: meta?.createdAt ?? now(),
				...(meta?.width !== undefined ? { width: meta.width } : {}),
				...(meta?.height !== undefined ? { height: meta.height } : {}),
				...(meta?.name !== undefined ? { name: meta.name } : {}),
			};
			await ensure();
			// Cap check and index update are one synchronous block after the
			// only await, so concurrent puts cannot both pass a check the pair
			// of them would fail.
			enforceCaps(record);
			metaIndex.set(id, record);
			await withDb(
				[BLOB_STORE, META_STORE],
				"readwrite",
				async (tx) => {
					await Promise.all([
						requestDone(tx.objectStore(BLOB_STORE).put({ id, blob })),
						requestDone(tx.objectStore(META_STORE).put(record)),
					]);
				},
				() => {
					memoryBlobs.set(id, blob);
				},
				"IndexedDB write failed (the origin's storage quota is the usual cause); local assets are kept in memory and will not survive a reload.",
			);
			return record;
		},

		get(id) {
			return withDb(
				BLOB_STORE,
				"readonly",
				async (tx) => {
					const record: unknown = await requestDone(
						tx.objectStore(BLOB_STORE).get(id),
					);
					return readBlob(record);
				},
				() => memoryBlobs.get(id),
				"IndexedDB read failed; falling back to in-memory assets for this session.",
			);
		},

		async delete(id) {
			await ensure();
			metaIndex.delete(id);
			memoryBlobs.delete(id);
			await withDb(
				[BLOB_STORE, META_STORE],
				"readwrite",
				async (tx) => {
					await Promise.all([
						requestDone(tx.objectStore(BLOB_STORE).delete(id)),
						requestDone(tx.objectStore(META_STORE).delete(id)),
					]);
				},
				() => undefined,
				"IndexedDB delete failed; falling back to in-memory assets for this session.",
			);
		},

		async list() {
			await ensure();
			return [...metaIndex.values()];
		},

		async has(id) {
			await ensure();
			return metaIndex.has(id);
		},

		async usage() {
			await ensure();
			return {
				count: metaIndex.size,
				totalBytes: totalBytes(),
				maxAssetBytes,
				maxTotalBytes,
			};
		},

		async clear() {
			await ensure();
			metaIndex.clear();
			memoryBlobs.clear();
			await withDb(
				[BLOB_STORE, META_STORE],
				"readwrite",
				async (tx) => {
					await Promise.all([
						requestDone(tx.objectStore(BLOB_STORE).clear()),
						requestDone(tx.objectStore(META_STORE).clear()),
					]);
				},
				() => undefined,
				"IndexedDB clear failed; falling back to in-memory assets for this session.",
			);
		},

		async backend() {
			return (await ensure()).kind;
		},

		close() {
			if (connection?.kind !== "indexeddb") return;
			closeDb();
			connection = null;
			connecting = null;
			metaIndex.clear();
		},
	};
}

let sharedStore: LocalAssetStore | null = null;

/**
 * The one store the editor's default adapters share (`cp1-004`). Options are
 * honoured on first call only — a later call returns the existing instance, so
 * a host that wants different caps must configure them before the editor
 * mounts, or build its own with {@link createLocalAssetStore}.
 */
export function getSharedLocalAssetStore(
	options?: LocalAssetStoreOptions,
): LocalAssetStore {
	sharedStore ??= createLocalAssetStore(options);
	return sharedStore;
}

/** Drop the shared instance, closing its connection. Test/teardown seam. */
export function resetSharedLocalAssetStore(): void {
	sharedStore?.close();
	sharedStore = null;
}
