/**
 * @file cp1-006 (PLAN-0035 §5 P1, §9 R-7) — making an export that contains
 * browser-local assets either portable or *loudly* unportable.
 *
 * ## The failure this removes
 *
 * A `blob:` URI is an opaque handle minted by one document in one browsing
 * session. `cp1-001`..`cp1-005` made local images work beautifully *inside*
 * the editor — the bytes live in IndexedDB, `cp1-005` re-mints a fresh handle
 * on reload — but every one of those handles is meaningless the moment the
 * document leaves this tab.
 *
 * Raster and PDF export never noticed, because they read pixels off the Konva
 * stage rather than the URI. **SVG and JSON did.** SVG dropped the image
 * outright (`UNSAFE_URI`: the scheme allowlist rejects `blob:` for referencing,
 * correctly and permanently). JSON was worse — it wrote the dead handle
 * straight into the exported document, silently. That is a strictly worse
 * failure than P1's "I can't add an image at all": it moves the breakage from
 * *obvious and immediate* to *invisible until it matters*.
 *
 * ## The shape of the fix
 *
 * Two consumers, one scan, no new reporting channel:
 *
 * - **SVG** — {@link createLocalAssetSvgFetcher} supplies the `SvgFetchAsset`
 *   the serializer has always accepted. Nothing about image emission is
 *   reimplemented here; core does the base64 and the `data:` URI. cp1-006's
 *   companion change in `canvas-core/src/uri.ts` + `serialize/svg.ts` is what
 *   lets that existing seam *see* a `blob:` URI at all — the allowlist used to
 *   reject it before the embed branch ran.
 * - **JSON** — {@link inlineLocalAssetsForJson} rewrites `assets[id].uri` to a
 *   `data:` URI when the stored bytes fit under a cap, and otherwise leaves
 *   the document alone and returns one `CanvasExportWarning` **per** asset
 *   that will not travel. The warning is `@anvilkit/canvas-core`'s ordinary
 *   `CanvasExportWarning`, so it rides `CanvasExportArtifact.warnings` into the
 *   export popover next to every other fidelity warning.
 *
 * ## Why this module is never eager
 *
 * It is reached only through `await import()` from `header/exporters.ts`, and
 * it in turn reaches `local-asset-store.js` the same way. `cp1-001`/`cp1-004`/
 * `cp1-005` all paid to keep the store out of the entry chunk (203 B gz,
 * async-only); an exporter that runs at most a few times per session has no
 * claim on the bytes every host loads on first paint. The one thing left in
 * the eager path is a `.some(isLocalObjectUri)` predicate over `ir.assets`, so
 * a document with no browser-local assets never loads this file and its JSON
 * export stays byte-identical **and synchronous**.
 *
 * No new dependency: `Blob`, `FileReader`, dynamic `import()` and `Map` are
 * platform built-ins, and the store is `cp1-001`'s.
 */

import type {
	CanvasAssetRef,
	CanvasExportWarning,
	SvgFetchAsset,
} from "@anvilkit/canvas-core";
import { isLocalObjectUri } from "@anvilkit/canvas-core";
import type {
	LocalAssetMeta,
	LocalAssetStore,
	LocalAssetStoreBackend,
} from "./local-asset-store.js";

/**
 * `code` values this module puts on a {@link CanvasExportWarning}.
 *
 * `MISSING_ASSET` is deliberately **reused** rather than replaced: it is
 * already core's code for "the bytes this document points at are not there",
 * it is already the row in `docs/export-capability-matrix.md`, and the canvas
 * is already showing the missing-asset placeholder for exactly these assets
 * (`cp1-005`). An export that invented a second name for the same fact would
 * contradict the surface the user is looking at.
 *
 * The other two are new because they describe something no existing code
 * covers: bytes that exist and are simply *too large to travel*, and a store
 * that will not survive a reload.
 */
export const LOCAL_ASSET_EXPORT_WARNING_CODES = {
	/** Stored bytes exist, but inlining them would blow the cap. */
	notPortable: "LOCAL_ASSET_NOT_PORTABLE",
	/**
	 * IndexedDB was unavailable, so the store degraded to memory. Emitted only
	 * alongside {@link LOCAL_ASSET_EXPORT_WARNING_CODES.notPortable} — once the
	 * bytes are inlined the artifact is portable regardless of what the store
	 * is made of.
	 */
	volatileStore: "LOCAL_ASSET_VOLATILE_STORE",
	/** A browser-local URI whose bytes the store does not hold. */
	missing: "MISSING_ASSET",
} as const;

/** Ids in `assets` whose URI only this browser can resolve. */
export function collectLocalAssetIds(
	assets: Record<string, CanvasAssetRef>,
): string[] {
	const ids: string[] = [];
	for (const [id, ref] of Object.entries(assets)) {
		if (isLocalObjectUri(ref.uri)) ids.push(id);
	}
	return ids;
}

async function resolveStore(store?: LocalAssetStore): Promise<LocalAssetStore> {
	if (store) return store;
	const { getSharedLocalAssetStore } = await import("./local-asset-store.js");
	return getSharedLocalAssetStore();
}

/**
 * Everything both consumers need about the browser-local assets in one
 * document, read WITHOUT touching a single blob: `list()` is metadata-only
 * (`cp1-001`), so the cap decision costs nothing even for a 200 MiB store.
 */
export interface LocalAssetExportScan {
	readonly store: LocalAssetStore;
	readonly backend: LocalAssetStoreBackend;
	/** Candidates the store holds, in `assets` order. */
	readonly stored: readonly LocalAssetMeta[];
	/** Candidates the store does not hold — their bytes are gone. */
	readonly missingIds: readonly string[];
	/** Sum of `stored[].byteSize`; the number the cap is compared against. */
	readonly totalBytes: number;
}

/**
 * `store.has(id)` is the authority, not the `blob:` prefix — `cp1-004`'s rule,
 * still true after `cp1-005` re-mints handles, because rehydration changes the
 * URI and never the id. Implemented over one `list()` rather than N `has()`
 * calls: same answer, one round trip, and it yields the byte sizes the cap
 * needs anyway.
 */
export async function scanLocalAssets(
	assets: Record<string, CanvasAssetRef>,
	store?: LocalAssetStore,
): Promise<LocalAssetExportScan> {
	const resolved = await resolveStore(store);
	const [backend, metas] = await Promise.all([
		resolved.backend(),
		resolved.list(),
	]);
	const metaById = new Map(metas.map((meta) => [meta.id, meta]));
	const stored: LocalAssetMeta[] = [];
	const missingIds: string[] = [];
	let totalBytes = 0;
	for (const id of collectLocalAssetIds(assets)) {
		const meta = metaById.get(id);
		if (meta) {
			stored.push(meta);
			totalBytes += meta.byteSize;
		} else {
			missingIds.push(id);
		}
	}
	return { store: resolved, backend, stored, missingIds, totalBytes };
}

/**
 * A `SvgFetchAsset` backed by the browser-local store, or `undefined` when the
 * document has nothing browser-local (in which case passing a fetcher at all
 * would be noise).
 *
 * Keyed by **URI**, because that is the only thing `SvgFetchAsset` is given —
 * the map back to an asset id is built here from the same `ir.assets` the
 * serializer reads, so the two can never disagree about which id a URI names.
 * The store itself is resolved lazily *inside* the fetcher: a document whose
 * local images all sit on pages outside the exported scope never opens
 * IndexedDB at all.
 *
 * Bytes come from `store.get(id)`, not from `fetch()`ing the rehydrated
 * `blob:` handle (`cp1-005`'s handoff): same bytes, one less indirection, and
 * it works in a worker or a test where `URL.createObjectURL` does not exist.
 */
export function createLocalAssetSvgFetcher(
	assets: Record<string, CanvasAssetRef>,
	store?: LocalAssetStore,
): SvgFetchAsset | undefined {
	const idByUri = new Map<string, string>();
	for (const [id, ref] of Object.entries(assets)) {
		if (isLocalObjectUri(ref.uri)) idByUri.set(ref.uri.trim(), id);
	}
	if (idByUri.size === 0) return undefined;

	// Resolved once per export, not once per image: `list()` is the only way to
	// recover the MIME type a `Blob` may have lost (a drop from some desktop
	// environments arrives with an empty `File.type`, which `cp1-002` records in
	// the store's metadata rather than inventing), and an `<image href>` with
	// `application/octet-stream` does not render.
	let resolution: Promise<{
		store: LocalAssetStore;
		metaById: Map<string, LocalAssetMeta>;
	}> | null = null;
	const resolve = (): Promise<{
		store: LocalAssetStore;
		metaById: Map<string, LocalAssetMeta>;
	}> => {
		resolution ??= resolveStore(store).then(async (resolved) => ({
			store: resolved,
			metaById: new Map((await resolved.list()).map((m) => [m.id, m])),
		}));
		return resolution;
	};

	return async (uri) => {
		const id = idByUri.get(uri.trim());
		// Rejecting is the contract: `embedRemote` catches, warns MISSING_ASSET
		// and omits the image — which is what the canvas is already showing.
		if (id === undefined) {
			throw new Error(`No browser-local asset is registered for "${uri}".`);
		}
		const { store: resolved, metaById } = await resolve();
		const blob = await resolved.get(id);
		if (!blob) {
			throw new Error(`Local asset "${id}" is no longer stored.`);
		}
		return {
			bytes: new Uint8Array(await blob.arrayBuffer()),
			contentType:
				metaById.get(id)?.mimeType || blob.type || "application/octet-stream",
		};
	};
}

export interface InlineLocalAssetsOptions {
	/**
	 * Ceiling on the **source** bytes of the local assets to inline, summed
	 * across the document. Source rather than encoded bytes because
	 * `LocalAssetMeta.byteSize` is free (`list()` reads no blobs) and base64's
	 * inflation is a constant 4/3 — the caller's chosen number is easier to
	 * reason about against the file sizes a user recognises.
	 */
	readonly maxInlineBytes: number;
	/** Test seam. Defaults to `getSharedLocalAssetStore()`. */
	readonly store?: LocalAssetStore;
}

export interface InlineLocalAssetsResult {
	/**
	 * The rewritten asset map, or the input **by identity** when nothing was
	 * inlined — the caller uses that to skip rebuilding the IR.
	 */
	readonly assets: Record<string, CanvasAssetRef>;
	readonly warnings: readonly CanvasExportWarning[];
}

/** `12.3 MB` / `840 KB` — recognisable, not exact. */
function formatBytes(bytes: number): string {
	if (bytes >= 1_000_000) return `${(bytes / 1_000_000).toFixed(1)} MB`;
	if (bytes >= 1_000) return `${Math.round(bytes / 1_000)} KB`;
	return `${bytes} bytes`;
}

/** `"photo.jpg" (a1)` when the ingress path knew a name, `"a1"` otherwise. */
function describeAsset(id: string, meta?: LocalAssetMeta): string {
	return meta?.name ? `"${meta.name}" (${id})` : `"${id}"`;
}

/**
 * Read one stored blob as a `data:` URI.
 *
 * `FileReader.readAsDataURL` rather than a hand-rolled `btoa` loop: the
 * platform already owns this conversion, it chunks large payloads natively
 * instead of building one enormous intermediate JS string, and core's
 * `bytesToBase64` is deliberately not on `@anvilkit/canvas-core`'s public
 * surface (its `serialize/index.ts` curates svg.ts's exports precisely to keep
 * emitter internals out). The blob is re-wrapped with the MIME type the store
 * recorded, because `FileReader` derives the data URI's media type from
 * `Blob.type` — which is empty for a file dropped without one.
 */
async function toDataUri(blob: Blob, mimeType: string): Promise<string> {
	const typed =
		blob.type === mimeType ? blob : new Blob([blob], { type: mimeType });
	return await new Promise<string>((resolve, reject) => {
		const reader = new FileReader();
		reader.onerror = () =>
			reject(reader.error ?? new Error("Could not read the stored asset."));
		reader.onload = () => {
			const result = reader.result;
			if (typeof result === "string") resolve(result);
			else reject(new Error("Could not read the stored asset."));
		};
		reader.readAsDataURL(typed);
	});
}

/**
 * Inline every browser-local asset as a `data:` URI, or inline none and say
 * exactly which images will not travel.
 *
 * **All-or-nothing above the cap, deliberately.** Greedy smallest-first
 * packing would rescue a few more images, but it makes the result depend on
 * the sizes and ordering of *other* assets: adding one small logo could
 * silently push a different photo out on the next export, and the user has no
 * way to predict which of their images survived. The whole point of this task
 * is that portability stops being a thing you discover later — so the answer
 * is one bit ("this file is self-contained" / "this file is not, and here is
 * every image it is missing"), not a per-asset lottery.
 */
export async function inlineLocalAssetsForJson(
	assets: Record<string, CanvasAssetRef>,
	options: InlineLocalAssetsOptions,
): Promise<InlineLocalAssetsResult> {
	const scan = await scanLocalAssets(assets, options.store);
	const warnings: CanvasExportWarning[] = [];

	// Bytes that are simply gone. The stage already renders these as the
	// missing-asset placeholder (`cp1-005`), so the export agrees with the
	// canvas instead of contradicting it.
	for (const id of scan.missingIds) {
		warnings.push({
			level: "warn",
			code: LOCAL_ASSET_EXPORT_WARNING_CODES.missing,
			message: `Image ${describeAsset(id)} is not in this browser's local asset storage, so the exported document points at a URI nothing can resolve.`,
			fallback: "Re-add this image, then export again.",
		});
	}

	if (scan.stored.length === 0) return { assets, warnings };

	if (scan.totalBytes > options.maxInlineBytes) {
		for (const meta of scan.stored) {
			warnings.push({
				level: "warn",
				code: LOCAL_ASSET_EXPORT_WARNING_CODES.notPortable,
				message: `Image ${describeAsset(meta.id, meta)} (${formatBytes(
					meta.byteSize,
				)}) is stored only in this browser and was left as a "blob:" reference: the document's local images total ${formatBytes(
					scan.totalBytes,
				)}, over the ${formatBytes(
					options.maxInlineBytes,
				)} limit for inlining them into JSON.`,
				fallback:
					"Remove or shrink some images, or host them and reference them by URL.",
			});
		}
		if (scan.backend === "memory") {
			// `cp1-001`'s standing warning case. Worth its own line rather than a
			// clause on every asset: it is a fact about the whole store, and it is
			// strictly worse than "another machine cannot open this" — the bytes
			// do not survive a reload here either.
			warnings.push({
				level: "error",
				code: LOCAL_ASSET_EXPORT_WARNING_CODES.volatileStore,
				message:
					"This browser could not open local storage, so images are held in memory only. The images listed above will be gone after a reload — on this machine too, not just on another.",
				fallback:
					"Export the images you need before reloading, or use a host that provides an asset uploader.",
			});
		}
		return { assets, warnings };
	}

	const inlined: Record<string, CanvasAssetRef> = { ...assets };
	for (const meta of scan.stored) {
		const ref = assets[meta.id];
		if (!ref) continue;
		try {
			const blob = await scan.store.get(meta.id);
			if (!blob) throw new Error("not stored");
			inlined[meta.id] = { ...ref, uri: await toDataUri(blob, meta.mimeType) };
		} catch {
			// A read that fails between `list()` and `get()` is the dangling case
			// arriving late — same fact, same warning, and the original URI stays
			// so the document is no *more* broken than it already was.
			warnings.push({
				level: "warn",
				code: LOCAL_ASSET_EXPORT_WARNING_CODES.missing,
				message: `Image ${describeAsset(meta.id, meta)} could not be read from this browser's local asset storage, so the exported document points at a URI nothing can resolve.`,
				fallback: "Re-add this image, then export again.",
			});
		}
	}
	return { assets: inlined, warnings };
}
