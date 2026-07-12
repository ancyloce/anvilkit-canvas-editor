import type {
	MeasuredText,
	RichTextParagraph,
	RichTextWrap,
} from "@anvilkit/canvas-core";

/**
 * Memoizes a rich-text layout by the node's `paragraphs` ARRAY reference, not
 * the node object itself.
 *
 * `ir/mutations.ts`'s `mergeNodePatch` shallow-spreads `{ ...node, ...patch }`
 * on every command — including a transform-only patch, which is what every
 * frame of a drag applies. That produces a new `node` object each frame but
 * keeps the same `paragraphs` reference, so keying on `node` would re-measure
 * on every drag frame: the exact single-pass-mutation regression
 * `perf/static-cache.ts` already had to fix once, one layer up. Keying on the
 * stable sub-reference instead makes a drag frame a cache hit.
 *
 * Assumes callers always pass the same `defaults` object for a given cache
 * (true for the stage renderer's one call site, a module-level constant) —
 * `defaults` is deliberately not part of the key.
 */
const cache = new WeakMap<
	readonly RichTextParagraph[],
	Map<string, MeasuredText>
>();

export function getCachedLayout(
	paragraphs: readonly RichTextParagraph[],
	width: number,
	wrap: RichTextWrap,
	compute: () => MeasuredText,
): MeasuredText {
	let byKey = cache.get(paragraphs);
	if (!byKey) {
		byKey = new Map();
		cache.set(paragraphs, byKey);
	}
	const key = `${width}|${wrap}`;
	let measured = byKey.get(key);
	if (!measured) {
		measured = compute();
		byKey.set(key, measured);
	}
	return measured;
}
