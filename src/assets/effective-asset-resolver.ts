import { type CanvasAssetRef, isLocalObjectUri } from "@anvilkit/canvas-core";

/** The source that supplied the URI consumers should render or package. */
export type CanvasEffectiveAssetSource =
	| "memory"
	| "indexeddb"
	| "host"
	| "remote"
	| "embedded"
	| "document";

/** Stable health states shared by every asset consumer. */
export type CanvasAssetResolutionStatus =
	| "ready"
	| "loading"
	| "uploading"
	| "retrying"
	| "missing"
	| "unavailable"
	| "stale"
	| "unauthorized";

export interface CanvasAssetResolveContext {
	readonly documentId: string;
	readonly signal?: AbortSignal;
}

export type CanvasAssetResolverResult =
	| {
			readonly status: "ready";
			readonly asset: CanvasAssetRef;
			/** Release an object URL or other temporary resource owned by this result. */
			readonly release?: () => void;
	  }
	| {
			readonly status: Exclude<CanvasAssetResolutionStatus, "ready">;
			/** Optional placeholder or last-known-safe value while not ready. */
			readonly asset?: CanvasAssetRef;
			readonly message?: string;
	  };

/**
 * Host/browser resolution port. Implementations may refresh a signed URL,
 * read IndexedDB, or obtain a host-owned asset, but never mutate the document.
 */
export interface CanvasAssetResolver {
	resolve(
		asset: CanvasAssetRef,
		context: CanvasAssetResolveContext,
	): Promise<CanvasAssetResolverResult | undefined>;
}

export interface CanvasEffectiveAssetEntry {
	readonly id: string;
	readonly source: CanvasEffectiveAssetSource;
	readonly status: CanvasAssetResolutionStatus;
	readonly documentAsset: CanvasAssetRef;
	readonly asset?: CanvasAssetRef;
	readonly message?: string;
}

export interface CanvasEffectiveAssetTable {
	/** Compatibility table consumed by stage, thumbnail, preflight, and exporters. */
	readonly assets: Record<string, CanvasAssetRef>;
	/** Resolution evidence and health, keyed identically to {@link assets}. */
	readonly entries: Record<string, CanvasEffectiveAssetEntry>;
	/** Release one temporary resource early (for delete/undo). Idempotent. */
	release(assetId: string): void;
	/** Idempotently releases temporary resources minted for this table. */
	dispose(): void;
}

export interface ResolveEffectiveAssetTableOptions
	extends CanvasAssetResolveContext {
	/** Persisted metadata and reference URIs from the admitted document. */
	readonly documentAssets: Readonly<Record<string, CanvasAssetRef>>;
	/** Live uploads created in this page, before their object URLs become stale. */
	readonly memoryAssets?: Readonly<Record<string, CanvasAssetRef>>;
	/** Browser-local byte resolver. It is consulted before the host. */
	readonly indexedDbResolver?: CanvasAssetResolver;
	/** Host-owned lookup or signed-URL refresh resolver. */
	readonly hostResolver?: CanvasAssetResolver;
}

interface SourceAttempt {
	readonly source: "indexeddb" | "host";
	readonly resolver: CanvasAssetResolver;
}

interface ResolvedEntry {
	readonly entry: CanvasEffectiveAssetEntry;
	readonly release?: () => void;
}

function mergeAsset(
	documentAsset: CanvasAssetRef,
	resolvedAsset: CanvasAssetRef,
): CanvasAssetRef {
	return {
		...documentAsset,
		...resolvedAsset,
		// A resolver may refresh metadata or the URI, but it cannot change the
		// document identity the node references.
		id: documentAsset.id,
	};
}

function documentSource(asset: CanvasAssetRef): CanvasEffectiveAssetSource {
	if (asset.uri.startsWith("data:")) return "embedded";
	try {
		const protocol = new URL(asset.uri, "https://canvas.invalid").protocol;
		if (protocol === "http:" || protocol === "https:") return "remote";
	} catch {
		// Non-URL strings retain their document source classification below.
	}
	return "document";
}

function aborted(signal: AbortSignal | undefined): void {
	if (!signal?.aborted) return;
	throw (
		signal.reason ?? new DOMException("Asset resolution aborted", "AbortError")
	);
}

async function runResolver(
	attempt: SourceAttempt,
	asset: CanvasAssetRef,
	context: CanvasAssetResolveContext,
): Promise<CanvasAssetResolverResult | undefined> {
	aborted(context.signal);
	try {
		const result = await attempt.resolver.resolve(asset, context);
		if (context.signal?.aborted && result?.status === "ready") {
			// A resolver can finish after its caller cancelled. Its temporary
			// resource never reaches a table that could dispose it, so ownership
			// remains here.
			result.release?.();
		}
		aborted(context.signal);
		return result;
	} catch (error) {
		aborted(context.signal);
		return {
			status: "unavailable",
			message: error instanceof Error ? error.message : String(error),
		};
	}
}

async function resolveEntry(
	documentAsset: CanvasAssetRef,
	options: ResolveEffectiveAssetTableOptions,
): Promise<ResolvedEntry> {
	aborted(options.signal);
	const memoryAsset = options.memoryAssets?.[documentAsset.id];
	if (memoryAsset) {
		const asset = mergeAsset(documentAsset, memoryAsset);
		return {
			entry: {
				id: documentAsset.id,
				source: "memory",
				status: "ready",
				documentAsset,
				asset,
			},
		};
	}

	const attempts: SourceAttempt[] = [];
	if (options.indexedDbResolver) {
		attempts.push({
			source: "indexeddb",
			resolver: options.indexedDbResolver,
		});
	}
	if (options.hostResolver) {
		attempts.push({ source: "host", resolver: options.hostResolver });
	}

	let failure:
		| {
				readonly source: "indexeddb" | "host";
				readonly result: Exclude<
					CanvasAssetResolverResult,
					{ status: "ready" }
				>;
		  }
		| undefined;
	for (const attempt of attempts) {
		const result = await runResolver(attempt, documentAsset, options);
		if (!result) continue;
		if (result.status === "ready") {
			const asset = mergeAsset(documentAsset, result.asset);
			return {
				entry: {
					id: documentAsset.id,
					source: attempt.source,
					status: "ready",
					documentAsset,
					asset,
				},
				...(result.release ? { release: result.release } : {}),
			};
		}
		// The host is authoritative for a host-known failure. A local-store miss,
		// however, may still be recovered by the host on the next attempt.
		failure = { source: attempt.source, result };
	}

	const source = documentSource(documentAsset);
	const canUseDocumentUri = !isLocalObjectUri(documentAsset.uri);
	if (canUseDocumentUri && failure?.source !== "host") {
		return {
			entry: {
				id: documentAsset.id,
				source,
				status: "ready",
				documentAsset,
				asset: documentAsset,
			},
		};
	}

	return {
		entry: {
			id: documentAsset.id,
			source: failure?.source ?? source,
			status: failure?.result.status ?? "missing",
			documentAsset,
			...(failure?.result.asset
				? { asset: mergeAsset(documentAsset, failure.result.asset) }
				: {}),
			...(failure?.result.message ? { message: failure.result.message } : {}),
		},
	};
}

/**
 * Resolve one immutable effective table for every renderer/exporter in a run.
 * Precedence is live memory → IndexedDB → host → portable document URI.
 */
export async function resolveEffectiveAssetTable(
	options: ResolveEffectiveAssetTableOptions,
): Promise<CanvasEffectiveAssetTable> {
	aborted(options.signal);
	const completed: ResolvedEntry[] = [];
	let results: ResolvedEntry[];
	try {
		results = await Promise.all(
			Object.values(options.documentAssets).map(async (asset) => {
				const result = await resolveEntry(asset, options);
				completed.push(result);
				return result;
			}),
		);
		aborted(options.signal);
	} catch (error) {
		// A source may have minted object URLs immediately before another source
		// observed cancellation. No rejected table exists to dispose them, so the
		// resolver must release the completed results itself.
		for (const result of completed) result.release?.();
		throw error;
	}

	const assets: Record<string, CanvasAssetRef> = {};
	const entries: Record<string, CanvasEffectiveAssetEntry> = {};
	const releases = new Map<string, () => void>();
	for (const result of results) {
		entries[result.entry.id] = result.entry;
		if (result.entry.asset) assets[result.entry.id] = result.entry.asset;
		if (result.release) releases.set(result.entry.id, result.release);
	}

	let disposed = false;
	const release = (assetId: string): void => {
		const resource = releases.get(assetId);
		if (!resource) return;
		releases.delete(assetId);
		resource();
	};
	return {
		assets,
		entries,
		release,
		dispose() {
			if (disposed) return;
			disposed = true;
			for (const assetId of [...releases.keys()]) release(assetId);
		},
	};
}
