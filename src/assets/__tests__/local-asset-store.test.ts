import { afterEach, describe, expect, it, vi } from "vitest";
import {
	createLocalAssetStore,
	DEFAULT_MAX_ASSET_BYTES,
	DEFAULT_MAX_TOTAL_BYTES,
	getSharedLocalAssetStore,
	isLocalAssetStoreError,
	LocalAssetStoreError,
	resetSharedLocalAssetStore,
} from "../local-asset-store.js";

/**
 * ## Why a hand-rolled IndexedDB double
 *
 * `fake-indexeddb` is a devDependency of `plugin-collab-yjs` only — it is not
 * installed for this package, and installing it would add a dependency this
 * task explicitly forbids for a test double that fits in ~90 lines. The double
 * below models exactly the surface `local-asset-store.ts` touches, and it can
 * inject the two failure modes a real implementation cannot be asked for on
 * demand: an unopenable database and a transaction that fails mid-write.
 *
 * jsdom has no `indexedDB` global, so the *absent-global* degradation path is
 * additionally exercised against the real environment (see "no IndexedDB
 * global").
 */

type Records = Map<string, unknown>;
type Stores = Map<string, Records>;

interface FakeControls {
	/** Every request the store issued, as `op:storeName`. */
	ops: string[];
	failOpen?: "throw" | "error" | "blocked";
	/** Return an Error to make that request (and its transaction) fail. */
	failRequest?: (op: string, storeName: string) => Error | undefined;
	/** Make `db.transaction()` itself throw, as a force-closed connection does. */
	failTransaction?: boolean;
}

interface FakeRequest {
	result: unknown;
	error: Error | null;
	onsuccess: (() => void) | null;
	onerror: (() => void) | null;
}

function makeObjectStore(
	name: string,
	data: Records,
	schedule: (op: string, name: string, run: () => unknown) => FakeRequest,
) {
	return {
		put: (value: { id: string }) =>
			schedule("put", name, () => {
				data.set(value.id, value);
				return value.id;
			}),
		get: (key: string) => schedule("get", name, () => data.get(key)),
		delete: (key: string) =>
			schedule("delete", name, () => {
				data.delete(key);
			}),
		clear: () =>
			schedule("clear", name, () => {
				data.clear();
			}),
		getAll: () => schedule("getAll", name, () => [...data.values()]),
	};
}

function makeTransaction(stores: Stores, names: string[], fake: FakeControls) {
	let pending = 0;
	let finished = false;
	const tx = {
		error: null as Error | null,
		oncomplete: null as (() => void) | null,
		onabort: null as (() => void) | null,
		onerror: null as (() => void) | null,
		objectStore(name: string) {
			const data = stores.get(name);
			if (!names.includes(name) || !data) {
				throw new Error(`NotFoundError: ${name}`);
			}
			return makeObjectStore(name, data, schedule);
		},
	};
	function schedule(op: string, name: string, run: () => unknown): FakeRequest {
		const request: FakeRequest = {
			result: undefined,
			error: null,
			onsuccess: null,
			onerror: null,
		};
		pending += 1;
		queueMicrotask(() => {
			if (finished) return;
			fake.ops.push(`${op}:${name}`);
			const failure = fake.failRequest?.(op, name);
			if (failure) {
				finished = true;
				tx.error = failure;
				request.error = failure;
				request.onerror?.();
				tx.onabort?.();
				return;
			}
			request.result = run();
			pending -= 1;
			request.onsuccess?.();
			if (pending === 0) {
				finished = true;
				queueMicrotask(() => tx.oncomplete?.());
			}
		});
		return request;
	}
	return tx;
}

function makeDatabase(stores: Stores, fake: FakeControls) {
	let closed = false;
	return {
		onversionchange: null as (() => void) | null,
		objectStoreNames: { contains: (name: string) => stores.has(name) },
		createObjectStore(name: string) {
			stores.set(name, new Map());
			return {};
		},
		transaction(names: string | string[], _mode: string) {
			if (closed) throw new Error("InvalidStateError: database is closed");
			if (fake.failTransaction) throw new Error("InvalidStateError: injected");
			return makeTransaction(
				stores,
				Array.isArray(names) ? names : [names],
				fake,
			);
		},
		close() {
			closed = true;
		},
	};
}

function createFakeIndexedDB(overrides: Partial<FakeControls> = {}) {
	const fake: FakeControls = { ops: [], ...overrides };
	/** Survives `close()` and reconnection, exactly like a real database. */
	const databases = new Map<string, Stores>();
	const factory = {
		open(name: string) {
			if (fake.failOpen === "throw") {
				throw new Error("SecurityError: open denied");
			}
			const request = {
				result: undefined as unknown,
				error: null as Error | null,
				onsuccess: null as (() => void) | null,
				onerror: null as (() => void) | null,
				onblocked: null as (() => void) | null,
				onupgradeneeded: null as (() => void) | null,
			};
			queueMicrotask(() => {
				if (fake.failOpen === "error") {
					request.error = new Error("InvalidStateError");
					request.onerror?.();
					return;
				}
				if (fake.failOpen === "blocked") {
					request.onblocked?.();
					return;
				}
				let stores = databases.get(name);
				const created = stores === undefined;
				if (!stores) {
					stores = new Map();
					databases.set(name, stores);
				}
				request.result = makeDatabase(stores, fake);
				if (created) request.onupgradeneeded?.();
				request.onsuccess?.();
			});
			return request;
		},
	};
	return { factory: factory as unknown as IDBFactory, fake };
}

const blobOf = (bytes: number, type = "image/png"): Blob =>
	new Blob(["x".repeat(bytes)], { type });

/** Degradation warnings are expected here; keep them out of the test output. */
const silent = () => undefined;

const memoryStore = (
	options: Parameters<typeof createLocalAssetStore>[0] = {},
) => createLocalAssetStore({ indexedDB: null, warn: silent, ...options });

afterEach(() => {
	resetSharedLocalAssetStore();
});

describe("createLocalAssetStore — round-trip (cp1-001)", () => {
	it("round-trips a blob by id on the memory backend", async () => {
		const store = memoryStore();
		const blob = blobOf(8, "image/jpeg");
		const meta = await store.put("a1", blob, { width: 4, height: 2 });

		expect(meta).toMatchObject({
			id: "a1",
			mimeType: "image/jpeg",
			byteSize: 8,
			width: 4,
			height: 2,
		});
		const read = await store.get("a1");
		expect(read).toBe(blob);
		expect(await store.has("a1")).toBe(true);
	});

	it("round-trips a blob by id on the IndexedDB backend", async () => {
		const { factory } = createFakeIndexedDB();
		const store = createLocalAssetStore({ indexedDB: factory });

		const blob = blobOf(8);
		await store.put("a1", blob);

		expect(await store.backend()).toBe("indexeddb");
		expect(await store.get("a1")).toBe(blob);
	});

	it("defaults mimeType and createdAt, and keeps a typeless blob addressable", async () => {
		const store = memoryStore({ now: () => 1_700_000_000_000 });
		const meta = await store.put("a1", new Blob(["ab"]));

		expect(meta.mimeType).toBe("application/octet-stream");
		expect(meta.createdAt).toBe(1_700_000_000_000);
		expect(meta.byteSize).toBe(2);
	});

	it("replaces an existing id rather than duplicating it", async () => {
		const store = memoryStore();
		await store.put("a1", blobOf(4));
		const second = blobOf(6);
		await store.put("a1", second);

		expect(await store.get("a1")).toBe(second);
		expect(await store.list()).toHaveLength(1);
		expect((await store.usage()).totalBytes).toBe(6);
	});

	it("resolves undefined for an unknown id instead of throwing", async () => {
		const store = memoryStore();
		expect(await store.get("nope")).toBeUndefined();
		expect(await store.has("nope")).toBe(false);
	});
});

describe("createLocalAssetStore — list/delete/clear (cp1-001)", () => {
	it("lists metadata in insertion order without reading any blob", async () => {
		const { factory, fake } = createFakeIndexedDB();
		const store = createLocalAssetStore({ indexedDB: factory });
		await store.put("a1", blobOf(3), { name: "one.png" });
		await store.put("a2", blobOf(5), { name: "two.png" });
		fake.ops.length = 0;

		const list = await store.list();

		expect(list.map((m) => m.id)).toEqual(["a1", "a2"]);
		expect(list.map((m) => m.name)).toEqual(["one.png", "two.png"]);
		// cp1-005/cp1-006 both enumerate assets; if listing ever read the blob
		// store, enumerating would deserialize every byte in the database.
		expect(fake.ops.filter((op) => op.endsWith(":blobs"))).toEqual([]);
	});

	it("deletes an asset from both backends and frees its budget", async () => {
		const { factory } = createFakeIndexedDB();
		for (const store of [
			memoryStore(),
			createLocalAssetStore({ indexedDB: factory }),
		]) {
			await store.put("a1", blobOf(10));
			await store.delete("a1");

			expect(await store.get("a1")).toBeUndefined();
			expect(await store.has("a1")).toBe(false);
			expect(await store.list()).toEqual([]);
			expect((await store.usage()).totalBytes).toBe(0);
		}
	});

	it("resolves when deleting an id that was never stored", async () => {
		const store = memoryStore();
		await expect(store.delete("ghost")).resolves.toBeUndefined();
	});

	it("clear() empties the store, which is the recovery path from store-full", async () => {
		const { factory } = createFakeIndexedDB();
		const store = createLocalAssetStore({ indexedDB: factory });
		await store.put("a1", blobOf(4));
		await store.put("a2", blobOf(4));

		await store.clear();

		expect(await store.list()).toEqual([]);
		expect(await store.get("a1")).toBeUndefined();
		expect((await store.usage()).count).toBe(0);
	});

	it("reports usage against the configured caps", async () => {
		const store = memoryStore();
		await store.put("a1", blobOf(7));

		expect(await store.usage()).toEqual({
			count: 1,
			totalBytes: 7,
			maxAssetBytes: DEFAULT_MAX_ASSET_BYTES,
			maxTotalBytes: DEFAULT_MAX_TOTAL_BYTES,
		});
	});
});

describe("createLocalAssetStore — persistence (cp1-005 rehydration)", () => {
	it("re-reads stored blobs and metadata through a fresh connection", async () => {
		const { factory } = createFakeIndexedDB();
		const first = createLocalAssetStore({ indexedDB: factory });
		const blob = blobOf(6, "image/svg+xml");
		await first.put("a1", blob, { width: 10, height: 20, name: "logo.svg" });
		first.close();

		// A reload is a new store instance over the same database.
		const second = createLocalAssetStore({ indexedDB: factory });

		expect(await second.list()).toEqual([
			expect.objectContaining({
				id: "a1",
				mimeType: "image/svg+xml",
				byteSize: 6,
				width: 10,
				height: 20,
				name: "logo.svg",
			}),
		]);
		expect(await second.get("a1")).toBe(blob);
	});

	it("close() releases the connection and the next call reconnects", async () => {
		const { factory } = createFakeIndexedDB();
		const store = createLocalAssetStore({ indexedDB: factory });
		await store.put("a1", blobOf(2));
		store.close();

		expect(await store.backend()).toBe("indexeddb");
		expect(await store.get("a1")).toBeDefined();
	});
});

describe("createLocalAssetStore — IndexedDB unavailable (cp1-001 degradation)", () => {
	it("degrades when the global is absent — jsdom has no indexedDB", async () => {
		expect((globalThis as { indexedDB?: unknown }).indexedDB).toBeUndefined();
		const warn = vi.fn();
		const store = createLocalAssetStore({ warn });

		expect(await store.backend()).toBe("memory");
		const blob = blobOf(3);
		await store.put("a1", blob);
		expect(await store.get("a1")).toBe(blob);
		expect(warn).toHaveBeenCalledTimes(1);
	});

	it("degrades when reading the global itself throws (sandboxed iframe)", async () => {
		const warn = vi.fn();
		Object.defineProperty(globalThis, "indexedDB", {
			configurable: true,
			get() {
				throw new Error("SecurityError: access denied");
			},
		});
		try {
			const store = createLocalAssetStore({ warn });
			expect(await store.backend()).toBe("memory");
			await expect(store.put("a1", blobOf(1))).resolves.toBeDefined();
		} finally {
			Reflect.deleteProperty(globalThis, "indexedDB");
		}
		expect(warn).toHaveBeenCalledTimes(1);
	});

	it.each([
		"throw",
		"error",
		"blocked",
	] as const)("degrades when open() fails with %s, and every operation still resolves", async (failOpen) => {
		const { factory } = createFakeIndexedDB({ failOpen });
		const warn = vi.fn();
		const store = createLocalAssetStore({ indexedDB: factory, warn });

		expect(await store.backend()).toBe("memory");
		const blob = blobOf(4);
		await expect(store.put("a1", blob)).resolves.toMatchObject({ id: "a1" });
		await expect(store.get("a1")).resolves.toBe(blob);
		await expect(store.has("a1")).resolves.toBe(true);
		await expect(store.list()).resolves.toHaveLength(1);
		await expect(store.usage()).resolves.toMatchObject({ count: 1 });
		await expect(store.delete("a1")).resolves.toBeUndefined();
		await expect(store.clear()).resolves.toBeUndefined();
		expect(() => {
			store.close();
		}).not.toThrow();
		expect(warn).toHaveBeenCalledTimes(1);
	});

	it("degrades when the metadata hydration read fails after a successful open", async () => {
		const { factory } = createFakeIndexedDB({
			failRequest: (op) =>
				op === "getAll" ? new Error("UnknownError: store corrupt") : undefined,
		});
		const warn = vi.fn();
		const store = createLocalAssetStore({ indexedDB: factory, warn });

		expect(await store.backend()).toBe("memory");
		expect(warn).toHaveBeenCalledTimes(1);
	});

	it("degrades when a write transaction fails (quota), keeping the blob readable", async () => {
		const { factory, fake } = createFakeIndexedDB({
			failRequest: (op, name) =>
				op === "put" && name === "blobs"
					? new Error("QuotaExceededError")
					: undefined,
		});
		const warn = vi.fn();
		const store = createLocalAssetStore({ indexedDB: factory, warn });
		expect(await store.backend()).toBe("indexeddb");

		const blob = blobOf(5);
		await expect(store.put("a1", blob)).resolves.toMatchObject({ id: "a1" });

		expect(await store.backend()).toBe("memory");
		expect(await store.get("a1")).toBe(blob);
		expect(await store.list()).toHaveLength(1);
		expect(warn).toHaveBeenCalledTimes(1);
		// The failed write must not have been retried against IndexedDB.
		expect(fake.ops.filter((op) => op === "put:blobs")).toHaveLength(1);
	});

	it("degrades when the connection is force-closed and transaction() throws", async () => {
		const { factory, fake } = createFakeIndexedDB();
		const warn = vi.fn();
		const store = createLocalAssetStore({ indexedDB: factory, warn });
		await store.put("a1", blobOf(2));
		fake.failTransaction = true;

		await expect(store.get("a1")).resolves.toBeUndefined();
		expect(await store.backend()).toBe("memory");
		expect(warn).toHaveBeenCalledTimes(1);
	});

	it("warns exactly once no matter how many operations degrade", async () => {
		const warn = vi.fn();
		const store = createLocalAssetStore({ indexedDB: null, warn });

		for (let i = 0; i < 5; i += 1) {
			await store.put(`a${i}`, blobOf(1));
			await store.get(`a${i}`);
			await store.list();
		}

		expect(warn).toHaveBeenCalledTimes(1);
	});
});

describe("createLocalAssetStore — caps (cp1-001 typed error)", () => {
	it("rejects an oversized asset with a typed error and stores nothing", async () => {
		const store = memoryStore({ maxAssetBytes: 4 });

		const error = await store.put("a1", blobOf(5)).catch((e: unknown) => e);

		expect(isLocalAssetStoreError(error)).toBe(true);
		expect(error).toBeInstanceOf(LocalAssetStoreError);
		expect(error).toMatchObject({
			code: "asset-too-large",
			assetId: "a1",
			byteSize: 5,
			limitBytes: 4,
		});
		expect(await store.has("a1")).toBe(false);
		expect((await store.usage()).totalBytes).toBe(0);
	});

	it("rejects a write that would exceed the total cap, keeping earlier assets", async () => {
		const store = memoryStore({ maxTotalBytes: 10 });
		await store.put("a1", blobOf(6));

		const error = await store.put("a2", blobOf(6)).catch((e: unknown) => e);

		expect(isLocalAssetStoreError(error)).toBe(true);
		expect(error).toMatchObject({ code: "store-full", limitBytes: 10 });
		expect(await store.has("a1")).toBe(true);
		expect(await store.has("a2")).toBe(false);
		expect((await store.usage()).totalBytes).toBe(6);
	});

	it("charges only the delta when replacing an asset, not the full size again", async () => {
		const store = memoryStore({ maxTotalBytes: 10 });
		await store.put("a1", blobOf(8));

		await expect(store.put("a1", blobOf(9))).resolves.toMatchObject({
			byteSize: 9,
		});
		expect((await store.usage()).totalBytes).toBe(9);
	});

	it("enforces the cap on the IndexedDB backend too, writing nothing", async () => {
		const { factory, fake } = createFakeIndexedDB();
		const store = createLocalAssetStore({
			indexedDB: factory,
			maxAssetBytes: 4,
		});
		await store.backend();
		fake.ops.length = 0;

		await expect(store.put("a1", blobOf(5))).rejects.toBeInstanceOf(
			LocalAssetStoreError,
		);

		expect(fake.ops).toEqual([]);
		expect(await store.list()).toEqual([]);
	});

	it("serializes concurrent puts so two writes cannot both pass one budget", async () => {
		const store = memoryStore({ maxTotalBytes: 10 });

		const results = await Promise.allSettled([
			store.put("a1", blobOf(6)),
			store.put("a2", blobOf(6)),
		]);

		expect(results.map((r) => r.status)).toEqual(["fulfilled", "rejected"]);
		expect((await store.usage()).totalBytes).toBe(6);
	});

	it("isLocalAssetStoreError rejects unrelated values", () => {
		expect(isLocalAssetStoreError(new Error("nope"))).toBe(false);
		expect(isLocalAssetStoreError(null)).toBe(false);
		expect(isLocalAssetStoreError({ name: "LocalAssetStoreError" })).toBe(
			false,
		);
		// Realm-crossing shape: a second copy of the class from the CJS build.
		expect(
			isLocalAssetStoreError({
				name: "LocalAssetStoreError",
				code: "store-full",
			}),
		).toBe(true);
	});
});

describe("getSharedLocalAssetStore (cp1-004 single-instance wiring)", () => {
	it("returns one instance so the uploader and picker share a metadata cache", () => {
		const first = getSharedLocalAssetStore({ indexedDB: null, warn: silent });
		expect(getSharedLocalAssetStore()).toBe(first);
	});

	it("resetSharedLocalAssetStore drops the instance", () => {
		const first = getSharedLocalAssetStore({ indexedDB: null, warn: silent });
		resetSharedLocalAssetStore();
		expect(
			getSharedLocalAssetStore({ indexedDB: null, warn: silent }),
		).not.toBe(first);
	});
});
