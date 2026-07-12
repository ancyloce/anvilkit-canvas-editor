import type {
	BrandTokenRef,
	CanvasFill,
	CanvasFontFamily,
	CanvasGradientFill,
} from "@anvilkit/canvas-core";
import type { BrandKit } from "./brand-kit.js";

/**
 * Lowercase, non-alphanumeric-collapsing slug — the forward-compat identity
 * a `BrandColor`/font with no explicit id resolves against. See
 * {@link BrandColor.id}.
 */
function slug(value: string): string {
	return value
		.trim()
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/(^-+|-+$)/g, "");
}

/**
 * Resolve a `BrandTokenRef` (`@anvilkit/canvas-core`) against the editor's
 * `BrandKit` — the SAME resolution the stage, the offscreen rasterizer, and
 * a host's SVG exporter (via core's `SvgSerializeOptions.resolveBrandToken`)
 * all call, so a document renders identically everywhere.
 *
 * Interim bridge (canvas-m1-013) ahead of FR-031's canonical M2 brand-kit
 * contract: `BrandKit` only models colors and font-family names today, so
 * `"color"` and `"font"` are the only resolvable `tokenType`s.
 * `"spacing"`/`"asset"`/`"logo"` have no `BrandKit` shape yet and always
 * resolve to `undefined` — a real ref the schema admits, degrading
 * deterministically rather than crashing.
 *
 * - `"color"`: matches a `BrandColor` by explicit `id`, else by
 *   `slug(color.name)`; returns its `value`.
 * - `"font"`: matches a font-family string in `brandKit.fonts` by
 *   `slug(font)`; returns the font string itself.
 */
export function resolveBrandToken(
	ref: BrandTokenRef,
	brandKit: BrandKit,
): string | CanvasGradientFill | undefined {
	if (ref.tokenType === "color") {
		const match = brandKit.colors.find(
			(color) => (color.id ?? slug(color.name)) === ref.id,
		);
		return match?.value;
	}
	if (ref.tokenType === "font") {
		return brandKit.fonts.find((font) => slug(font) === ref.id);
	}
	return undefined;
}

/** A field's resolved display value, plus whether it started as an unresolved token. */
export interface ResolvedDisplayValue<T> {
	readonly value: T | undefined;
	/** True only for a `BrandTokenRef` that did not resolve — never for a plain/absent value. */
	readonly unresolved: boolean;
}

/**
 * Resolve a `fill` FIELD (which may be a plain color, a gradient, a brand
 * token, or absent) to something paintable, for every read path that
 * currently assumes `string | CanvasGradientFill` — `fillProps` (stage),
 * `rasterizePage` (via the same renderer), `TextEditorOverlay`'s inline
 * style, and the inspector's fill controls. A token with no match (or no
 * resolver — `brandKit` here is always `EMPTY_BRAND_KIT` at minimum, never
 * absent) degrades to `undefined` with `unresolved: true` rather than
 * throwing, matching core's SVG serializer's `BRAND_TOKEN_UNRESOLVED` degrade.
 */
export function resolveFillForDisplay(
	fill: CanvasFill | undefined,
	brandKit: BrandKit,
): ResolvedDisplayValue<string | CanvasGradientFill> {
	if (fill === undefined) return { value: undefined, unresolved: false };
	if (typeof fill === "string") return { value: fill, unresolved: false };
	if ("kind" in fill) return { value: fill, unresolved: false };
	const resolved = resolveBrandToken(fill, brandKit);
	return { value: resolved, unresolved: resolved === undefined };
}

/** `resolveFillForDisplay`'s font-family counterpart — always resolves to a plain string or nothing. */
export function resolveFontFamilyForDisplay(
	fontFamily: CanvasFontFamily,
	brandKit: BrandKit,
): ResolvedDisplayValue<string> {
	if (typeof fontFamily === "string") {
		return { value: fontFamily, unresolved: false };
	}
	const resolved = resolveBrandToken(fontFamily, brandKit);
	const value = typeof resolved === "string" ? resolved : undefined;
	return { value, unresolved: value === undefined };
}
