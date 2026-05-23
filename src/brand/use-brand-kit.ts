"use client";

import { useCanvasStudio } from "../context/canvas-studio-context.js";
import {
	type BrandColor,
	type BrandKit,
	EMPTY_BRAND_KIT,
} from "./brand-kit.js";

/**
 * The host {@link BrandKit} (colors + fonts) from the Studio config, or
 * {@link EMPTY_BRAND_KIT} when none is configured. Always returns a
 * well-formed kit so callers never branch on `undefined`.
 */
export function useBrandKit(): BrandKit {
	return useCanvasStudio().brandKit ?? EMPTY_BRAND_KIT;
}

/** Just the brand color swatches (empty array when none configured). */
export function useBrandColors(): readonly BrandColor[] {
	return useBrandKit().colors;
}

/**
 * Just the brand font families (empty array when none configured). The
 * first entry, when present, is the brand default font.
 */
export function useBrandFonts(): readonly string[] {
	return useBrandKit().fonts;
}
