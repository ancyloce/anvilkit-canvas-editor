import type {
	MeasuredText,
	RichTextParagraph,
	RichTextStyleDefaults,
	RichTextWrap,
} from "@anvilkit/canvas-core";

/**
 * The editor's ONE measurement cache (T-M3-04) — two levels:
 *
 * **Level 1 (unchanged):** a `WeakMap` keyed by the node's `paragraphs` ARRAY
 * reference, not the node object. `ir/mutations.ts`'s `mergeNodePatch`
 * shallow-spreads `{ ...node, ...patch }` on every command — including a
 * transform-only patch, which is what every frame of a drag applies. That
 * produces a new `node` object each frame but keeps the same `paragraphs`
 * reference, so keying on `node` would re-measure on every drag frame: the
 * exact single-pass-mutation regression `perf/static-cache.ts` already had to
 * fix once, one layer up. Keying on the stable sub-reference makes a drag
 * frame a cache hit — and gives free eviction.
 *
 * **Level 2:** the inner `Map`'s key is `width | wrap | manifest | style`,
 * where `style` is a serialization of the resolved span-style defaults and
 * `manifest` is the font-manifest identity. The previous key was
 * `width | wrap` only, with a doc comment assuming one global `defaults`
 * object — a real correctness bug once two nodes inherit different host
 * defaults (they collided on one measurement), and once a font load changes
 * metrics (the pre-load measurement was served forever).
 *
 * The style serialization is memoized per `defaults` OBJECT in a `WeakMap`,
 * so the reference fast path (drag frames re-using the same module-level
 * defaults constant) performs no hashing/serialization at all — it is
 * computed once per distinct defaults object, i.e. only on an outer miss of
 * that memo.
 */
const cache = new WeakMap<
	readonly RichTextParagraph[],
	Map<string, MeasuredText>
>();

const styleKeyCache = new WeakMap<RichTextStyleDefaults, string>();

function styleKeyFor(defaults: RichTextStyleDefaults | undefined): string {
	if (!defaults) return "";
	let key = styleKeyCache.get(defaults);
	if (key === undefined) {
		key = JSON.stringify(defaults);
		styleKeyCache.set(defaults, key);
	}
	return key;
}

/** Optional key components for {@link getCachedLayout}. */
export interface LayoutCacheKeyOptions {
	/** The resolved span-style defaults in force. Part of the key. */
	defaults?: RichTextStyleDefaults;
	/**
	 * Font/asset manifest identity (`fontManifestHash()`). Part of the key, so
	 * a font load that changes metrics invalidates instead of serving pre-load
	 * measurements.
	 */
	manifestHash?: string;
}

export function getCachedLayout(
	paragraphs: readonly RichTextParagraph[],
	width: number,
	wrap: RichTextWrap,
	compute: () => MeasuredText,
	options: LayoutCacheKeyOptions = {},
): MeasuredText {
	let byKey = cache.get(paragraphs);
	if (!byKey) {
		byKey = new Map();
		cache.set(paragraphs, byKey);
	}
	const key = `${width}|${wrap}|${options.manifestHash ?? ""}|${styleKeyFor(options.defaults)}`;
	let measured = byKey.get(key);
	if (!measured) {
		measured = compute();
		byKey.set(key, measured);
	}
	return measured;
}
