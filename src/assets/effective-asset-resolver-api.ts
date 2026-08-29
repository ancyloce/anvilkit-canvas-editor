import type {
	CanvasEffectiveAssetTable,
	ResolveEffectiveAssetTableOptions,
} from "./effective-asset-resolver.js";

export type {
	CanvasAssetResolutionStatus,
	CanvasAssetResolveContext,
	CanvasAssetResolver,
	CanvasAssetResolverResult,
	CanvasEffectiveAssetEntry,
	CanvasEffectiveAssetSource,
	CanvasEffectiveAssetTable,
	ResolveEffectiveAssetTableOptions,
} from "./effective-asset-resolver.js";

/**
 * Resolve one immutable effective table for every renderer/exporter in a run.
 * The resolver implementation is loaded on demand because every call is
 * asynchronous and a document with only portable URLs needs no resolver work.
 */
export async function resolveEffectiveAssetTable(
	options: ResolveEffectiveAssetTableOptions,
): Promise<CanvasEffectiveAssetTable> {
	const module = await import("./effective-asset-resolver.js");
	return module.resolveEffectiveAssetTable(options);
}
