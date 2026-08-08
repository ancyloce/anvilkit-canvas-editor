import {
	type CanvasElementProvider,
	createLazyElementProvider,
	createStaticElementProvider,
} from "./element-provider.js";

/**
 * The eager-safe seam onto the default element catalog (`cp3-002`).
 *
 * WHY THIS IS ITS OWN MODULE AND NOT THREE LINES IN THE CATALOG.
 *
 * `default-element-catalog.ts` is ~180 KB of icon geometry. A module that
 * exports both the data and a "load it lazily" helper is not lazy: importing
 * the helper imports the module, and the bundler puts the whole thing in
 * whichever chunk the importer lives in. So the `import()` lives HERE, in a
 * file that imports nothing but the provider contract — the catalog is reachable
 * from `src/` over exactly one edge, and that edge is dynamic.
 *
 * `cp3-003` should import this and nothing else:
 *
 * ```ts
 * import { createDefaultElementProvider } from "../elements/default-element-provider.js";
 * const provider = props.elementProvider ?? createDefaultElementProvider();
 * ```
 *
 * The verification that this actually holds is not "we were careful": it is
 * walking the esbuild metafile's `import-statement` edges from the package
 * entry and confirming the catalog is reachable only over a `dynamic-import`
 * edge. `cp1-005` and `cp2-006` both did the same, and `cp6-002` re-runs it,
 * because the budget number alone once measured an 884-byte dialog chunk
 * against a 409,600-byte budget and reported OK.
 */

/**
 * A provider over the built-in catalog, fetched on first `search`/`getById`.
 *
 * Cheap to call: it allocates a wrapper, not a catalog. Nothing is fetched
 * until the panel actually asks a question, which is `cp3-003`'s "load on first
 * panel open, not at editor mount". A failed load is not cached
 * ({@link createLazyElementProvider}), so a Retry button keeps working.
 *
 * Call it once per host and keep the result — a second call is a second chunk
 * fetch's worth of promise bookkeeping and a second parsed catalog.
 */
export function createDefaultElementProvider(options?: {
	readonly pageSize?: number;
}): CanvasElementProvider {
	return createLazyElementProvider(async () => {
		const { DEFAULT_ELEMENTS } = await import("./default-element-catalog.js");
		return createStaticElementProvider(DEFAULT_ELEMENTS, options ?? {});
	});
}
