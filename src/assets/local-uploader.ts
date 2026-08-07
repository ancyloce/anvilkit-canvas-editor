/**
 * @file cp1-002 (PLAN-0035 §5 P1) — the default {@link CanvasAssetUploader},
 * implemented against `cp1-001`'s browser-local blob store. This module
 * **implements** the existing adapter contract in `adapter-types.ts`; it does
 * not widen it, and it introduces no IR change (an object URL satisfies
 * `CanvasAssetRef.uri` natively).
 *
 * ## Why both context fields are honoured
 *
 * `CanvasAssetUploadContext.signal` and `.onProgress` are optional in the
 * contract, so an adapter that ignores them still compiles and still
 * "works". It works *worse*, though, and invisibly: the editor's
 * `uploadSingleFile` (`upload-actions.ts:118`) wires a per-task
 * `AbortController` into `signal` and pipes `onProgress` into the upload
 * store's `setProgress`. An adapter that ignores `signal` gets logical
 * cancellation only — the editor discards the result, but the bytes were
 * already written, so cancelling leaks an orphaned blob. An adapter that
 * ignores `onProgress` downgrades the panel to an indeterminate spinner. Both
 * degradations would apply to the DEFAULT adapter while host adapters kept
 * working, which is exactly the asymmetry this module exists to prevent.
 *
 * ## Cancellation is checkpoint-based, and cleans up after itself
 *
 * Neither `createImageBitmap` nor an IndexedDB write accepts an
 * `AbortSignal`, so there is no way to tear down a transfer mid-flight; the
 * honest maximum is to check the signal at **every** await boundary and to
 * undo whatever already landed. `upload()` therefore records every side
 * effect it performs (stored blob ids, minted object URLs) and rolls all of
 * them back on any throw — abort *or* error, at any point, including an abort
 * that arrives after the blob is already written. Without that last case an
 * aborted upload leaves an orphan in the store that nothing will ever
 * reference or collect.
 *
 * ## Progress is stage-weighted, not byte-streamed
 *
 * There is no byte-level progress source here: `store.put()` is one opaque
 * IndexedDB transaction and `createImageBitmap` reports nothing. Chunking the
 * blob purely to emit ticks would be progress theatre that doubles peak
 * memory for a 25 MiB file, so ticks are emitted at real completed stages
 * instead, weighted by where the wall-clock actually goes (decoding a large
 * image dominates). Every tick carries a real `fraction`, monotonic per file
 * and terminating at 1 — never `undefined`, which is the contract's
 * "indeterminate" signal and is not acceptable for a measurable local write.
 *
 * ## SVG is a deliberate special case
 *
 * `createImageBitmap` is not a usable intrinsic-size probe for SVG: Firefox
 * rejects an `image/svg+xml` blob outright, and engines that do accept one
 * disagree about the size of a document with no absolute `width`/`height`.
 * So SVG size is read from the source instead — a bounded head slice of the
 * file, the root `<svg>` element's `width`/`height`/`viewBox`, resolved by
 * the same precedence the SVG sizing model uses. That is deterministic and
 * engine-independent; `createImageBitmap` is still tried as a second chance
 * when the source yields nothing.
 *
 * ## Bundle placement
 *
 * Like `local-asset-store.ts`, this module is deliberately **not** re-exported
 * from `src/index.ts` or `src/internal.ts`: that entry is statically imported
 * by everything, and adding it would drag the store and its adapters into the
 * eager chunk. `cp1-004` wires it through a dynamic `import()`.
 *
 * No new dependency: `createImageBitmap`, `Blob`, `URL.createObjectURL`,
 * `AbortSignal` and `crypto.randomUUID` are platform built-ins.
 */

import type {
	CanvasAssetUploadContext,
	CanvasAssetUploader,
	CanvasUploadedAsset,
} from "./adapter-types.js";
import {
	getSharedLocalAssetStore,
	type LocalAssetStore,
} from "./local-asset-store.js";

/** Intrinsic pixel size of an image, as read from its own bytes. */
export interface IntrinsicImageSize {
	readonly width: number;
	readonly height: number;
}

/**
 * The subset of `ImageBitmap` an intrinsic-size probe needs. Structural on
 * purpose so a test can stub it without a real decoder — jsdom has no
 * `createImageBitmap` at all.
 */
export interface DecodedImageSource extends IntrinsicImageSize {
	/** Released as soon as the size has been read, when the source has one. */
	close?: () => void;
}

/** Decoder shape, satisfied by the global `createImageBitmap`. */
export type ImageDecoder = (blob: Blob) => Promise<DecodedImageSource>;

export interface LocalAssetUploaderOptions {
	/**
	 * Store to write to. Defaults to {@link getSharedLocalAssetStore} — the
	 * single instance the default picker (`cp1-003`) and rehydration
	 * (`cp1-005`) also read from. Resolved per `upload()` call rather than at
	 * construction, so building an uploader stays side-effect-free and a host
	 * that configures the shared store later still wins.
	 */
	store?: LocalAssetStore;
	/** Object-URL minter. Defaults to `URL.createObjectURL`. */
	createObjectURL?: (blob: Blob) => string;
	/**
	 * Object-URL revoker, used **only** on rollback. A successful upload hands
	 * the URL to the document and does not revoke it. Defaults to
	 * `URL.revokeObjectURL`.
	 */
	revokeObjectURL?: (url: string) => void;
	/**
	 * Raster intrinsic-size probe. Defaults to the global
	 * `createImageBitmap` when present, and to `null` — no probe, no
	 * dimensions, no throw — when it is absent. Pass `null` explicitly to
	 * disable probing.
	 */
	decodeImage?: ImageDecoder | null;
	/** Asset id factory. Defaults to `crypto.randomUUID()`. */
	createId?: (file: File) => string;
}

/**
 * Progress stage weights. Each tick fires only after the stage it names has
 * actually completed, so the sequence is monotonic by construction (the
 * reporter enforces it structurally as well). The gap between `MEASURED` and
 * `ACCEPTED` is the widest because decoding a large image is where the
 * wall-clock goes; everything after the write is bookkeeping.
 */
const PROGRESS_ACCEPTED = 0.05;
const PROGRESS_MEASURED = 0.5;
const PROGRESS_STORED = 0.95;
const PROGRESS_COMPLETE = 1;

const SVG_MIME_TYPE = "image/svg+xml";

/**
 * Bytes of an SVG read to find its root element. The `<svg>` tag is by
 * definition the first element in the document, so a slice this size covers
 * any real file including an XML declaration, a DOCTYPE and comments — while
 * keeping a 25 MiB SVG from being pulled into a string on the main thread.
 */
const SVG_HEAD_BYTES = 16 * 1024;

/** The first `<svg …>` tag in a document head. */
const SVG_ROOT_TAG = /<svg\b[^>]*>/i;

/** `name="value"` / `name='value'` inside one tag. */
const TAG_ATTRIBUTE = /([a-zA-Z_:][-\w:.]*)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;

/**
 * SVG absolute length units in CSS pixels. Relative units (`%`, `em`, `ex`,
 * `ch`, `rem`, `vw`, `vh`) are deliberately absent: they are not intrinsic —
 * `width="100%"` says nothing about the document's own size — so a value in
 * one of them falls through to `viewBox` instead.
 */
const ABSOLUTE_LENGTH_PX: Readonly<Record<string, number>> = {
	"": 1,
	px: 1,
	pt: 96 / 72,
	pc: 16,
	in: 96,
	cm: 96 / 2.54,
	mm: 96 / 25.4,
};

/**
 * Extension fallback for the MIME type. A file dragged from some desktop
 * environments arrives with an empty `File.type`, and the SVG branch below is
 * chosen by MIME — so without this an `.svg` drop would silently take the
 * raster path and end up unsized.
 */
const EXTENSION_MIME_TYPES: Readonly<Record<string, string>> = {
	avif: "image/avif",
	bmp: "image/bmp",
	gif: "image/gif",
	ico: "image/x-icon",
	jpeg: "image/jpeg",
	jpg: "image/jpeg",
	png: "image/png",
	svg: SVG_MIME_TYPE,
	webp: "image/webp",
};

/**
 * MIME type for `file`, or `undefined` when it cannot be determined.
 *
 * Never guesses `application/octet-stream`: `CanvasNodeRenderer` classifies a
 * load failure on a KNOWN-bad MIME type as "unsupported format"
 * (`stage/CanvasNodeRenderer.tsx`, `isUnsupportedImageMime`), and an unset
 * type is explicitly the "unknown, don't classify" case. Inventing a type
 * would turn an ordinary load error into a wrong diagnosis.
 */
function resolveMimeType(file: File): string | undefined {
	if (file.type !== "") return file.type;
	const dot = file.name.lastIndexOf(".");
	if (dot < 0) return undefined;
	return EXTENSION_MIME_TYPES[file.name.slice(dot + 1).toLowerCase()];
}

function roundSize(
	width: number,
	height: number,
): IntrinsicImageSize | undefined {
	const w = Math.round(width);
	const h = Math.round(height);
	if (!Number.isFinite(w) || !Number.isFinite(h) || w <= 0 || h <= 0) {
		return undefined;
	}
	return { width: w, height: h };
}

/** An SVG `width`/`height` attribute in CSS pixels, when it is absolute. */
function parseAbsoluteLength(value: string | undefined): number | undefined {
	if (value === undefined) return undefined;
	const match =
		/^\s*([+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?)\s*([a-z%]*)\s*$/i.exec(value);
	const rawNumber = match?.[1];
	if (rawNumber === undefined) return undefined;
	const scale = ABSOLUTE_LENGTH_PX[(match?.[2] ?? "").toLowerCase()];
	if (scale === undefined) return undefined;
	const px = Number.parseFloat(rawNumber) * scale;
	return Number.isFinite(px) && px > 0 ? px : undefined;
}

/** The `width`/`height` pair of a `viewBox="min-x min-y width height"`. */
function parseViewBox(
	value: string | undefined,
): IntrinsicImageSize | undefined {
	if (value === undefined) return undefined;
	const parts = value.trim().split(/[\s,]+/);
	if (parts.length !== 4) return undefined;
	const width = Number.parseFloat(parts[2] ?? "");
	const height = Number.parseFloat(parts[3] ?? "");
	if (!Number.isFinite(width) || !Number.isFinite(height)) return undefined;
	if (width <= 0 || height <= 0) return undefined;
	return { width, height };
}

/** Attributes of the root `<svg>` tag, keyed lowercase (`viewBox` → `viewbox`). */
function readSvgRootAttributes(head: string): Map<string, string> | undefined {
	const tag = SVG_ROOT_TAG.exec(head);
	if (!tag) return undefined;
	const attributes = new Map<string, string>();
	for (const match of tag[0].matchAll(TAG_ATTRIBUTE)) {
		const name = match[1];
		const value = match[2] ?? match[3];
		if (name !== undefined && value !== undefined) {
			attributes.set(name.toLowerCase(), value);
		}
	}
	return attributes;
}

/**
 * SVG intrinsic size, following the sizing model's precedence: absolute
 * `width` + `height` win; one absolute length plus a `viewBox` fixes the
 * other through the aspect ratio (the `width="100%"` + `viewBox` shape most
 * exported SVGs have); `viewBox` alone is the fallback.
 */
function resolveSvgSize(
	attributes: Map<string, string>,
): IntrinsicImageSize | undefined {
	const width = parseAbsoluteLength(attributes.get("width"));
	const height = parseAbsoluteLength(attributes.get("height"));
	if (width !== undefined && height !== undefined)
		return roundSize(width, height);
	const viewBox = parseViewBox(attributes.get("viewbox"));
	if (viewBox === undefined) return undefined;
	const ratio = viewBox.width / viewBox.height;
	if (width !== undefined) return roundSize(width, width / ratio);
	if (height !== undefined) return roundSize(height * ratio, height);
	return roundSize(viewBox.width, viewBox.height);
}

async function readSvgSize(
	blob: Blob,
): Promise<IntrinsicImageSize | undefined> {
	try {
		const head = await blob.slice(0, SVG_HEAD_BYTES).text();
		const attributes = readSvgRootAttributes(head);
		return attributes === undefined ? undefined : resolveSvgSize(attributes);
	} catch {
		// A malformed or unreadable file must not fail the upload; the node
		// just falls back to the editor's default image bounds.
		return undefined;
	}
}

/** The global `createImageBitmap`, or `null` where it does not exist (jsdom, SSR). */
function resolveDecoder(): ImageDecoder | null {
	if (typeof globalThis.createImageBitmap !== "function") return null;
	// Called through `globalThis` so the global keeps its receiver.
	return (blob) => globalThis.createImageBitmap(blob);
}

async function readRasterSize(
	blob: Blob,
	decode: ImageDecoder | null,
): Promise<IntrinsicImageSize | undefined> {
	if (decode === null) return undefined;
	try {
		const decoded = await decode(blob);
		const size = roundSize(decoded.width, decoded.height);
		// An ImageBitmap holds a full decoded surface — ~4 bytes per pixel, so
		// ~48 MB for a 12 MP photo. Releasing it here rather than waiting for
		// GC is the difference between one upload and a tab that thrashes.
		decoded.close?.();
		return size;
	} catch {
		// An undecodable or unsupported image is not an upload failure — the
		// bytes are still perfectly storable, the node just gets default bounds.
		return undefined;
	}
}

/**
 * Intrinsic pixel size of an image blob, or `undefined` when it cannot be
 * determined. Never throws.
 *
 * Exported so the default picker (`cp1-003`) and any host that wants the same
 * sizing behaviour can reuse one implementation rather than re-deriving the
 * SVG precedence rules.
 */
export async function readIntrinsicImageSize(
	blob: Blob,
	options: {
		/** Defaults to `blob.type`. */
		mimeType?: string;
		/** Defaults to the global `createImageBitmap`; `null` disables probing. */
		decodeImage?: ImageDecoder | null;
	} = {},
): Promise<IntrinsicImageSize | undefined> {
	const mimeType = options.mimeType ?? blob.type;
	const decode =
		options.decodeImage === undefined ? resolveDecoder() : options.decodeImage;
	if (mimeType === SVG_MIME_TYPE) {
		// Source first (deterministic), decoder second (engine-dependent, and
		// outright rejected by Firefox for SVG — hence not first).
		return (await readSvgSize(blob)) ?? (await readRasterSize(blob, decode));
	}
	if (!mimeType.startsWith("image/")) return undefined;
	return await readRasterSize(blob, decode);
}

/**
 * Throws the abort `reason` — the same object a `fetch`-based host uploader
 * would reject with, so the editor's `signal.aborted` check in
 * `uploadSingleFile` treats it as a cancellation rather than a failure and
 * shows no error toast.
 */
function assertNotAborted(signal: AbortSignal | undefined): void {
	if (signal?.aborted !== true) return;
	if (typeof signal.throwIfAborted === "function") signal.throwIfAborted();
	throw new DOMException("The upload was aborted.", "AbortError");
}

/**
 * Per-file progress emitter with a structural monotonicity guarantee: a
 * fraction at or below the file's high-water mark is dropped rather than
 * forwarded, so no reordering or retry can make the panel's bar move
 * backwards.
 */
function createProgressReporter(
	onProgress: CanvasAssetUploadContext["onProgress"],
): (fileIndex: number, fraction: number) => void {
	if (!onProgress) return () => undefined;
	const highWaterMark = new Map<number, number>();
	return (fileIndex, fraction) => {
		if (
			fraction <= (highWaterMark.get(fileIndex) ?? Number.NEGATIVE_INFINITY)
		) {
			return;
		}
		highWaterMark.set(fileIndex, fraction);
		try {
			onProgress({ fileIndex, fraction });
		} catch {
			// A throwing progress listener is the host's bug, not a reason to
			// fail an upload whose bytes are already safely written.
		}
	};
}

function defaultCreateObjectURL(blob: Blob): string {
	if (typeof URL === "undefined" || typeof URL.createObjectURL !== "function") {
		throw new Error(
			"[canvas-editor] URL.createObjectURL is unavailable, so the local uploader cannot mint an asset URI. Pass `createObjectURL` to createLocalAssetUploader() in this environment.",
		);
	}
	return URL.createObjectURL(blob);
}

function defaultRevokeObjectURL(url: string): void {
	if (typeof URL === "undefined" || typeof URL.revokeObjectURL !== "function") {
		return;
	}
	URL.revokeObjectURL(url);
}

function defaultCreateId(): string {
	const c = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto;
	if (c && typeof c.randomUUID === "function") return c.randomUUID();
	return `asset-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * Undo every side effect an interrupted `upload()` already performed. Best
 * effort by design: this runs while an abort or an error is already in
 * flight, and a failure to clean up must not replace the original reason.
 */
async function rollback(
	store: LocalAssetStore,
	storedIds: readonly string[],
	mintedUrls: readonly string[],
	revokeUrl: (url: string) => void,
): Promise<void> {
	for (const url of mintedUrls) {
		try {
			revokeUrl(url);
		} catch {
			// See above: cleanup never masks the original failure.
		}
	}
	await Promise.all(
		storedIds.map(async (id) => {
			try {
				await store.delete(id);
			} catch {
				// Same.
			}
		}),
	);
}

async function uploadLocally(
	files: readonly File[],
	context: CanvasAssetUploadContext,
	options: LocalAssetUploaderOptions,
): Promise<readonly CanvasUploadedAsset[]> {
	const { signal } = context;
	const store = options.store ?? getSharedLocalAssetStore();
	const mintUrl = options.createObjectURL ?? defaultCreateObjectURL;
	const revokeUrl = options.revokeObjectURL ?? defaultRevokeObjectURL;
	const createId = options.createId ?? defaultCreateId;
	const report = createProgressReporter(context.onProgress);
	/** Everything that would leak if this call does not complete. */
	const storedIds: string[] = [];
	const mintedUrls: string[] = [];
	const uploaded: CanvasUploadedAsset[] = [];

	try {
		assertNotAborted(signal);
		for (const [fileIndex, file] of files.entries()) {
			assertNotAborted(signal);
			report(fileIndex, PROGRESS_ACCEPTED);

			const id = createId(file);
			const mimeType = resolveMimeType(file);
			const size = await readIntrinsicImageSize(file, {
				...(mimeType !== undefined ? { mimeType } : {}),
				...(options.decodeImage !== undefined
					? { decodeImage: options.decodeImage }
					: {}),
			});
			assertNotAborted(signal);
			report(fileIndex, PROGRESS_MEASURED);

			// `File` IS a `Blob`, so this stores the original bytes with no copy.
			// Dimensions go in as metadata so `cp1-005` can rehydrate a correctly
			// sized `CanvasAssetRef` after a reload without decoding again.
			await store.put(id, file, {
				...(mimeType !== undefined ? { mimeType } : {}),
				...(size !== undefined
					? { width: size.width, height: size.height }
					: {}),
				name: file.name,
			});
			// Recorded before the next abort check on purpose: from here on an
			// abort has something to clean up.
			storedIds.push(id);
			assertNotAborted(signal);
			report(fileIndex, PROGRESS_STORED);

			const uri = mintUrl(file);
			mintedUrls.push(uri);
			assertNotAborted(signal);

			uploaded.push({
				id,
				uri,
				...(mimeType !== undefined ? { mimeType } : {}),
				...(size ?? {}),
			});
			report(fileIndex, PROGRESS_COMPLETE);
		}
		// One last check so a cancellation that lands between the final write
		// and the return still yields nothing to insert.
		assertNotAborted(signal);
		return uploaded;
	} catch (error) {
		await rollback(store, storedIds, mintedUrls, revokeUrl);
		throw error;
	}
}

/**
 * The zero-config {@link CanvasAssetUploader}: stores each file locally and
 * returns a `CanvasUploadedAsset` per file — `{ id, uri, mimeType?, width?,
 * height? }`, which satisfies `CanvasAssetRef` as-is, so no IR change is
 * involved.
 *
 * Rejects rather than resolving partially. On abort it rejects with the
 * signal's `reason`; on a cap breach it rejects with `cp1-001`'s typed
 * `LocalAssetStoreError` unchanged, so a caller can still narrow it with
 * `isLocalAssetStoreError()` and branch on `code` (`"asset-too-large"` /
 * `"store-full"`). Either way nothing it wrote survives the rejection.
 *
 * Construct it once (`cp1-004`), not per render: the object is stateless, but
 * the store it resolves is not.
 */
export function createLocalAssetUploader(
	options: LocalAssetUploaderOptions = {},
): CanvasAssetUploader {
	return {
		upload(files, context) {
			return uploadLocally(files, context, options);
		},
	};
}
