import type { CanvasAssetRef } from "@anvilkit/canvas-core";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
	collectLocalAssetIds,
	createLocalAssetSvgFetcher,
	inlineLocalAssetsForJson,
	LOCAL_ASSET_EXPORT_WARNING_CODES,
	scanLocalAssets,
} from "../local-asset-export.js";
import type {
	LocalAssetMeta,
	LocalAssetStore,
	LocalAssetStoreBackend,
} from "../local-asset-store.js";

/**
 * cp1-006 — the export-portability layer, over a MOCKED {@link LocalAssetStore}.
 *
 * The store's own IndexedDB behaviour, its three degradation modes and its caps
 * are `cp1-001`'s tests, against `cp1-001`'s hand-rolled IDB double; nothing is
 * imported from that file and `fake-indexeddb` is still not installed. Mocking
 * the interface keeps these specs about the two decisions this module actually
 * owns: which assets are unportable, and whether their bytes fit under the cap.
 */

interface StoreStub extends LocalAssetStore {
	readonly calls: { get: string[]; list: number; backend: number };
}

function makeStore(
	entries: ReadonlyArray<{
		id: string;
		bytes: Uint8Array;
		mimeType?: string;
		name?: string;
	}>,
	backend: LocalAssetStoreBackend = "indexeddb",
): StoreStub {
	const calls = { get: [] as string[], list: 0, backend: 0 };
	const metas: LocalAssetMeta[] = entries.map((entry) => ({
		id: entry.id,
		mimeType: entry.mimeType ?? "image/png",
		byteSize: entry.bytes.byteLength,
		createdAt: 0,
		...(entry.name !== undefined ? { name: entry.name } : {}),
	}));
	const blobs = new Map(
		entries.map((entry) => [
			entry.id,
			new Blob([entry.bytes as unknown as BlobPart], {
				type: entry.mimeType ?? "image/png",
			}),
		]),
	);
	return {
		calls,
		async put() {
			throw new Error("not used");
		},
		async get(id) {
			calls.get.push(id);
			return blobs.get(id);
		},
		async delete() {
			/* the export path never deletes */
		},
		async list() {
			calls.list += 1;
			return metas.map((m) => ({ ...m }));
		},
		async has(id) {
			return blobs.has(id);
		},
		async usage() {
			return {
				count: metas.length,
				totalBytes: metas.reduce((sum, m) => sum + m.byteSize, 0),
				maxAssetBytes: 25 * 1024 * 1024,
				maxTotalBytes: 200 * 1024 * 1024,
			};
		},
		async clear() {
			/* the export path never clears */
		},
		async backend() {
			calls.backend += 1;
			return backend;
		},
		close() {
			/* nothing to release in a stub */
		},
	};
}

const HI = new Uint8Array([72, 105]); // base64 "SGk="

function assets(
	...refs: ReadonlyArray<[id: string, uri: string]>
): Record<string, CanvasAssetRef> {
	return Object.fromEntries(
		refs.map(([id, uri]) => [id, { id, uri, mimeType: "image/png" }]),
	);
}

describe("collectLocalAssetIds", () => {
	it("selects exactly the URIs no other machine can resolve", () => {
		expect(
			collectLocalAssetIds(
				assets(
					["a1", "blob:http://localhost/one"],
					["a2", "https://cdn.example.com/two.png"],
					["a3", "data:image/png;base64,SGk="],
					["a4", "filesystem:http://localhost/temporary/four"],
					["a5", "/relative/five.png"],
				),
			),
		).toEqual(["a1", "a4"]);
	});

	it("returns nothing for a document with no local assets", () => {
		expect(collectLocalAssetIds(assets(["a1", "https://x/y.png"]))).toEqual([]);
	});
});

describe("scanLocalAssets", () => {
	it("partitions stored from missing and totals only the stored bytes", async () => {
		const store = makeStore([
			{ id: "a1", bytes: new Uint8Array(1000) },
			{ id: "a2", bytes: new Uint8Array(2500) },
		]);
		const scan = await scanLocalAssets(
			assets(
				["a1", "blob:http://localhost/1"],
				["a2", "blob:http://localhost/2"],
				["gone", "blob:http://localhost/3"],
				["remote", "https://cdn.example.com/x.png"],
			),
			store,
		);
		expect(scan.stored.map((m) => m.id)).toEqual(["a1", "a2"]);
		expect(scan.missingIds).toEqual(["gone"]);
		expect(scan.totalBytes).toBe(3500);
		expect(scan.backend).toBe("indexeddb");
		// The cap decision reads NO blobs — one metadata-only `list()`.
		expect(store.calls.get).toEqual([]);
		expect(store.calls.list).toBe(1);
	});
});

describe("createLocalAssetSvgFetcher", () => {
	it("is undefined when nothing in the document is browser-local", () => {
		expect(
			createLocalAssetSvgFetcher(
				assets(["a1", "https://cdn.example.com/x.png"]),
			),
		).toBeUndefined();
	});

	it("resolves a store-backed URI to real bytes and the stored MIME type", async () => {
		const store = makeStore([
			{ id: "a1", bytes: HI, mimeType: "image/webp", name: "photo.webp" },
		]);
		const fetcher = createLocalAssetSvgFetcher(
			assets(["a1", "blob:http://localhost/one"]),
			store,
		);
		expect(fetcher).toBeDefined();
		const result = await fetcher?.("blob:http://localhost/one");
		expect(Array.from(result?.bytes ?? [])).toEqual([72, 105]);
		expect(result?.contentType).toBe("image/webp");
	});

	it("reads the metadata once no matter how many images it resolves", async () => {
		const store = makeStore([
			{ id: "a1", bytes: HI },
			{ id: "a2", bytes: HI },
		]);
		const fetcher = createLocalAssetSvgFetcher(
			assets(["a1", "blob:http://x/1"], ["a2", "blob:http://x/2"]),
			store,
		);
		await fetcher?.("blob:http://x/1");
		await fetcher?.("blob:http://x/2");
		expect(store.calls.list).toBe(1);
		expect(store.calls.get).toEqual(["a1", "a2"]);
	});

	it("opens nothing until an image actually asks for bytes", async () => {
		const store = makeStore([{ id: "a1", bytes: HI }]);
		createLocalAssetSvgFetcher(assets(["a1", "blob:http://x/1"]), store);
		expect(store.calls.list).toBe(0);
		expect(store.calls.backend).toBe(0);
	});

	it("rejects for a URI it does not know, so the serializer omits the image", async () => {
		const store = makeStore([{ id: "a1", bytes: HI }]);
		const fetcher = createLocalAssetSvgFetcher(
			assets(["a1", "blob:http://x/1"]),
			store,
		);
		await expect(fetcher?.("blob:http://x/other")).rejects.toThrow(
			/no browser-local asset is registered/i,
		);
	});

	it("rejects when the store no longer holds the bytes", async () => {
		const store = makeStore([]);
		const fetcher = createLocalAssetSvgFetcher(
			assets(["a1", "blob:http://x/1"]),
			store,
		);
		await expect(fetcher?.("blob:http://x/1")).rejects.toThrow(
			/no longer stored/i,
		);
	});
});

describe("inlineLocalAssetsForJson — under the cap", () => {
	it("rewrites local URIs to data URIs and leaves everything else alone", async () => {
		const store = makeStore([{ id: "a1", bytes: HI }]);
		const input = assets(
			["a1", "blob:http://localhost/one"],
			["a2", "https://cdn.example.com/two.png"],
		);
		const { assets: out, warnings } = await inlineLocalAssetsForJson(input, {
			maxInlineBytes: 1024,
			store,
		});
		expect(out.a1?.uri).toBe("data:image/png;base64,SGk=");
		expect(out.a2).toEqual(input.a2);
		// Only the URI changes — every other field of the ref survives.
		expect(out.a1?.mimeType).toBe("image/png");
		expect(warnings).toEqual([]);
		// The caller's map is never mutated: the rewrite lives in the artifact.
		expect(input.a1?.uri).toBe("blob:http://localhost/one");
	});

	it("uses the stored MIME type when the blob lost its own", async () => {
		const store = makeStore([
			{ id: "a1", bytes: HI, mimeType: "image/svg+xml" },
		]);
		// A blob whose `type` is empty — a drop from some desktop environments.
		const untyped = new Blob([HI as unknown as BlobPart]);
		store.get = async () => untyped;
		const { assets: out } = await inlineLocalAssetsForJson(
			assets(["a1", "blob:http://x/1"]),
			{ maxInlineBytes: 1024, store },
		);
		expect(out.a1?.uri).toBe("data:image/svg+xml;base64,SGk=");
	});

	it("warns MISSING_ASSET for a local URI the store does not hold, and inlines the rest", async () => {
		const store = makeStore([{ id: "a1", bytes: HI }]);
		const { assets: out, warnings } = await inlineLocalAssetsForJson(
			assets(["a1", "blob:http://x/1"], ["gone", "blob:http://x/2"]),
			{ maxInlineBytes: 1024, store },
		);
		expect(out.a1?.uri).toBe("data:image/png;base64,SGk=");
		expect(out.gone?.uri).toBe("blob:http://x/2");
		expect(warnings).toHaveLength(1);
		expect(warnings[0]?.code).toBe(LOCAL_ASSET_EXPORT_WARNING_CODES.missing);
		expect(warnings[0]?.message).toContain("gone");
	});

	it("degrades to a warning when a read fails between list() and get()", async () => {
		const store = makeStore([{ id: "a1", bytes: HI }]);
		store.get = async () => {
			throw new Error("quota");
		};
		const { assets: out, warnings } = await inlineLocalAssetsForJson(
			assets(["a1", "blob:http://x/1"]),
			{ maxInlineBytes: 1024, store },
		);
		expect(out.a1?.uri).toBe("blob:http://x/1");
		expect(warnings.map((w) => w.code)).toEqual([
			LOCAL_ASSET_EXPORT_WARNING_CODES.missing,
		]);
	});

	it("does not warn about a volatile store once the bytes are inlined", async () => {
		const store = makeStore([{ id: "a1", bytes: HI }], "memory");
		const { warnings } = await inlineLocalAssetsForJson(
			assets(["a1", "blob:http://x/1"]),
			{ maxInlineBytes: 1024, store },
		);
		// The artifact carries the bytes — it is portable regardless of what the
		// store is made of.
		expect(warnings).toEqual([]);
	});
});

describe("inlineLocalAssetsForJson — over the cap", () => {
	it("inlines nothing and names EVERY unportable asset", async () => {
		const store = makeStore([
			{ id: "a1", bytes: new Uint8Array(600), name: "hero.png" },
			{ id: "a2", bytes: new Uint8Array(600), name: "logo.png" },
		]);
		const input = assets(["a1", "blob:http://x/1"], ["a2", "blob:http://x/2"]);
		const { assets: out, warnings } = await inlineLocalAssetsForJson(input, {
			maxInlineBytes: 1000,
			store,
		});
		// Identity, not just equality: the caller skips rebuilding the IR.
		expect(out).toBe(input);
		expect(warnings).toHaveLength(2);
		for (const warning of warnings) {
			expect(warning.code).toBe(LOCAL_ASSET_EXPORT_WARNING_CODES.notPortable);
			expect(warning.level).toBe("warn");
			expect(warning.fallback).toBeTruthy();
		}
		// Each asset is NAMED — a count would not tell the user which image to
		// re-add.
		expect(warnings[0]?.message).toContain("hero.png");
		expect(warnings[0]?.message).toContain("a1");
		expect(warnings[1]?.message).toContain("logo.png");
		// The message states the total and the limit, which is the actionable part.
		expect(warnings[0]?.message).toContain("total 1 KB");
		expect(warnings[0]?.message).toContain("over the 1 KB limit");
		// No blob is ever read on the over-cap path.
		expect(store.calls.get).toEqual([]);
	});

	it("falls back to the bare id when the ingress path knew no file name", async () => {
		const store = makeStore([{ id: "a1", bytes: new Uint8Array(2000) }]);
		const { warnings } = await inlineLocalAssetsForJson(
			assets(["a1", "blob:http://x/1"]),
			{ maxInlineBytes: 1000, store },
		);
		expect(warnings[0]?.message).toContain('"a1"');
	});

	it("adds a volatile-store error when IndexedDB was unavailable", async () => {
		const store = makeStore(
			[{ id: "a1", bytes: new Uint8Array(2000) }],
			"memory",
		);
		const { warnings } = await inlineLocalAssetsForJson(
			assets(["a1", "blob:http://x/1"]),
			{ maxInlineBytes: 1000, store },
		);
		const volatileWarning = warnings.find(
			(w) => w.code === LOCAL_ASSET_EXPORT_WARNING_CODES.volatileStore,
		);
		expect(volatileWarning).toBeDefined();
		// Stronger than "another machine cannot open this": the bytes do not
		// survive a reload here either.
		expect(volatileWarning?.level).toBe("error");
		expect(volatileWarning?.message).toMatch(/gone after a reload/i);
		// Exactly one, no matter how many assets are affected.
		expect(
			warnings.filter(
				(w) => w.code === LOCAL_ASSET_EXPORT_WARNING_CODES.volatileStore,
			),
		).toHaveLength(1);
	});

	it("uses the total, not the per-asset size, to decide", async () => {
		// Two assets that each fit but together do not.
		const store = makeStore([
			{ id: "a1", bytes: new Uint8Array(600) },
			{ id: "a2", bytes: new Uint8Array(600) },
		]);
		const { warnings } = await inlineLocalAssetsForJson(
			assets(["a1", "blob:http://x/1"], ["a2", "blob:http://x/2"]),
			{ maxInlineBytes: 1000, store },
		);
		expect(warnings).toHaveLength(2);
	});
});

describe("the shared store is only reached when no store was injected", () => {
	beforeEach(() => {
		vi.resetModules();
	});

	it("never imports the store module for a document with no local assets", async () => {
		const getShared = vi.fn();
		vi.doMock("../local-asset-store.js", () => ({
			getSharedLocalAssetStore: getShared,
		}));
		const { createLocalAssetSvgFetcher: create } = await import(
			"../local-asset-export.js"
		);
		expect(
			create(assets(["a1", "https://cdn.example.com/x.png"])),
		).toBeUndefined();
		expect(getShared).not.toHaveBeenCalled();
		vi.doUnmock("../local-asset-store.js");
	});
});
