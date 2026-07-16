import type { CanvasTemplateEntry } from "./template-entry.js";

/**
 * Provider-based template API (C-06, FR-131). Hosts back the Templates panel
 * with a remote catalog by implementing these two methods; the static
 * `CanvasStudioProps.templates` array stays fully supported — it is wrapped
 * in {@link createStaticTemplateProvider} so the panel always speaks ONE
 * protocol.
 */
export interface CanvasTemplateSearchQuery {
	/** Free-text search over title/description/tags. */
	readonly text?: string;
	/** Exact category, or absent for all. */
	readonly category?: string;
	/** FR-130 size filter: first-page dimensions, in page units. */
	readonly size?: { readonly width: number; readonly height: number };
	/** Opaque cursor from a previous result's `nextCursor`. */
	readonly cursor?: string;
	/** Page size; providers may clamp. */
	readonly limit?: number;
}

export interface CanvasTemplateSearchResult {
	readonly entries: readonly CanvasTemplateEntry[];
	/** Present when more results exist — pass back as `query.cursor`. */
	readonly nextCursor?: string;
	/** Total match count, when the provider knows it. */
	readonly total?: number;
}

export interface CanvasTemplateProvider {
	search(query: CanvasTemplateSearchQuery): Promise<CanvasTemplateSearchResult>;
	getById(id: string): Promise<CanvasTemplateEntry | null>;
}

const DEFAULT_PAGE_SIZE = 20;

/** Size-filter tolerance, in page units (covers rounding in mm/in catalogs). */
const SIZE_TOLERANCE = 1;

function matchesText(entry: CanvasTemplateEntry, text: string): boolean {
	if (!text) return true;
	const haystack = [entry.title, entry.description ?? "", ...entry.tags]
		.join(" ")
		.toLowerCase();
	return haystack.includes(text);
}

function matchesSize(
	entry: CanvasTemplateEntry,
	size: NonNullable<CanvasTemplateSearchQuery["size"]>,
): boolean {
	const page = entry.document.pages[0]?.size;
	if (!page) return false;
	return (
		Math.abs(page.width - size.width) <= SIZE_TOLERANCE &&
		Math.abs(page.height - size.height) <= SIZE_TOLERANCE
	);
}

/**
 * Wrap a static template array in the provider protocol: synchronous
 * filtering with offset-cursor pagination. This is what the panel uses for
 * `CanvasStudioProps.templates`, and a convenient base for host tests.
 */
export function createStaticTemplateProvider(
	templates: readonly CanvasTemplateEntry[],
	options: { readonly pageSize?: number } = {},
): CanvasTemplateProvider {
	const pageSize = Math.max(1, options.pageSize ?? DEFAULT_PAGE_SIZE);
	return {
		search(query) {
			const text = (query.text ?? "").trim().toLowerCase();
			const matches = templates.filter(
				(entry) =>
					(query.category === undefined || entry.category === query.category) &&
					(query.size === undefined || matchesSize(entry, query.size)) &&
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
			return Promise.resolve(
				templates.find((entry) => entry.id === id) ?? null,
			);
		},
	};
}
