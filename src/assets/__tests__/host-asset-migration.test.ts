import {
	type CanvasAssetRef,
	type CanvasCommand,
	type CanvasIR,
	createCanvasIR,
	createImage,
	createPage,
} from "@anvilkit/canvas-core";
import { describe, expect, it, vi } from "vitest";
import { createHistoryStore } from "../../stores/history-store.js";
import type { CanvasAssetUploader } from "../adapter-types.js";
import type { CanvasEffectiveAssetEntry } from "../effective-asset-resolver.js";
import {
	type CanvasAssetMigrationDocumentPort,
	migrateCanvasAssetsForSharing,
} from "../host-asset-migration.js";
import type { LocalAssetMeta, LocalAssetStore } from "../local-asset-store.js";

const NOW = "2026-08-28T00:00:00.000Z";

function fixture(ids: readonly string[]): {
	ir: CanvasIR;
	entries: Record<string, CanvasEffectiveAssetEntry>;
} {
	const page = createPage({ id: "page" });
	page.root.children = ids.map((id) => ({
		...createImage({
			id: `node-${id}`,
			assetId: id,
			bounds: { width: 10, height: 10 },
		}),
		locked: true,
	}));
	const ir = createCanvasIR({ id: "document", pages: [page], now: () => NOW });
	const entries: Record<string, CanvasEffectiveAssetEntry> = {};
	for (const id of ids) {
		const asset: CanvasAssetRef = {
			id,
			uri: `blob:https://canvas/${id}`,
			mimeType: "image/png",
		};
		ir.assets[id] = asset;
		entries[id] = {
			id,
			source: "indexeddb",
			status: "ready",
			documentAsset: asset,
			asset: { ...asset, uri: `blob:https://rehydrated/${id}` },
		};
	}
	return { ir, entries };
}

function localStore(ids: readonly string[]): LocalAssetStore {
	const blobs = new Map(
		ids.map((id) => [id, new Blob([`bytes-${id}`], { type: "image/png" })]),
	);
	const metas: LocalAssetMeta[] = ids.map((id) => ({
		id,
		name: id,
		mimeType: "image/png",
		byteSize: blobs.get(id)?.size ?? 0,
		createdAt: 0,
	}));
	return {
		async put() {
			throw new Error("not used");
		},
		async get(id) {
			return blobs.get(id);
		},
		async delete() {
			/* migration never deletes local bytes; Undo may need them */
		},
		async list() {
			return metas;
		},
		async has(id) {
			return blobs.has(id);
		},
		async usage() {
			return {
				count: blobs.size,
				totalBytes: [...blobs.values()].reduce(
					(total, blob) => total + blob.size,
					0,
				),
				maxAssetBytes: 1_000_000,
				maxTotalBytes: 10_000_000,
			};
		},
		async clear() {
			/* migration never clears local storage */
		},
		async backend() {
			return "indexeddb";
		},
		close() {
			/* injected stores are owned by the test/host */
		},
	};
}

function documentPort(initial: CanvasIR) {
	const history = createHistoryStore({ enforceLocked: true });
	let current = initial;
	const port: CanvasAssetMigrationDocumentPort = {
		getIR: () => current,
		commitBatch(commands: readonly CanvasCommand[], label?: string) {
			current = history.getState().commitBatch(current, commands, label);
			return current;
		},
	};
	return {
		port,
		history,
		current: () => current,
		undo() {
			current = history.getState().undo(current);
			return current;
		},
	};
}

describe("migrateCanvasAssetsForSharing", () => {
	it("uploads local bytes and replaces all references as one undo entry", async () => {
		const { ir, entries } = fixture(["photo"]);
		const doc = documentPort(ir);
		const uploader: CanvasAssetUploader = {
			upload: vi.fn(async () => [
				{
					id: "host-photo",
					uri: "https://cdn.example.com/host-photo.png",
				},
			]),
		};
		const result = await migrateCanvasAssetsForSharing({
			document: doc.port,
			entries,
			uploader,
			store: localStore(["photo"]),
		});

		expect(result).toMatchObject({
			status: "migrated",
			migratedAssetIds: ["photo"],
		});
		expect(doc.current().assets.photo).toBeUndefined();
		expect(doc.current().assets["host-photo"]?.uri).toContain(
			"cdn.example.com",
		);
		expect(doc.current().pages[0]?.root.children[0]).toMatchObject({
			assetId: "host-photo",
			locked: true,
		});
		expect(doc.history.getState().past).toHaveLength(1);

		const restored = doc.undo();
		expect(restored.assets.photo?.uri).toContain("blob:");
		expect(restored.assets["host-photo"]).toBeUndefined();
		expect(restored.pages[0]?.root.children[0]).toMatchObject({
			assetId: "photo",
		});
	});

	it("preserves the design on partial failure and resumes without re-uploading successes", async () => {
		const { ir, entries } = fixture(["a", "b"]);
		const doc = documentPort(ir);
		let failB = true;
		const uploadedNames: string[] = [];
		const uploader: CanvasAssetUploader = {
			upload: vi.fn(async ([file]) => {
				const name = file?.name ?? "unknown";
				uploadedNames.push(name);
				if (name === "b" && failB) throw new Error("network offline");
				return [
					{
						id: `host-${name}`,
						uri: `https://cdn.example.com/${name}.png`,
					},
				];
			}),
		};
		const store = localStore(["a", "b"]);
		const first = await migrateCanvasAssetsForSharing({
			document: doc.port,
			entries,
			uploader,
			store,
		});

		expect(first.status).toBe("blocked");
		if (first.status !== "blocked") throw new Error("expected blocked result");
		expect(first.unresolvedAssets).toMatchObject([
			{ assetId: "b", reason: "upload-failed", retryable: true },
		]);
		expect(first.retryState?.uploadedAssets.a?.id).toBe("host-a");
		expect(doc.current()).toBe(ir);
		expect(doc.history.getState().past).toHaveLength(0);

		failB = false;
		const second = await migrateCanvasAssetsForSharing({
			document: doc.port,
			entries,
			uploader,
			store,
			retryState: first.retryState,
		});
		expect(second.status).toBe("migrated");
		expect(uploadedNames).toEqual(["a", "b", "b"]);
		expect(doc.history.getState().past).toHaveLength(1);
		expect(doc.current().assets).toMatchObject({
			"host-a": { uri: "https://cdn.example.com/a.png" },
			"host-b": { uri: "https://cdn.example.com/b.png" },
		});
	});

	it("blocks with the exact local asset list when no host uploader exists", async () => {
		const { ir, entries } = fixture(["a", "b"]);
		const doc = documentPort(ir);
		const result = await migrateCanvasAssetsForSharing({
			document: doc.port,
			entries,
			store: localStore(["a", "b"]),
		});
		expect(result).toMatchObject({
			status: "blocked",
			unresolvedAssets: [
				{ assetId: "a", reason: "no-uploader", replaceable: true },
				{ assetId: "b", reason: "no-uploader", replaceable: true },
			],
		});
		expect(doc.current()).toBe(ir);
	});

	it("blocks a missing IndexedDB record without uploading or mutating", async () => {
		const { ir, entries } = fixture(["missing"]);
		const doc = documentPort(ir);
		const uploader: CanvasAssetUploader = { upload: vi.fn(async () => []) };
		const result = await migrateCanvasAssetsForSharing({
			document: doc.port,
			entries,
			uploader,
			store: localStore([]),
		});
		expect(result).toMatchObject({
			status: "blocked",
			unresolvedAssets: [
				{
					assetId: "missing",
					reason: "missing-local-bytes",
					replaceable: true,
				},
			],
		});
		expect(uploader.upload).not.toHaveBeenCalled();
		expect(doc.current()).toBe(ir);
	});
});
