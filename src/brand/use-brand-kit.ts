"use client";

import type {
	BrandAsset,
	BrandKitDefinition,
	BrandRule,
	BrandTypographyPreset,
} from "@anvilkit/canvas-core";
import { useCanvasStores } from "../context/canvas-studio-context.js";
import {
	type BrandColor,
	type BrandKit,
	EMPTY_BRAND_KIT,
} from "./brand-kit.js";

/**
 * The host {@link BrandKit} from the Studio config, or {@link EMPTY_BRAND_KIT}
 * when none is configured. Always returns a well-formed kit so callers never
 * branch on `undefined`.
 */
export function useBrandKit(): BrandKit {
	return useCanvasStores().brandKit ?? EMPTY_BRAND_KIT;
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

/** Just the brand logo/image assets (empty array when none configured). */
export function useBrandLogos(): readonly BrandAsset[] {
	return useBrandKit().logos ?? [];
}

/** Just the brand typography presets (empty array when none configured). */
export function useBrandTypography(): readonly BrandTypographyPreset[] {
	return useBrandKit().typography ?? [];
}

/**
 * Just the brand's allowed/forbidden color and font rules (empty array when
 * none configured) — consumed by canvas-m2-006's compliance report.
 */
export function useBrandRules(): readonly BrandRule[] {
	return useBrandKit().rules ?? [];
}

/**
 * The full `BrandKitDefinition` the current kit was mapped from, or
 * `undefined` when the host only configured the legacy `StudioConfig.brandKit`
 * (colors/fonts only, no definition) — see `BrandKit.sourceDefinition`. The
 * apply-brand-kit actions (canvas-m2-006) need this; UI that only reads
 * colors/fonts/logos/etc. should keep using the other `useBrand*` hooks.
 */
export function useBrandKitDefinition(): BrandKitDefinition | undefined {
	return useBrandKit().sourceDefinition;
}
