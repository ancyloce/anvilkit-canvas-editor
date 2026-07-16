"use client";

import { useSyncExternalStore } from "react";
import { createStore, type StoreApi } from "zustand/vanilla";

/**
 * FR-083 font loading states (C-11). A module-level registry keyed by font
 * family: observing a family kicks off a `document.fonts` load exactly once
 * and publishes its lifecycle, so canvas text re-renders (and re-measures)
 * when the real font arrives instead of staying stuck on fallback metrics.
 * Environments without the CSS Font Loading API (jsdom/SSR) report
 * `fallback` — never a crash (FR-083's hard requirement).
 */
export type CanvasFontStatus =
	| "loading"
	| "loaded"
	| "missing"
	| "fallback"
	| "error";

interface FontStatusState {
	statuses: ReadonlyMap<string, CanvasFontStatus>;
	setStatus: (family: string, status: CanvasFontStatus) => void;
}

const fontStatusStore: StoreApi<FontStatusState> =
	createStore<FontStatusState>()((set) => ({
		statuses: new Map(),
		setStatus(family, status) {
			set((state) => {
				if (state.statuses.get(family) === status) return state;
				const next = new Map(state.statuses);
				next.set(family, status);
				return { statuses: next };
			});
		},
	}));

/** Generic families the platform always has — never worth observing. */
const GENERIC_FAMILIES = new Set([
	"serif",
	"sans-serif",
	"monospace",
	"cursive",
	"fantasy",
	"system-ui",
]);

/**
 * Begin observing a family (idempotent). Returns its current status.
 * Quoting matters: `document.fonts` APIs take a CSS font shorthand.
 */
export function observeFontFamily(
	family: string | undefined,
): CanvasFontStatus {
	if (!family || GENERIC_FAMILIES.has(family)) return "loaded";
	const current = fontStatusStore.getState().statuses.get(family);
	if (current) return current;
	const fonts = (
		typeof document !== "undefined"
			? (document as { fonts?: FontFaceSet }).fonts
			: undefined
	) as FontFaceSet | undefined;
	if (!fonts || typeof fonts.load !== "function") {
		fontStatusStore.getState().setStatus(family, "fallback");
		return "fallback";
	}
	const spec = `16px "${family.replace(/"/g, '\\"')}"`;
	if (typeof fonts.check === "function" && fonts.check(spec)) {
		fontStatusStore.getState().setStatus(family, "loaded");
		return "loaded";
	}
	fontStatusStore.getState().setStatus(family, "loading");
	fonts
		.load(spec)
		.then((faces) => {
			fontStatusStore
				.getState()
				.setStatus(family, faces.length > 0 ? "loaded" : "missing");
		})
		.catch(() => {
			fontStatusStore.getState().setStatus(family, "error");
		});
	return "loading";
}

/**
 * Reactive status for one family. Kicks off observation on first use; the
 * consuming component re-renders when the load settles — which is what
 * forces Konva to re-draw text with the real font's metrics.
 */
export function useFontStatus(family: string | undefined): CanvasFontStatus {
	const status = useSyncExternalStore(
		fontStatusStore.subscribe,
		() =>
			family ? (fontStatusStore.getState().statuses.get(family) ?? null) : null,
		() =>
			family ? (fontStatusStore.getState().statuses.get(family) ?? null) : null,
	);
	if (!family) return "loaded";
	return status ?? observeFontFamily(family);
}

/** Test seam: reset the module registry between cases. */
export function resetFontStatusesForTests(): void {
	fontStatusStore.setState({ statuses: new Map() });
}
