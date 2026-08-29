import type { CanvasAssetRef } from "@anvilkit/canvas-core";
import { describe, expect, it, vi } from "vitest";
import {
	type CanvasAssetResolver,
	resolveEffectiveAssetTable,
} from "../effective-asset-resolver.js";

const documentAssets: Record<string, CanvasAssetRef> = {
	photo: {
		id: "photo",
		uri: "blob:https://old.example/photo",
		mimeType: "image/png",
		width: 1200,
		height: 800,
	},
};

function resolver(
	result: Awaited<ReturnType<CanvasAssetResolver["resolve"]>>,
): CanvasAssetResolver & { resolve: ReturnType<typeof vi.fn> } {
	return { resolve: vi.fn().mockResolvedValue(result) };
}

describe("resolveEffectiveAssetTable", () => {
	it("uses a live in-memory upload first and preserves document metadata", async () => {
		const indexedDbResolver = resolver({
			status: "ready",
			asset: { id: "photo", uri: "blob:indexeddb" },
		});
		const hostResolver = resolver({
			status: "ready",
			asset: { id: "photo", uri: "https://cdn.example.com/photo.png" },
		});
		const table = await resolveEffectiveAssetTable({
			documentId: "doc-1",
			documentAssets,
			memoryAssets: {
				photo: { id: "wrong-id", uri: "blob:live-upload" },
			},
			indexedDbResolver,
			hostResolver,
		});

		expect(table.assets.photo).toEqual({
			...documentAssets.photo,
			id: "photo",
			uri: "blob:live-upload",
		});
		expect(table.entries.photo?.source).toBe("memory");
		expect(indexedDbResolver.resolve).not.toHaveBeenCalled();
		expect(hostResolver.resolve).not.toHaveBeenCalled();
	});

	it("resolves browser-local bytes before consulting the host", async () => {
		const release = vi.fn();
		const indexedDbResolver = resolver({
			status: "ready",
			asset: { id: "photo", uri: "blob:rehydrated" },
			release,
		});
		const hostResolver = resolver({
			status: "ready",
			asset: { id: "photo", uri: "https://cdn.example.com/photo.png" },
		});
		const table = await resolveEffectiveAssetTable({
			documentId: "doc-1",
			documentAssets,
			indexedDbResolver,
			hostResolver,
		});

		expect(table.assets.photo?.uri).toBe("blob:rehydrated");
		expect(table.entries.photo?.source).toBe("indexeddb");
		expect(hostResolver.resolve).not.toHaveBeenCalled();
		table.dispose();
		table.dispose();
		expect(release).toHaveBeenCalledTimes(1);
	});

	it("falls through a missing IndexedDB record to a host asset", async () => {
		const table = await resolveEffectiveAssetTable({
			documentId: "doc-1",
			documentAssets,
			indexedDbResolver: resolver({ status: "missing" }),
			hostResolver: resolver({
				status: "ready",
				asset: { id: "host-photo", uri: "https://cdn.example.com/fresh.png" },
			}),
		});

		expect(table.assets.photo?.uri).toBe("https://cdn.example.com/fresh.png");
		expect(table.assets.photo?.id).toBe("photo");
		expect(table.entries.photo?.source).toBe("host");
	});

	it("uses portable document URLs without requiring an adapter", async () => {
		const table = await resolveEffectiveAssetTable({
			documentId: "doc-1",
			documentAssets: {
				remote: {
					id: "remote",
					uri: "https://cdn.example.com/remote.png",
				},
				embedded: {
					id: "embedded",
					uri: "data:image/png;base64,SGk=",
				},
			},
		});

		expect(table.entries.remote?.source).toBe("remote");
		expect(table.entries.embedded?.source).toBe("embedded");
		expect(Object.keys(table.assets)).toEqual(["remote", "embedded"]);
	});

	it("omits a dead local reference from the effective table", async () => {
		const table = await resolveEffectiveAssetTable({
			documentId: "doc-1",
			documentAssets,
			indexedDbResolver: resolver({ status: "missing" }),
		});

		expect(table.assets.photo).toBeUndefined();
		expect(table.entries.photo).toMatchObject({
			source: "indexeddb",
			status: "missing",
		});
	});

	it("keeps an authoritative host failure instead of using a stale remote URI", async () => {
		const remoteAssets = {
			photo: {
				id: "photo",
				uri: "https://signed.example.com/expired.png",
			},
		};
		const table = await resolveEffectiveAssetTable({
			documentId: "doc-1",
			documentAssets: remoteAssets,
			hostResolver: resolver({
				status: "unauthorized",
				message: "Sign in to refresh this asset.",
			}),
		});

		expect(table.assets.photo).toBeUndefined();
		expect(table.entries.photo).toMatchObject({
			source: "host",
			status: "unauthorized",
			message: "Sign in to refresh this asset.",
		});
	});

	it("isolates resolver exceptions as unavailable asset health", async () => {
		const unavailable: CanvasAssetResolver = {
			resolve: vi.fn().mockRejectedValue(new Error("IndexedDB is blocked")),
		};
		const table = await resolveEffectiveAssetTable({
			documentId: "doc-1",
			documentAssets,
			indexedDbResolver: unavailable,
		});

		expect(table.entries.photo).toMatchObject({
			source: "indexeddb",
			status: "unavailable",
			message: "IndexedDB is blocked",
		});
	});

	it("releases completed and late resolver resources when resolution is aborted", async () => {
		const controller = new AbortController();
		const releaseFast = vi.fn();
		const releaseLate = vi.fn();
		let finishLate: (() => void) | undefined;
		const indexedDbResolver: CanvasAssetResolver = {
			resolve: vi.fn((asset) => {
				if (asset.id === "fast") {
					return Promise.resolve({
						status: "ready" as const,
						asset: { id: "fast", uri: "blob:fast" },
						release: releaseFast,
					});
				}
				return new Promise((resolve) => {
					finishLate = () =>
						resolve({
							status: "ready",
							asset: { id: "late", uri: "blob:late" },
							release: releaseLate,
						});
				});
			}),
		};
		const resolution = resolveEffectiveAssetTable({
			documentId: "doc-1",
			documentAssets: {
				fast: { id: "fast", uri: "blob:old-fast" },
				late: { id: "late", uri: "blob:old-late" },
			},
			indexedDbResolver,
			signal: controller.signal,
		});
		await Promise.resolve();
		controller.abort();
		finishLate?.();

		await expect(resolution).rejects.toMatchObject({ name: "AbortError" });
		expect(releaseFast).toHaveBeenCalledTimes(1);
		expect(releaseLate).toHaveBeenCalledTimes(1);
	});
});
