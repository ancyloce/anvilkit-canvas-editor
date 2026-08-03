"use client";

import { useEffect, useSyncExternalStore } from "react";
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
	/** Monotonic; bumps on every real status transition. See {@link fontManifestHash}. */
	version: number;
	setStatus: (family: string, status: CanvasFontStatus) => void;
}

const fontStatusStore: StoreApi<FontStatusState> =
	createStore<FontStatusState>()((set) => ({
		statuses: new Map(),
		version: 0,
		setStatus(family, status) {
			set((state) => {
				if (state.statuses.get(family) === status) return state;
				const next = new Map(state.statuses);
				next.set(family, status);
				return { statuses: next, version: state.version + 1 };
			});
		},
	}));

/**
 * Identity of the font manifest in force, for measurement-cache keys
 * (T-M3-04 step 4). Any font lifecycle transition changes it, so
 * measurements made with fallback metrics before a font finished loading can
 * never be served after it loads — the stale entries are simply never keyed
 * again and are collected with their `paragraphs`. Also what the editor's
 * `CanvasLayoutMeasurementProvider.manifestHash` reports to the resolver.
 */
export function fontManifestHash(): string {
	return String(fontStatusStore.getState().version);
}

/**
 * Subscribe to font-manifest changes (any status transition). Returns the
 * unsubscribe. The resolved-document store uses this so a font load that
 * changes metrics re-resolves Hug-sized text containers instead of leaving
 * them at fallback-metric sizes until the next edit.
 */
export function subscribeFontManifest(listener: () => void): () => void {
	let last = fontStatusStore.getState().version;
	return fontStatusStore.subscribe((state) => {
		if (state.version !== last) {
			last = state.version;
			listener();
		}
	});
}

/** Generic families the platform always has — never worth observing. */
const GENERIC_FAMILIES = new Set([
	"serif",
	"sans-serif",
	"monospace",
	"cursive",
	"fantasy",
	"system-ui",
]);

/** The Font Loading API, or undefined where it does not exist (jsdom/SSR). */
function fontFaceSet(): FontFaceSet | undefined {
	const fonts = (
		typeof document !== "undefined"
			? (document as { fonts?: FontFaceSet }).fonts
			: undefined
	) as FontFaceSet | undefined;
	return fonts && typeof fonts.load === "function" ? fonts : undefined;
}

/** Quoting matters: `document.fonts` APIs take a CSS font shorthand. */
function fontSpec(family: string): string {
	return `16px "${family.replace(/"/g, '\\"')}"`;
}

/**
 * Status of a family WITHOUT observing it — a pure read, safe during render.
 *
 * Every write path here is a side effect that fans out well past this module:
 * `setStatus` bumps the manifest, which `resolved-document-store.connect`
 * turns into a synchronous re-resolution of the whole document, which updates
 * every mounted geometry consumer. Doing that from a render pass is React's
 * "Cannot update a component while rendering a different component". So the
 * render-phase answer is computed, never recorded; {@link observeFontFamily}
 * records it from an effect.
 */
export function peekFontStatus(family: string | undefined): CanvasFontStatus {
	if (!family || GENERIC_FAMILIES.has(family)) return "loaded";
	const current = fontStatusStore.getState().statuses.get(family);
	if (current) return current;
	const fonts = fontFaceSet();
	if (!fonts) return "fallback";
	if (typeof fonts.check === "function" && fonts.check(fontSpec(family))) {
		return "loaded";
	}
	return "loading";
}

/**
 * Begin observing a family (idempotent). Returns its current status.
 *
 * WRITES the registry, so callers must be outside render — an effect, an event
 * handler, or non-React code. Use {@link peekFontStatus} to read during render.
 */
export function observeFontFamily(
	family: string | undefined,
): CanvasFontStatus {
	if (!family || GENERIC_FAMILIES.has(family)) return "loaded";
	const current = fontStatusStore.getState().statuses.get(family);
	if (current) return current;
	const status = peekFontStatus(family);
	fontStatusStore.getState().setStatus(family, status);
	// `fallback`/`loaded` are terminal; only `loading` has a load to await, and
	// it is reached solely through a usable FontFaceSet.
	const fonts = status === "loading" ? fontFaceSet() : undefined;
	if (!fonts) return status;
	fonts
		.load(fontSpec(family))
		.then((faces) => {
			fontStatusStore
				.getState()
				.setStatus(family, faces.length > 0 ? "loaded" : "missing");
		})
		.catch(() => {
			fontStatusStore.getState().setStatus(family, "error");
		});
	return status;
}

/**
 * Reactive status for one family. Kicks off observation on mount; the
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
	// Observation is a store write (see `peekFontStatus`) — it must happen after
	// the render pass, never inside it.
	useEffect(() => {
		observeFontFamily(family);
	}, [family]);
	if (!family) return "loaded";
	return status ?? peekFontStatus(family);
}

/** Test seam: reset the module registry between cases. */
export function resetFontStatusesForTests(): void {
	fontStatusStore.setState({ statuses: new Map(), version: 0 });
}
