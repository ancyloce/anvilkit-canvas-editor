import type Konva from "konva";

/**
 * Selection-chrome colors, sourced from the editor's shadcn/Tailwind theme
 * tokens (`--primary`, `--background`, …) so the chrome follows the host theme
 * (light/dark) instead of hardcoded values.
 */
export interface ChromeTheme {
	/** Accent for the border + resize handles (`--primary`). */
	accent: string;
	/** Resting handle / surface fill (`--background`). */
	surface: string;
	/** Foreground on a surface — badge bg, rotate-icon glyph (`--foreground`). */
	onSurface: string;
	/** Hairline border for the rotate-icon button (`--border`). */
	border: string;
}

/** Light-theme token defaults (mirrors `styles.src.css` `:root`). */
export const FALLBACK_CHROME_THEME: ChromeTheme = {
	accent: "oklch(0.205 0 0)",
	surface: "oklch(1 0 0)",
	onSurface: "oklch(0.145 0 0)",
	border: "oklch(0.922 0 0)",
};

/**
 * Read the shadcn theme tokens off the stage container's computed style.
 * Custom properties inherit, so this picks up the active light/dark values.
 * Falls back to the light defaults when the DOM/value is unavailable (SSR,
 * jsdom, pre-mount).
 */
export function resolveChromeTheme(el: HTMLElement | null): ChromeTheme {
	if (!el || typeof getComputedStyle !== "function")
		return FALLBACK_CHROME_THEME;
	const cs = getComputedStyle(el);
	const read = (name: string, fallback: string) =>
		cs.getPropertyValue(name).trim() || fallback;
	return {
		accent: read("--primary", FALLBACK_CHROME_THEME.accent),
		surface: read("--background", FALLBACK_CHROME_THEME.surface),
		onSurface: read("--foreground", FALLBACK_CHROME_THEME.onSurface),
		border: read("--border", FALLBACK_CHROME_THEME.border),
	};
}

/**
 * Tint an anchor on hover: the dragger under the cursor fills with the accent,
 * reverting to the surface fill on leave. The accent is hover feedback on the
 * handles themselves (no persistent colored block).
 */
export function setAnchorHovered(
	anchor: Konva.Rect,
	hovered: boolean,
	accent: string,
	surface: string,
): void {
	anchor.fill(hovered ? accent : surface);
	anchor.getLayer?.()?.batchDraw?.();
}

/**
 * Normalize a rotation (degrees) to the readable `(-180, 180]` range used by the
 * angle readout, e.g. `229 → -131`, `-200 → 160`.
 */
export function normalizeAngle(deg: number): number {
	let a = deg % 360;
	if (a > 180) a -= 360;
	if (a <= -180) a += 360;
	return a;
}

interface Box {
	x: number;
	y: number;
	width: number;
	height: number;
}

/**
 * Axis-aligned union of the selected nodes' bounding boxes, in `layer`
 * (design) coordinates. During a transform each node already carries its live
 * resize scale, so the rect reflects the dimensions being dragged. Returns null
 * when nothing resolves (empty selection / detached nodes).
 */
export function selectionBox(
	stage: Konva.Stage,
	ids: readonly string[],
	layer: Konva.Node | null,
): Box | null {
	let minX = Number.POSITIVE_INFINITY;
	let minY = Number.POSITIVE_INFINITY;
	let maxX = Number.NEGATIVE_INFINITY;
	let maxY = Number.NEGATIVE_INFINITY;
	let found = false;
	for (const id of ids) {
		const node = stage.findOne(`.${id}`);
		if (!node) continue;
		const r = node.getClientRect({
			relativeTo: (layer ?? undefined) as Konva.Container | undefined,
			skipShadow: true,
		});
		minX = Math.min(minX, r.x);
		minY = Math.min(minY, r.y);
		maxX = Math.max(maxX, r.x + r.width);
		maxY = Math.max(maxY, r.y + r.height);
		found = true;
	}
	if (!found) return null;
	return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}
