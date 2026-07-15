"use client";

import { useSyncExternalStore } from "react";

/**
 * B-14 responsive breakpoints (FR-132): subscribe to a CSS media query via
 * `matchMedia` + `useSyncExternalStore`. Returns `false` wherever
 * `matchMedia` is unavailable (SSR snapshot, bare jsdom) so the desktop
 * layout is always the fallback.
 */
export function useMediaQuery(query: string): boolean {
	return useSyncExternalStore(
		(onChange) => {
			if (typeof window.matchMedia !== "function") {
				return () => undefined;
			}
			const mql = window.matchMedia(query);
			mql.addEventListener("change", onChange);
			return () => mql.removeEventListener("change", onChange);
		},
		() =>
			typeof window.matchMedia === "function"
				? window.matchMedia(query).matches
				: false,
		() => false,
	);
}

/** ≤768px: the Tab Panel floats over the canvas instead of docking (FR-132). */
export const OVERLAY_PANEL_QUERY = "(max-width: 768px)";
/** ≤1024px: the inspector starts collapsed to keep the canvas usable. */
export const COLLAPSE_INSPECTOR_QUERY = "(max-width: 1024px)";
