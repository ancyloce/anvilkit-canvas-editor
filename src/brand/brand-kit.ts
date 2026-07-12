/**
 * A single named brand color — a swatch the canvas surfaces (color
 * pickers, the property inspector) so designs stay on-brand.
 */
export interface BrandColor {
	/**
	 * Stable identifier a `BrandTokenRef` (`@anvilkit/canvas-core`,
	 * `tokenType: "color"`) resolves against. Optional, forward-compatible
	 * bridge (canvas-m1-013) until FR-031's canonical brand-kit contract
	 * lands in M2: when omitted, {@link resolveBrandToken} falls back to a
	 * slug of `name` (lowercased, non-alphanumeric runs collapsed to `-`) —
	 * e.g. `"Primary Blue"` → `"primary-blue"`. A host that wants stable ids
	 * independent of a color's display name should set this explicitly.
	 */
	readonly id?: string;
	/** Human label, e.g. "Primary", "Accent". */
	readonly name: string;
	/** Any CSS color value, e.g. "#2563eb" or "var(--brand)". */
	readonly value: string;
}

/**
 * Shared brand colors + font families surfaced to the canvas editor
 * (I3-4). Sourced from the host's Studio config — `plugin-canvas-studio`'s
 * `CanvasModeOverlay` maps `StudioConfig.brandKit`/`branding` → `BrandKit`
 * and passes it via the `<CanvasStudio brandKit>` prop. Read it through
 * {@link useBrandKit}, which normalizes the absent case to
 * {@link EMPTY_BRAND_KIT}.
 */
export interface BrandKit {
	readonly colors: readonly BrandColor[];
	/**
	 * Font-family names, e.g. `["Inter", "Poppins"]`. The first entry is
	 * treated as the brand default.
	 */
	readonly fonts: readonly string[];
}

/**
 * Stable empty kit returned by {@link useBrandKit} when the host has not
 * configured one. Module-level constant so the reference is stable across
 * renders (no per-render allocation).
 */
export const EMPTY_BRAND_KIT: BrandKit = { colors: [], fonts: [] };
