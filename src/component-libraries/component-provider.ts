import type { CanvasExternalComponentRef } from "@anvilkit/canvas-core";
// Type-only, from the subpath: the envelope shape lives with the admission
// pipeline that validates it, and `import type` is erased — this costs the
// editor bundle nothing and pulls no Core values in.
import type { CanvasExternalComponentEnvelope } from "@anvilkit/canvas-core/component-libraries";

/**
 * @file The host-injected Component Provider (plan 0021 T-018, TD 0016 §7.1).
 *
 * ## One protocol for hosted and fixture providers
 *
 * Modelled directly on `templates/template-provider.ts`, which solved the same
 * problem for templates: the panel speaks ONE protocol, and a static array is
 * wrapped into it rather than handled as a second code path. Copying that shape
 * is deliberate — a second, differently-shaped provider contract in the same
 * editor would be a coin-flip for every host integrator.
 *
 * What is added on top of the template seam is {@link CanvasProviderRequestContext}:
 * component search is typed-into, so a request must be cancellable, and every
 * method therefore takes a context carrying an `AbortSignal`.
 *
 * ## The Provider is never the render authority
 *
 * A Provider is consulted to OBTAIN a component; it is never consulted to USE
 * one. Once admitted, a snapshot in the document is the only thing resolution
 * reads (plan 0021 T-016), which is what makes a document render identically
 * offline. Nothing in this file may be reachable from a render path.
 */

/** Per-request context. Every Provider method receives one. */
export interface CanvasProviderRequestContext {
	/**
	 * Aborts when the request is superseded or the user navigates away.
	 *
	 * Honoured even by the static adapter — a host that only ever tests against
	 * the static provider would otherwise never exercise its own cancellation
	 * path, and would ship a hosted provider that ignores the signal.
	 */
	readonly signal: AbortSignal;
	/** Opaque correlation id for host logging. Never rendered. */
	readonly requestId?: string;
}

/** One component as the catalog describes it — NOT its definition. */
export interface CanvasComponentCatalogEntry {
	/** The exact, integrity-pinned reference this entry resolves to. */
	readonly ref: CanvasExternalComponentRef;
	readonly name: string;
	readonly description?: string;
	/** Owning library's display name; `ref.libraryId` is the opaque id. */
	readonly libraryName?: string;
	readonly brandName?: string;
	readonly category?: string;
	readonly tags?: readonly string[];
	/** `https:`/`http:` only — sanitize with `sanitizeProviderUrl` before render. */
	readonly thumbnailUrl?: string;
	readonly releaseNotesUrl?: string;
	/** Set when the catalog marks this version deprecated. */
	readonly deprecationNotice?: string;
	/** Provider-supplied ordering hint; Canvas never parses `ref.version`. */
	readonly publishedAt?: string;
}

export interface CanvasComponentSearchQuery {
	/** Free-text over name/description/tags. */
	readonly text?: string;
	readonly libraryId?: string;
	readonly brandName?: string;
	readonly category?: string;
	/** Opaque cursor from a previous result's `nextCursor`. */
	readonly cursor?: string;
	/** Page size; providers may clamp. */
	readonly limit?: number;
}

export interface CanvasComponentSearchResult {
	readonly entries: readonly CanvasComponentCatalogEntry[];
	readonly nextCursor?: string;
	readonly total?: number;
}

/** "Which versions of this component exist?" */
export interface CanvasComponentVersionQuery {
	readonly libraryId: string;
	readonly componentId: string;
	readonly cursor?: string;
	readonly limit?: number;
}

export interface CanvasComponentVersionResult {
	/**
	 * Newest first **as the Provider defines newest**. Canvas never sorts these:
	 * `version` is opaque and compared only for equality, so ordering is
	 * information only the host has.
	 */
	readonly entries: readonly CanvasComponentCatalogEntry[];
	readonly nextCursor?: string;
}

/** One available update for a component the document already uses. */
export interface CanvasComponentUpdate {
	readonly current: CanvasExternalComponentRef;
	readonly latest: CanvasExternalComponentRef;
	readonly entry: CanvasComponentCatalogEntry;
}

/** "Is this swap/update safe?" — answered by the host, checked again by Core. */
export interface CanvasComponentCompatibilityQuery {
	readonly from: CanvasExternalComponentRef;
	readonly to: CanvasExternalComponentRef;
}

/**
 * The host-implemented protocol.
 *
 * Every method is cancellable and every method may reject; the request store
 * (T-019) maps failures onto the seven presentation states and never surfaces a
 * raw error body.
 */
export interface CanvasComponentProvider {
	search(
		query: CanvasComponentSearchQuery,
		context: CanvasProviderRequestContext,
	): Promise<CanvasComponentSearchResult>;
	/**
	 * Fetch the full, integrity-bearing envelope for one exact reference.
	 *
	 * Returns `null` for "no such version", which is a normal catalog answer, not
	 * an error — distinguishing the two is what lets the UI offer a re-fetch for
	 * a transient failure but not for a version that was withdrawn.
	 */
	getEnvelope(
		ref: CanvasExternalComponentRef,
		context: CanvasProviderRequestContext,
	): Promise<CanvasExternalComponentEnvelope | null>;
	listVersions?(
		query: CanvasComponentVersionQuery,
		context: CanvasProviderRequestContext,
	): Promise<CanvasComponentVersionResult>;
	checkCompatibility?(
		query: CanvasComponentCompatibilityQuery,
		context: CanvasProviderRequestContext,
	): Promise<{ readonly compatible: boolean; readonly reason?: string }>;
}

const DEFAULT_PAGE_SIZE = 20;

/** One fixture component: its catalog entry plus the envelope it resolves to. */
export interface CanvasStaticComponentEntry {
	readonly entry: CanvasComponentCatalogEntry;
	readonly envelope: CanvasExternalComponentEnvelope;
}

function abortError(): Error {
	// `AbortError` by name is what `fetch` rejects with, so host code that
	// already branches on `error.name === "AbortError"` keeps working against the
	// static adapter — the point of honouring the signal here at all.
	const error = new Error("The component provider request was aborted.");
	error.name = "AbortError";
	return error;
}

function matchesText(
	entry: CanvasComponentCatalogEntry,
	text: string,
): boolean {
	if (!text) return true;
	return [
		entry.name,
		entry.description ?? "",
		entry.libraryName ?? "",
		entry.brandName ?? "",
		...(entry.tags ?? []),
	]
		.join(" ")
		.toLowerCase()
		.includes(text);
}

/**
 * Wrap a static component array in the Provider protocol.
 *
 * Synchronous filtering with offset-cursor pagination, mirroring
 * `createStaticTemplateProvider`. This is the fixture backend for tests and
 * demos, and the reference a hosted provider is checked against: the panel
 * cannot tell the two apart.
 */
export function createStaticComponentProvider(
	entries: readonly CanvasStaticComponentEntry[],
	options: { readonly pageSize?: number } = {},
): CanvasComponentProvider {
	const pageSize = Math.max(1, options.pageSize ?? DEFAULT_PAGE_SIZE);

	// NUL-separated, written as an ESCAPE not a literal byte: a raw control
	// character makes the source file non-text (repo convention, review 0022).
	// NUL is a safe separator precisely because every ref field rejects C0/C1
	// control characters, so no field value can contain one and forge a key.
	const keyOf = (ref: CanvasExternalComponentRef): string =>
		`${ref.libraryId}\u0000${ref.componentId}\u0000${ref.version}\u0000${ref.integrity}`;

	return {
		search(query, context) {
			if (context.signal.aborted) return Promise.reject(abortError());
			const text = (query.text ?? "").trim().toLowerCase();
			const matches = entries
				.map((e) => e.entry)
				.filter(
					(entry) =>
						(query.libraryId === undefined ||
							entry.ref.libraryId === query.libraryId) &&
						(query.brandName === undefined ||
							entry.brandName === query.brandName) &&
						(query.category === undefined ||
							entry.category === query.category) &&
						matchesText(entry, text),
				);
			const offset = Number.parseInt(query.cursor ?? "0", 10) || 0;
			const limit = Math.max(1, query.limit ?? pageSize);
			const page = matches.slice(offset, offset + limit);
			const nextOffset = offset + page.length;
			return Promise.resolve({
				entries: page,
				total: matches.length,
				...(nextOffset < matches.length
					? { nextCursor: String(nextOffset) }
					: {}),
			});
		},

		getEnvelope(ref, context) {
			if (context.signal.aborted) return Promise.reject(abortError());
			const wanted = keyOf(ref);
			const found = entries.find((e) => keyOf(e.envelope.ref) === wanted);
			// Exact match on all four fields, including `integrity`: a fixture
			// provider that matched on libraryId/componentId/version alone would
			// happily return substituted content, and the admission digest check
			// would then fail with an integrity error that looks like a bug.
			return Promise.resolve(found?.envelope ?? null);
		},

		listVersions(query, context) {
			if (context.signal.aborted) return Promise.reject(abortError());
			const matches = entries
				.map((e) => e.entry)
				.filter(
					(entry) =>
						entry.ref.libraryId === query.libraryId &&
						entry.ref.componentId === query.componentId,
				);
			const offset = Number.parseInt(query.cursor ?? "0", 10) || 0;
			const limit = Math.max(1, query.limit ?? pageSize);
			const page = matches.slice(offset, offset + limit);
			const nextOffset = offset + page.length;
			return Promise.resolve({
				entries: page,
				...(nextOffset < matches.length
					? { nextCursor: String(nextOffset) }
					: {}),
			});
		},
	};
}
