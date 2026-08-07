import {
	type CanvasIR,
	createCanvasIR,
	createPage,
} from "@anvilkit/canvas-core";
import { afterEach, describe, expect, it } from "vitest";
import type { CanvasToastInput } from "@/context/toast-context.js";
import { createUploadStore } from "@/stores/upload-store.js";
import { makeHarness } from "@/tools/__tests__/_tool-test-helpers.js";
import type {
	CanvasUploadedAsset,
	CanvasUploadProgressEvent,
} from "../adapter-types.js";
import {
	getSharedLocalAssetStore,
	isLocalAssetStoreError,
	type LocalAssetMeta,
	type LocalAssetStore,
	LocalAssetStoreError,
	resetSharedLocalAssetStore,
} from "../local-asset-store.js";
import {
	createLocalAssetUploader,
	readIntrinsicImageSize,
} from "../local-uploader.js";
import { uploadFilesImpl } from "../upload-actions.js";

/**
 * ## Why the store is mocked rather than faked
 *
 * The uploader depends on `LocalAssetStore`'s *contract*, not on IndexedDB —
 * `cp1-001`'s own suite already covers the backend, its degradation paths and
 * its caps against a hand-rolled IDB double. Mocking the interface here keeps
 * these tests about the thing under test (abort cleanup, progress, intrinsic
 * sizing) and lets a write be suspended mid-flight, which is the only way to
 * exercise a cancellation that lands *after* the bytes are stored.
 *
 * jsdom has no `createImageBitmap`, so raster sizing is driven through the
 * injectable `decodeImage` seam. SVG sizing needs no injection at all — it is
 * read from the file's own source — which is exactly why it is implemented
 * that way.
 */

interface MockStoreHooks {
	/** Runs inside `put` BEFORE the record lands. Reject to fail the write. */
	beforePut?: (id: string, blob: Blob) => void | Promise<void>;
	/** Runs inside `put` AFTER the record lands. Suspends the write when it awaits. */
	afterPut?: (id: string, blob: Blob) => void | Promise<void>;
}

interface MockStore extends LocalAssetStore {
	readonly blobs: Map<string, Blob>;
	readonly records: Map<string, LocalAssetMeta>;
	readonly deleted: string[];
}

function createMockStore(hooks: MockStoreHooks = {}): MockStore {
	const blobs = new Map<string, Blob>();
	const records = new Map<string, LocalAssetMeta>();
	const deleted: string[] = [];
	return {
		blobs,
		records,
		deleted,
		async put(id, blob, meta) {
			await hooks.beforePut?.(id, blob);
			const record: LocalAssetMeta = {
				id,
				mimeType: meta?.mimeType ?? (blob.type || "application/octet-stream"),
				byteSize: blob.size,
				createdAt: meta?.createdAt ?? 0,
				...(meta?.width !== undefined ? { width: meta.width } : {}),
				...(meta?.height !== undefined ? { height: meta.height } : {}),
				...(meta?.name !== undefined ? { name: meta.name } : {}),
			};
			blobs.set(id, blob);
			records.set(id, record);
			await hooks.afterPut?.(id, blob);
			return record;
		},
		async get(id) {
			return blobs.get(id);
		},
		async delete(id) {
			deleted.push(id);
			blobs.delete(id);
			records.delete(id);
		},
		async list() {
			return [...records.values()];
		},
		async has(id) {
			return records.has(id);
		},
		async usage() {
			let totalBytes = 0;
			for (const record of records.values()) totalBytes += record.byteSize;
			return {
				count: records.size,
				totalBytes,
				maxAssetBytes: Number.POSITIVE_INFINITY,
				maxTotalBytes: Number.POSITIVE_INFINITY,
			};
		},
		async clear() {
			blobs.clear();
			records.clear();
		},
		async backend() {
			return "memory";
		},
		close() {
			// Nothing to release in the mock.
		},
	};
}

function urlRecorder() {
	const minted: string[] = [];
	const revoked: string[] = [];
	return {
		minted,
		revoked,
		createObjectURL: (): string => {
			const url = `blob:mock/${minted.length + 1}`;
			minted.push(url);
			return url;
		},
		revokeObjectURL: (url: string): void => {
			revoked.push(url);
		},
	};
}

function stubDecoder(width: number, height: number) {
	const state = { calls: 0, closed: 0 };
	return {
		state,
		decode: async (): Promise<{
			width: number;
			height: number;
			close: () => void;
		}> => {
			state.calls += 1;
			return {
				width,
				height,
				close: () => {
					state.closed += 1;
				},
			};
		},
	};
}

function deferred<T = void>() {
	let settle: ((value: T) => void) | undefined;
	const promise = new Promise<T>((resolve) => {
		settle = resolve;
	});
	return {
		promise,
		resolve: (value: T) => {
			settle?.(value);
		},
	};
}

const PNG_BYTES = new Uint8Array(64);

const pngFile = (name = "photo.png"): File =>
	new File([PNG_BYTES], name, { type: "image/png" });

const jpegFile = (name = "photo.jpg"): File =>
	new File([PNG_BYTES], name, { type: "image/jpeg" });

const svgFile = (
	source: string,
	name = "logo.svg",
	type: string | undefined = "image/svg+xml",
): File => new File([source], name, type === undefined ? {} : { type });

const CONTEXT = { documentId: "doc-1" } as const;

afterEach(() => {
	resetSharedLocalAssetStore();
});

describe("createLocalAssetUploader — happy path (cp1-002)", () => {
	it("stores the file and returns a CanvasAssetRef-shaped asset", async () => {
		const store = createMockStore();
		const urls = urlRecorder();
		const decoder = stubDecoder(800, 600);
		const uploader = createLocalAssetUploader({
			store,
			createObjectURL: urls.createObjectURL,
			revokeObjectURL: urls.revokeObjectURL,
			decodeImage: decoder.decode,
		});

		const file = pngFile();
		const uploaded = await uploader.upload([file], CONTEXT);

		expect(uploaded).toHaveLength(1);
		const asset = uploaded[0] as CanvasUploadedAsset;
		expect(asset.uri).toBe("blob:mock/1");
		expect(asset.mimeType).toBe("image/png");
		expect(asset.width).toBe(800);
		expect(asset.height).toBe(600);
		expect(typeof asset.id).toBe("string");
		expect(asset.id.length).toBeGreaterThan(0);
		// The stored blob is the original File — no copy, no re-encode.
		expect(store.blobs.get(asset.id)).toBe(file);
		// Dimensions persist so cp1-005 can rehydrate without decoding again.
		expect(store.records.get(asset.id)).toMatchObject({
			mimeType: "image/png",
			width: 800,
			height: 600,
			name: "photo.png",
			byteSize: file.size,
		});
		// A decoded surface is ~4 bytes/pixel; it must not be left to the GC.
		expect(decoder.state.closed).toBe(1);
		expect(urls.revoked).toEqual([]);
	});

	it("mints one distinct id and uri per file in a batch", async () => {
		const store = createMockStore();
		const urls = urlRecorder();
		const uploader = createLocalAssetUploader({
			store,
			createObjectURL: urls.createObjectURL,
			revokeObjectURL: urls.revokeObjectURL,
			decodeImage: null,
		});

		const uploaded = await uploader.upload(
			[pngFile("a.png"), pngFile("b.png")],
			CONTEXT,
		);

		expect(uploaded).toHaveLength(2);
		expect(new Set(uploaded.map((a) => a.id)).size).toBe(2);
		expect(uploaded.map((a) => a.uri)).toEqual(["blob:mock/1", "blob:mock/2"]);
		expect(store.blobs.size).toBe(2);
	});

	it("returns an empty result and emits no progress for an empty batch", async () => {
		const store = createMockStore();
		const events: CanvasUploadProgressEvent[] = [];
		const uploader = createLocalAssetUploader({ store, decodeImage: null });

		await expect(
			uploader.upload([], { ...CONTEXT, onProgress: (e) => events.push(e) }),
		).resolves.toEqual([]);
		expect(events).toEqual([]);
		expect(store.blobs.size).toBe(0);
	});

	it("defaults to the shared local asset store", async () => {
		// Configure the shared instance before the uploader resolves it, so the
		// degradation warning stays out of the test output.
		const shared = getSharedLocalAssetStore({
			indexedDB: null,
			warn: () => undefined,
		});
		const urls = urlRecorder();
		const uploader = createLocalAssetUploader({
			createObjectURL: urls.createObjectURL,
			decodeImage: null,
		});

		const uploaded = await uploader.upload([pngFile()], CONTEXT);
		const asset = uploaded[0] as CanvasUploadedAsset;

		expect(await shared.has(asset.id)).toBe(true);
		expect(await shared.get(asset.id)).toBeInstanceOf(Blob);
	});
});

describe("createLocalAssetUploader — progress (FR-091)", () => {
	it("emits monotonic determinate ticks that terminate at 1", async () => {
		const events: CanvasUploadProgressEvent[] = [];
		const uploader = createLocalAssetUploader({
			store: createMockStore(),
			createObjectURL: urlRecorder().createObjectURL,
			decodeImage: stubDecoder(10, 10).decode,
		});

		await uploader.upload([pngFile()], {
			...CONTEXT,
			onProgress: (event) => events.push(event),
		});

		expect(events.length).toBeGreaterThanOrEqual(3);
		expect(events.every((e) => e.fileIndex === 0)).toBe(true);
		// Never indeterminate: `fraction` is the contract's "I can measure this"
		// signal and a local write can.
		expect(events.every((e) => typeof e.fraction === "number")).toBe(true);
		const fractions = events.map((e) => e.fraction ?? Number.NaN);
		for (const [index, fraction] of fractions.entries()) {
			if (index === 0) continue;
			expect(fraction).toBeGreaterThan(fractions[index - 1] ?? Number.NaN);
		}
		expect(fractions[0]).toBeGreaterThan(0);
		expect(fractions.at(-1)).toBe(1);
	});

	it("keeps each file's ticks monotonic and complete across a batch", async () => {
		const events: CanvasUploadProgressEvent[] = [];
		const uploader = createLocalAssetUploader({
			store: createMockStore(),
			createObjectURL: urlRecorder().createObjectURL,
			decodeImage: null,
		});

		await uploader.upload([pngFile("a.png"), pngFile("b.png")], {
			...CONTEXT,
			onProgress: (event) => events.push(event),
		});

		for (const fileIndex of [0, 1]) {
			const fractions = events
				.filter((e) => e.fileIndex === fileIndex)
				.map((e) => e.fraction ?? Number.NaN);
			expect(fractions.length).toBeGreaterThanOrEqual(3);
			expect(fractions.at(-1)).toBe(1);
			for (const [index, fraction] of fractions.entries()) {
				if (index === 0) continue;
				expect(fraction).toBeGreaterThan(fractions[index - 1] ?? Number.NaN);
			}
		}
	});

	it("survives a progress listener that throws", async () => {
		const store = createMockStore();
		const uploader = createLocalAssetUploader({
			store,
			createObjectURL: urlRecorder().createObjectURL,
			decodeImage: null,
		});

		await expect(
			uploader.upload([pngFile()], {
				...CONTEXT,
				onProgress: () => {
					throw new Error("host listener blew up");
				},
			}),
		).resolves.toHaveLength(1);
		expect(store.blobs.size).toBe(1);
	});
});

describe("createLocalAssetUploader — cancellation (FR-092)", () => {
	it("stores nothing when the signal is already aborted", async () => {
		const store = createMockStore();
		const urls = urlRecorder();
		const controller = new AbortController();
		controller.abort();
		const uploader = createLocalAssetUploader({
			store,
			createObjectURL: urls.createObjectURL,
			decodeImage: null,
		});

		const error = await uploader
			.upload([pngFile()], { ...CONTEXT, signal: controller.signal })
			.then(
				() => undefined,
				(reason: unknown) => reason,
			);

		// The same shape a fetch-based host uploader rejects with, so the
		// editor's `signal.aborted` check reads it as a cancel, not a failure.
		expect((error as DOMException | undefined)?.name).toBe("AbortError");
		expect(store.blobs.size).toBe(0);
		expect(store.deleted).toEqual([]);
		expect(urls.minted).toEqual([]);
	});

	it("rejects with the caller's own abort reason", async () => {
		const controller = new AbortController();
		const reason = new Error("user cancelled the task");
		controller.abort(reason);
		const uploader = createLocalAssetUploader({
			store: createMockStore(),
			createObjectURL: urlRecorder().createObjectURL,
			decodeImage: null,
		});

		await expect(
			uploader.upload([pngFile()], { ...CONTEXT, signal: controller.signal }),
		).rejects.toBe(reason);
	});

	it("stores nothing when the abort lands during the intrinsic-size probe", async () => {
		const store = createMockStore();
		const urls = urlRecorder();
		const controller = new AbortController();
		const uploader = createLocalAssetUploader({
			store,
			createObjectURL: urls.createObjectURL,
			revokeObjectURL: urls.revokeObjectURL,
			decodeImage: async () => {
				controller.abort();
				return { width: 10, height: 10 };
			},
		});

		await expect(
			uploader.upload([pngFile()], { ...CONTEXT, signal: controller.signal }),
		).rejects.toThrow();
		expect(store.blobs.size).toBe(0);
		expect(urls.minted).toEqual([]);
	});

	it("deletes the blob when the abort lands AFTER the write (no orphan)", async () => {
		const controller = new AbortController();
		const store = createMockStore({
			afterPut: () => {
				controller.abort();
			},
		});
		const urls = urlRecorder();
		const uploader = createLocalAssetUploader({
			store,
			createObjectURL: urls.createObjectURL,
			revokeObjectURL: urls.revokeObjectURL,
			decodeImage: null,
		});

		await expect(
			uploader.upload([pngFile()], { ...CONTEXT, signal: controller.signal }),
		).rejects.toThrow();

		// The write DID land; the point of the check after it is that the bytes
		// get cleaned up rather than stranded with nothing referencing them.
		expect(store.deleted).toHaveLength(1);
		expect(store.blobs.size).toBe(0);
		expect(store.records.size).toBe(0);
		expect(urls.minted).toEqual([]);
	});

	it("revokes the object URL when the abort lands after it was minted", async () => {
		const controller = new AbortController();
		const store = createMockStore();
		const urls = urlRecorder();
		const uploader = createLocalAssetUploader({
			store,
			createObjectURL: () => {
				controller.abort();
				return urls.createObjectURL();
			},
			revokeObjectURL: urls.revokeObjectURL,
			decodeImage: null,
		});

		await expect(
			uploader.upload([pngFile()], { ...CONTEXT, signal: controller.signal }),
		).rejects.toThrow();

		expect(urls.minted).toEqual(["blob:mock/1"]);
		expect(urls.revoked).toEqual(["blob:mock/1"]);
		expect(store.blobs.size).toBe(0);
	});

	it("rolls back earlier files when a later one is cancelled", async () => {
		const controller = new AbortController();
		const store = createMockStore({
			afterPut: (_id, blob) => {
				if ((blob as File).name === "b.png") controller.abort();
			},
		});
		const urls = urlRecorder();
		const uploader = createLocalAssetUploader({
			store,
			createObjectURL: urls.createObjectURL,
			revokeObjectURL: urls.revokeObjectURL,
			decodeImage: null,
		});

		await expect(
			uploader.upload([pngFile("a.png"), pngFile("b.png"), pngFile("c.png")], {
				...CONTEXT,
				signal: controller.signal,
			}),
		).rejects.toThrow();

		// Both writes are undone, and the first file's URL is revoked.
		expect(store.deleted).toHaveLength(2);
		expect(store.blobs.size).toBe(0);
		expect(urls.minted).toEqual(["blob:mock/1"]);
		expect(urls.revoked).toEqual(["blob:mock/1"]);
	});
});

describe("createLocalAssetUploader — store errors", () => {
	it("propagates a store-full breach unchanged and leaves nothing behind", async () => {
		const failure = new LocalAssetStoreError({
			code: "store-full",
			assetId: "whatever",
			byteSize: 4096,
			limitBytes: 1024,
			message: "local asset limit reached",
		});
		const store = createMockStore({
			beforePut: () => Promise.reject(failure),
		});
		const urls = urlRecorder();
		const uploader = createLocalAssetUploader({
			store,
			createObjectURL: urls.createObjectURL,
			revokeObjectURL: urls.revokeObjectURL,
			decodeImage: null,
		});

		const error = await uploader.upload([pngFile()], CONTEXT).then(
			() => undefined,
			(reason: unknown) => reason,
		);

		// Still narrowable downstream, and still carries the actionable code.
		expect(isLocalAssetStoreError(error)).toBe(true);
		expect((error as LocalAssetStoreError).code).toBe("store-full");
		expect(store.blobs.size).toBe(0);
		expect(urls.minted).toEqual([]);
	});

	it("rolls back an earlier file when a later one exceeds the cap", async () => {
		const store = createMockStore({
			beforePut: (_id, blob) => {
				if ((blob as File).name !== "big.png") return;
				return Promise.reject(
					new LocalAssetStoreError({
						code: "store-full",
						assetId: "big",
						byteSize: 4096,
						limitBytes: 1024,
						message: "local asset limit reached",
					}),
				);
			},
		});
		const urls = urlRecorder();
		const uploader = createLocalAssetUploader({
			store,
			createObjectURL: urls.createObjectURL,
			revokeObjectURL: urls.revokeObjectURL,
			decodeImage: null,
		});

		await expect(
			uploader.upload([pngFile("small.png"), pngFile("big.png")], CONTEXT),
		).rejects.toSatisfy(isLocalAssetStoreError);

		expect(store.blobs.size).toBe(0);
		expect(store.deleted).toHaveLength(1);
		expect(urls.revoked).toEqual(["blob:mock/1"]);
	});
});

describe("readIntrinsicImageSize — raster", () => {
	it("reads PNG dimensions from the decoder", async () => {
		const decoder = stubDecoder(1200, 900);
		await expect(
			readIntrinsicImageSize(pngFile(), { decodeImage: decoder.decode }),
		).resolves.toEqual({ width: 1200, height: 900 });
		expect(decoder.state.calls).toBe(1);
	});

	it("reads JPEG dimensions from the decoder", async () => {
		const decoder = stubDecoder(4032, 3024);
		await expect(
			readIntrinsicImageSize(jpegFile(), { decodeImage: decoder.decode }),
		).resolves.toEqual({ width: 4032, height: 3024 });
	});

	it("returns undefined — never throws — when the decoder rejects", async () => {
		await expect(
			readIntrinsicImageSize(pngFile(), {
				decodeImage: () => Promise.reject(new Error("unsupported")),
			}),
		).resolves.toBeUndefined();
	});

	it("returns undefined when no decoder exists (jsdom, SSR)", async () => {
		await expect(
			readIntrinsicImageSize(pngFile(), { decodeImage: null }),
		).resolves.toBeUndefined();
	});

	it("does not probe a non-image blob at all", async () => {
		const decoder = stubDecoder(10, 10);
		const pdf = new File([PNG_BYTES], "spec.pdf", { type: "application/pdf" });
		await expect(
			readIntrinsicImageSize(pdf, { decodeImage: decoder.decode }),
		).resolves.toBeUndefined();
		expect(decoder.state.calls).toBe(0);
	});
});

describe("readIntrinsicImageSize — SVG", () => {
	it("reads absolute width/height attributes", async () => {
		const svg = svgFile(
			'<?xml version="1.0"?><svg xmlns="http://www.w3.org/2000/svg" width="320" height="240"><rect/></svg>',
		);
		await expect(
			readIntrinsicImageSize(svg, { decodeImage: null }),
		).resolves.toEqual({ width: 320, height: 240 });
	});

	it("falls back to the viewBox when width/height are absent", async () => {
		const svg = svgFile(
			"<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 640 480'></svg>",
		);
		await expect(
			readIntrinsicImageSize(svg, { decodeImage: null }),
		).resolves.toEqual({ width: 640, height: 480 });
	});

	it("ignores percentage lengths and uses the viewBox instead", async () => {
		// The commonest exported-SVG shape: responsive width, intrinsic viewBox.
		const svg = svgFile(
			'<svg width="100%" height="100%" viewBox="0 0 512 256"></svg>',
		);
		await expect(
			readIntrinsicImageSize(svg, { decodeImage: null }),
		).resolves.toEqual({ width: 512, height: 256 });
	});

	it("converts absolute units and derives the missing axis from the viewBox", async () => {
		// 64pt = 85.33px; viewBox aspect 2:1 makes the height 42.67px.
		const svg = svgFile('<svg width="64pt" viewBox="0 0 32 16"></svg>');
		await expect(
			readIntrinsicImageSize(svg, { decodeImage: null }),
		).resolves.toEqual({ width: 85, height: 43 });
	});

	it("prefers the source over the decoder (Firefox rejects SVG bitmaps)", async () => {
		const decoder = stubDecoder(1, 1);
		const svg = svgFile('<svg width="48" height="24"></svg>');
		await expect(
			readIntrinsicImageSize(svg, { decodeImage: decoder.decode }),
		).resolves.toEqual({ width: 48, height: 24 });
		expect(decoder.state.calls).toBe(0);
	});

	it("falls back to the decoder when the source yields no size", async () => {
		const decoder = stubDecoder(96, 96);
		const svg = svgFile("<svg xmlns='http://www.w3.org/2000/svg'></svg>");
		await expect(
			readIntrinsicImageSize(svg, { decodeImage: decoder.decode }),
		).resolves.toEqual({ width: 96, height: 96 });
		expect(decoder.state.calls).toBe(1);
	});

	it("returns undefined for a file that is not SVG at all", async () => {
		const svg = svgFile("not markup, just text");
		await expect(
			readIntrinsicImageSize(svg, { decodeImage: null }),
		).resolves.toBeUndefined();
	});

	it("recognises SVG by extension when the File carries no type", async () => {
		const store = createMockStore();
		const uploader = createLocalAssetUploader({
			store,
			createObjectURL: urlRecorder().createObjectURL,
			decodeImage: null,
		});

		const typeless = svgFile(
			'<svg width="200" height="100"></svg>',
			"mark.svg",
			undefined,
		);
		const uploaded = await uploader.upload([typeless], CONTEXT);
		const asset = uploaded[0] as CanvasUploadedAsset;

		expect(asset.mimeType).toBe("image/svg+xml");
		expect(asset.width).toBe(200);
		expect(asset.height).toBe(100);
	});

	it("leaves mimeType unset rather than guessing application/octet-stream", async () => {
		const store = createMockStore();
		const uploader = createLocalAssetUploader({
			store,
			createObjectURL: urlRecorder().createObjectURL,
			decodeImage: null,
		});

		const unknown = new File([PNG_BYTES], "notes", {});
		const uploaded = await uploader.upload([unknown], CONTEXT);
		const asset = uploaded[0] as CanvasUploadedAsset;

		// CanvasNodeRenderer classifies a load failure on a KNOWN-bad MIME as
		// "unsupported format"; an invented type would misdiagnose it.
		expect(Object.hasOwn(asset, "mimeType")).toBe(false);
		expect(asset.width).toBeUndefined();
		expect(store.blobs.size).toBe(1);
	});
});

/**
 * The acceptance bar is "indistinguishable from a host uploader from the
 * editor's perspective", so these drive the real `uploadFilesImpl` action with
 * the default uploader plugged in exactly where a host adapter goes. No
 * wiring is touched — `cp1-004` owns that.
 */
describe("createLocalAssetUploader — through the editor's upload flow", () => {
	const FIXED_TS = "2026-05-20T00:00:00.000Z";

	const fixtureIR = (): CanvasIR =>
		createCanvasIR({
			id: "doc-1",
			pages: [createPage({ id: "p1", size: { width: 800, height: 600 } })],
			now: () => FIXED_TS,
		});

	function setup(store: LocalAssetStore, urls: ReturnType<typeof urlRecorder>) {
		const h = makeHarness({ ir: fixtureIR() });
		const uploadStore = createUploadStore();
		h.studioCtx.uploadStore = uploadStore;
		h.studioCtx.assetUploader = createLocalAssetUploader({
			store,
			createObjectURL: urls.createObjectURL,
			revokeObjectURL: urls.revokeObjectURL,
			decodeImage: stubDecoder(640, 320).decode,
		});
		const toasts: CanvasToastInput[] = [];
		return {
			h,
			uploadStore,
			toasts,
			toaster: { add: (input: CanvasToastInput) => toasts.push(input) },
		};
	}

	it("creates an asset entry and a correctly sized node", async () => {
		const store = createMockStore();
		const urls = urlRecorder();
		const { h, uploadStore, toasts, toaster } = setup(store, urls);

		const ids = await uploadFilesImpl(
			h.studioCtx,
			[pngFile()],
			undefined,
			toaster,
		);

		expect(ids).toHaveLength(1);
		const put = h.commits.find((c) => c.type === "asset.put");
		expect(put).toMatchObject({
			asset: {
				uri: "blob:mock/1",
				mimeType: "image/png",
				width: 640,
				height: 320,
			},
		});
		const created = h.commits.find((c) => c.type === "node.create");
		// Intrinsic size, not the 240x180 default in buildAssetInsertCommands.
		expect(created).toMatchObject({
			node: { bounds: { width: 640, height: 320 } },
		});
		expect(uploadStore.getState().tasks[0]?.status).toBe("done");
		expect(uploadStore.getState().tasks[0]?.progress).toBeUndefined();
		expect(toasts).toEqual([]);
	});

	it("cancelling mid-write leaves no stored blob, no asset entry and no error toast", async () => {
		const started = deferred();
		const gate = deferred();
		const store = createMockStore({
			afterPut: async () => {
				started.resolve();
				await gate.promise;
			},
		});
		const urls = urlRecorder();
		const { h, uploadStore, toasts, toaster } = setup(store, urls);

		const pending = uploadFilesImpl(
			h.studioCtx,
			[pngFile()],
			undefined,
			toaster,
		);
		await started.promise;
		const task = uploadStore.getState().tasks[0];
		if (!task) throw new Error("no upload task");
		uploadStore.getState().cancel(task.id);
		gate.resolve();

		await expect(pending).resolves.toEqual([]);
		expect(store.blobs.size).toBe(0);
		expect(store.deleted).toHaveLength(1);
		expect(h.commits).toEqual([]);
		expect(uploadStore.getState().tasks[0]?.status).toBe("cancelled");
		// A cancel is not a failure: no "Upload failed" toast.
		expect(toasts).toEqual([]);
	});

	it("reports determinate progress into the upload store", async () => {
		const gate = deferred();
		const started = deferred();
		const store = createMockStore({
			afterPut: async () => {
				started.resolve();
				await gate.promise;
			},
		});
		const urls = urlRecorder();
		const { h, uploadStore, toaster } = setup(store, urls);

		const pending = uploadFilesImpl(
			h.studioCtx,
			[pngFile()],
			undefined,
			toaster,
		);
		await started.promise;
		const progress = uploadStore.getState().tasks[0]?.progress;
		expect(progress).toBeGreaterThan(0);
		expect(progress).toBeLessThan(1);
		gate.resolve();
		await pending;
	});
});
