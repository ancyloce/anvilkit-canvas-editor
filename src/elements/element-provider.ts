import type {
	CanvasElementCategory,
	CanvasElementEntry,
} from "./element-entry.js";

/**
 * Provider-based element API (PLAN-0035 §5 P3, `cp3-001`).
 *
 * A DELIBERATE COPY OF THE TEMPLATE PROVIDER, NOT A SECOND PATTERN.
 *
 * `templates/template-provider.ts` already establishes how a Canvas content
 * surface is fed: one `search(query)` returning `{ entries, nextCursor?,
 * total? }`, one `getById(id)`, an opaque offset cursor, a provider-clampable
 * `limit`, and a `createStatic…` wrapper so the panel speaks ONE protocol
 * whether the host passed an array or a real backend. This module matches all
 * of it name for name, so a reader who has learned the Templates panel has
 * already learned this one. The four deviations are individually justified
 * where they occur:
 *
 * 1. `query.category` is the closed {@link CanvasElementCategory}, not an open
 *    `string` — the element taxonomy is fixed, a template's is host-owned.
 * 2. There is no `size` filter — a template's page size is a real facet a user
 *    filters on; an icon's is not.
 * 3. `matchesText` also searches `keywords` (see {@link CanvasElementEntry}).
 * 4. {@link createLazyElementProvider} is added. The template catalog is host
 *    data that is already in memory; `cp3-002`'s is 300-500 entries that must
 *    contribute **zero bytes** to the eager editor chunk. Shipping the deferred
 *    wrapper here is how that decision is enforced rather than merely hoped
 *    for — see its doc.
 */
export interface CanvasElementSearchQuery {
	/** Free-text search over name/tags/keywords. */
	readonly text?: string;
	/** Exact category, or absent for all. */
	readonly category?: CanvasElementCategory;
	/** Opaque cursor from a previous result's `nextCursor`. */
	readonly cursor?: string;
	/** Page size; providers may clamp. */
	readonly limit?: number;
}

export interface CanvasElementSearchResult {
	readonly entries: readonly CanvasElementEntry[];
	/** Present when more results exist — pass back as `query.cursor`. */
	readonly nextCursor?: string;
	/** Total match count, when the provider knows it. */
	readonly total?: number;
}

export interface CanvasElementProvider {
	search(query: CanvasElementSearchQuery): Promise<CanvasElementSearchResult>;
	getById(id: string): Promise<CanvasElementEntry | null>;
}

const DEFAULT_PAGE_SIZE = 20;

/**
 * Same haystack construction as the template provider's private `matchesText`,
 * extended with `keywords`. An icon set without synonyms is unsearchable —
 * "bin" and "trash" and "delete" are one icon, and only one of those is its
 * name.
 */
function matchesText(entry: CanvasElementEntry, text: string): boolean {
	if (!text) return true;
	const haystack = [entry.name, ...entry.tags, ...(entry.keywords ?? [])]
		.join(" ")
		.toLowerCase();
	return haystack.includes(text);
}

/**
 * Wrap a static element array in the provider protocol: synchronous filtering
 * with offset-cursor pagination. Mirrors `createStaticTemplateProvider`
 * exactly, including the `pageSize` option and the `Promise.resolve` return, so
 * the two behave identically under the same query.
 */
export function createStaticElementProvider(
	elements: readonly CanvasElementEntry[],
	options: { readonly pageSize?: number } = {},
): CanvasElementProvider {
	const pageSize = Math.max(1, options.pageSize ?? DEFAULT_PAGE_SIZE);
	return {
		search(query) {
			const text = (query.text ?? "").trim().toLowerCase();
			const matches = elements.filter(
				(entry) =>
					(query.category === undefined || entry.category === query.category) &&
					matchesText(entry, text),
			);
			const offset = Number.parseInt(query.cursor ?? "0", 10) || 0;
			const limit = Math.max(1, query.limit ?? pageSize);
			const entries = matches.slice(offset, offset + limit);
			const nextOffset = offset + entries.length;
			return Promise.resolve({
				entries,
				total: matches.length,
				...(nextOffset < matches.length
					? { nextCursor: String(nextOffset) }
					: {}),
			});
		},
		getById(id) {
			return Promise.resolve(elements.find((entry) => entry.id === id) ?? null);
		},
	};
}

/**
 * Defer a provider until its first query, then reuse it.
 *
 * THE EAGER/LAZY DECISION, MADE HERE RATHER THAN IN `cp3-002`.
 *
 * Nothing about {@link CanvasElementProvider} forces its catalog into the eager
 * chunk: `search` and `getById` are already async, exactly as the template
 * provider's are, so a provider may resolve its data whenever it likes. This
 * wrapper is what makes that the path of least resistance instead of a thing
 * each call site has to remember:
 *
 * ```ts
 * const elements = createLazyElementProvider(async () =>
 *   createStaticElementProvider(
 *     (await import("./default-element-catalog.js")).DEFAULT_ELEMENTS,
 *   ),
 * );
 * ```
 *
 * The `import()` is inside the callback, so the catalog is a separate chunk
 * fetched on first search — `cp3-003`'s "load on first panel open, not at
 * editor mount", and `cp3-002`'s "zero bytes in the eager editor chunk". This
 * is the same dynamic-`import()` precedent the SVG/PDF exporters already set in
 * this package.
 *
 * A rejected `load()` is NOT cached: the next call retries. Without that, one
 * transient failure would make the Retry button (which the Templates panel
 * already has, and `cp3-003` mirrors) permanently useless.
 */
export function createLazyElementProvider(
	load: () => Promise<CanvasElementProvider>,
): CanvasElementProvider {
	let pending: Promise<CanvasElementProvider> | undefined;
	const resolveProvider = (): Promise<CanvasElementProvider> => {
		pending ??= load().catch((error: unknown) => {
			pending = undefined;
			throw error;
		});
		return pending;
	};
	return {
		search: (query) =>
			resolveProvider().then((provider) => provider.search(query)),
		getById: (id) => resolveProvider().then((provider) => provider.getById(id)),
	};
}
