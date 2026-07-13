import type {
	BrandAsset,
	BrandImageStylePreset,
	BrandKitDefinition,
	BrandRule,
	BrandToneMetadata,
	BrandTypographyPreset,
} from "@anvilkit/canvas-core";

/**
 * A single named brand color — a swatch the canvas surfaces (color
 * pickers, the property inspector) so designs stay on-brand.
 *
 * Structurally identical to `@anvilkit/canvas-core`'s canonical
 * `BrandColorToken` (FR-031, canvas-m2-005) by design — this is what lets
 * {@link brandKitDefinitionToBrandKit} pass colors through unchanged.
 */
export interface BrandColor {
	/**
	 * Stable identifier a `BrandTokenRef` (`@anvilkit/canvas-core`,
	 * `tokenType: "color"`) resolves against. When omitted,
	 * {@link resolveBrandToken} falls back to a slug of `name` (lowercased,
	 * non-alphanumeric runs collapsed to `-`) — e.g. `"Primary Blue"` →
	 * `"primary-blue"`. A host that wants stable ids independent of a color's
	 * display name should set this explicitly.
	 */
	readonly id?: string;
	/** Human label, e.g. "Primary", "Accent". */
	readonly name: string;
	/** Any CSS color value, e.g. "#2563eb" or "var(--brand)". */
	readonly value: string;
}

/**
 * Shared brand data surfaced to the canvas editor (I3-4, upgraded to the
 * canonical FR-020 contract's full shape in canvas-m2-005). Sourced from the
 * host's Studio config — `plugin-canvas-studio`'s `CanvasModeOverlay` maps
 * `StudioConfig.brandKit`/`branding` → `BrandKit` and passes it via the
 * `<CanvasStudio brandKit>` prop. Read it through {@link useBrandKit}, which
 * normalizes the absent case to {@link EMPTY_BRAND_KIT}.
 *
 * `colors`/`fonts` keep their pre-existing shapes (`BrandColor[]`/`string[]`)
 * and REQUIRED-ness, for backward compatibility with every existing consumer
 * and every existing object literal that constructs a `BrandKit` with just
 * those two fields (`resolveBrandToken`, `PropertyInspector`,
 * `CanvasNodeRenderer`, the demo app's fixture, test suites, …). The
 * remaining fields mirror `BrandKitDefinition` but stay OPTIONAL here — read
 * them via {@link useBrandLogos}/{@link useBrandTypography}/
 * {@link useBrandRules}, which normalize an absent field to `[]`, the same
 * pattern {@link useBrandColors}/{@link useBrandFonts} already establish.
 */
export interface BrandKit {
	readonly id?: string;
	readonly name?: string;
	readonly colors: readonly BrandColor[];
	/**
	 * Font-family names, e.g. `["Inter", "Poppins"]`. The first entry is
	 * treated as the brand default.
	 */
	readonly fonts: readonly string[];
	/** Brand logo/image assets. Absent/empty when the host's kit carries none. */
	readonly logos?: readonly BrandAsset[];
	/** Named typography presets. Absent/empty when none are configured. */
	readonly typography?: readonly BrandTypographyPreset[];
	readonly imageStylePresets?: readonly BrandImageStylePreset[];
	readonly toneOfVoice?: BrandToneMetadata;
	/** Allowed/forbidden color and font rules — consumed by canvas-m2-006's compliance report. */
	readonly rules?: readonly BrandRule[];
	readonly defaultExportPresets?: readonly string[];
	/**
	 * The original `BrandKitDefinition` this kit was mapped from, when the
	 * host supplied one (canvas-m2-006). `fonts` above loses each font's `id`
	 * when it flattens to plain family-name strings — the apply-brand-kit
	 * actions (`applyBrandColors`, `replaceFonts`, `replaceLogoPlaceholders`,
	 * `normalizeTypography`, `generateBrandComplianceReport`) all need the
	 * full `BrandKitDefinition`, so `BrandPanel` reads it from here rather
	 * than reconstructing it. Absent when the host only configured the
	 * legacy `StudioConfig.brandKit` (colors/fonts only, no definition).
	 */
	readonly sourceDefinition?: BrandKitDefinition;
}

/**
 * Stable empty kit returned by {@link useBrandKit} when the host has not
 * configured one. Module-level constant so the reference is stable across
 * renders (no per-render allocation).
 */
export const EMPTY_BRAND_KIT: BrandKit = { colors: [], fonts: [] };

/**
 * Lossless mapping from the canonical `BrandKitDefinition` (FR-031) to the
 * editor's `BrandKit`. `colors` passes through unchanged (identical shape);
 * `fonts` flattens to the plain family-name strings existing consumers
 * (`useBrandFonts`, `resolveBrandToken`) already expect. Every other field —
 * logos, typography, image style presets, tone of voice, rules, default
 * export presets — passes through unchanged, nothing is dropped.
 */
export function brandKitDefinitionToBrandKit(
	definition: BrandKitDefinition,
): BrandKit {
	return {
		id: definition.id,
		name: definition.name,
		colors: definition.colors,
		fonts: definition.fonts.map((font) => font.family),
		logos: definition.logos,
		typography: definition.typography,
		imageStylePresets: definition.imageStylePresets,
		toneOfVoice: definition.toneOfVoice,
		rules: definition.rules,
		defaultExportPresets: definition.defaultExportPresets,
		sourceDefinition: definition,
	};
}
