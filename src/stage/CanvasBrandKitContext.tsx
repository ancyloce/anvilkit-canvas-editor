"use client";

import { createContext, use } from "react";
import type { BrandKit } from "../brand/brand-kit.js";
import { EMPTY_BRAND_KIT } from "../brand/brand-kit.js";

/**
 * Narrow, internal-only context carrying just the `BrandKit` a node renderer
 * needs to resolve a `BrandTokenRef` fill/font. Deliberately separate from
 * the full {@link CanvasStudioContext} (mirrors {@link CanvasAssetsContext}'s
 * existing pattern): `CanvasNodeRenderer` mounts in TWO places — the live
 * `<CanvasStudio>` stage (which already has the full context) and
 * `rasterizePage`'s offscreen render (which does not, and has no reason to
 * fake one just to get a brand kit). Both provide this instead. Not exported
 * publicly — a host reaches the same data via `useBrandKit()` /
 * `<CanvasStudio brandKit>`.
 */
export const CanvasBrandKitContext = createContext<BrandKit>(EMPTY_BRAND_KIT);

export function useCanvasBrandKit(): BrandKit {
	return use(CanvasBrandKitContext);
}
