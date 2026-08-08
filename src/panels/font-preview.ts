"use client";

import { type RefObject, useEffect, useRef, useState } from "react";
import type { CanvasFontCategory } from "../text/font-catalog.js";

/**
 * @file Preview plumbing for `FontPickerField` (PLAN-0035 §5 P2, `cp2-003`).
 *
 * Three concerns the picker component itself should not carry:
 *
 * 1. **Which options may load their face.** `cp2-002`'s default catalog is 37
 *    families, every one of them `source.kind === "css"` — so an option that
 *    renders in its own typeface is one stylesheet fetch. Rendering all 37
 *    eagerly is 37 fetches on open. {@link useFontPreviewVisible} gates that on
 *    IntersectionObserver visibility.
 * 2. **Loading the face at all.** No default entry carries `files`, so nothing
 *    here can synthesise a `@font-face`; the family becomes loadable only once
 *    its stylesheet is in the document. {@link ensureFontStylesheet} injects it
 *    exactly once per URL.
 * 3. **Matching a query against a family name.** See {@link foldFontText}.
 */

/**
 * How many options count as visible when there is NO IntersectionObserver.
 *
 * jsdom and SSR have no observer, and the two obvious degradations are both
 * wrong: observing nothing makes the load-count assertion vacuously true, and
 * observing everything makes it vacuously false — either way the gate this
 * module exists to enforce stops being tested. So the fallback is a FIXED
 * WINDOW of the first N options in rendered order, which is what a real
 * viewport would show and what an assertion can pin from both sides ("these
 * loaded, those did not").
 *
 * 8 is one popup's worth: `@anvilkit/ui/combobox`'s list caps at
 * `min(18rem - 2.25rem, …)` ≈ 252 px and an option row is ~28 px, so a real
 * viewport shows ~9. Deliberately a hair under, so the fallback can never
 * exceed what a browser would actually intersect.
 */
export const FONT_PREVIEW_FALLBACK_WINDOW = 8;

/**
 * Start loading a face slightly before it scrolls in, so the swap from the
 * fallback metrics happens off-screen rather than under the user's eye.
 */
const FONT_PREVIEW_ROOT_MARGIN = "64px";

/** Marks the `<link>` elements this module owns, for cleanup and for tests. */
export const FONT_PREVIEW_LINK_ATTRIBUTE = "data-ak-font-preview";

/**
 * The generic each category degrades to. Purely a rendering fallback — it is
 * what the option shows while the real face is still loading or unavailable,
 * which is why an option is never blank.
 */
const CATEGORY_FALLBACK: Record<CanvasFontCategory, string> = {
	sans: "sans-serif",
	serif: "serif",
	slab: "serif",
	mono: "monospace",
	display: "sans-serif",
	handwriting: "cursive",
};

/**
 * A CSS `font-family` stack for one catalog family.
 *
 * The family is quoted and escaped the same way `font-status.ts`'s `fontSpec`
 * escapes it for `document.fonts` — a family name is author data and may
 * contain a quote.
 */
export function fontPreviewStack(
	family: string,
	category?: CanvasFontCategory,
): string {
	const escaped = family.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
	return `"${escaped}", ${category ? CATEGORY_FALLBACK[category] : "sans-serif"}`;
}

/**
 * Fold a family name or a search query to a comparable form.
 *
 * `toLowerCase().includes()` is not enough, for two separate reasons:
 *
 * - **Normalisation.** "Lató" is one string in NFC (`ó` = U+00F3) and another
 *   in NFD (`o` + U+0301). A catalog written in one form and a query typed (or
 *   pasted, or IME-composed) in the other never match as raw strings. Folding
 *   BOTH sides through the same decomposition removes the difference.
 * - **Diacritic tolerance.** Typing `lato` should find `Lató`; a user cannot be
 *   asked to reproduce an accent to find a font. Dropping combining marks after
 *   NFD gives that, and it is symmetric — `lató` still finds `Lato`.
 *
 * `toLowerCase()` and NOT `toLocaleLowerCase()`, deliberately: the Turkish
 * locale maps `I` to `ı`, which would stop a Turkish user finding `Inter`.
 *
 * Known over-match, accepted: NFD also decomposes the Japanese voiced-sound
 * marks (`ガ` → `カ` + U+3099, a `\p{Diacritic}`), so `カ` matches `ガ`. For a
 * search box that is a helpful widening, not a wrong answer. Hangul syllables
 * decompose to jamo, which carry no diacritic and are folded identically on
 * both sides, so Korean family names match exactly as before.
 *
 * `Intl.Collator` was considered and rejected: it compares and sorts, and
 * there is no standard collated *substring* search to build "contains" on.
 */
export function foldFontText(input: string): string {
	return input
		.normalize("NFD")
		.replace(/\p{Diacritic}/gu, "")
		.toLowerCase()
		.trim();
}

/** Whether `family` matches `query` under {@link foldFontText}. */
export function matchesFontFamily(family: string, query: string): boolean {
	const folded = foldFontText(query);
	return folded === "" || foldFontText(family).includes(folded);
}

/** In-flight/settled stylesheet loads, keyed by URL. Module-level by design. */
const stylesheets = new Map<string, Promise<void>>();

/**
 * Inject a family's stylesheet exactly once, resolving when it settles.
 *
 * Every default catalog entry is `{ kind: "css", css }` with no `files`
 * (`cp2-002`), so this is the ONLY way a preview face can become available.
 * Resolves on `error` as well as `load`: an offline host must fall through to
 * the fallback face rather than hang, which is the `"fallback"` state
 * `font-status.ts` already models as first-class rather than as an error.
 *
 * SSR-safe: with no `document` it resolves immediately and injects nothing.
 */
export function ensureFontStylesheet(href: string): Promise<void> {
	const existing = stylesheets.get(href);
	if (existing) return existing;
	if (typeof document === "undefined") {
		const resolved = Promise.resolve();
		stylesheets.set(href, resolved);
		return resolved;
	}
	const link = document.createElement("link");
	link.rel = "stylesheet";
	link.href = href;
	link.setAttribute(FONT_PREVIEW_LINK_ATTRIBUTE, "");
	const settled = new Promise<void>((resolve) => {
		link.addEventListener("load", () => resolve(), { once: true });
		link.addEventListener("error", () => resolve(), { once: true });
	});
	document.head.appendChild(link);
	stylesheets.set(href, settled);
	return settled;
}

/**
 * Whether this environment can actually load a font face.
 *
 * Mirrors `font-status.ts`'s private `fontFaceSet()` guard rather than
 * exporting it: that module is consumed by the stage renderer, and widening
 * its surface for a panel-local branch is a worse trade than four lines.
 */
export function hasFontLoadingApi(): boolean {
	if (typeof document === "undefined") return false;
	const fonts = (document as { fonts?: FontFaceSet }).fonts;
	return fonts !== undefined && typeof fonts.load === "function";
}

/** Test seam: drop injected stylesheets and the module's memo of them. */
export function resetFontStylesheetsForTests(): void {
	stylesheets.clear();
	if (typeof document === "undefined") return;
	for (const link of document.querySelectorAll(
		`link[${FONT_PREVIEW_LINK_ATTRIBUTE}]`,
	)) {
		link.remove();
	}
}

/**
 * Gate an option's face on it actually being on screen.
 *
 * Latching, not toggling: once an option has been seen, its face stays loaded
 * even if the user scrolls it back out. Un-loading would re-fetch on the next
 * pass, which is the opposite of what the gate is for.
 *
 * `index` is the option's position in the CURRENTLY RENDERED list (after the
 * category filter and the search query), because that is the order the
 * fallback window has to approximate — see
 * {@link FONT_PREVIEW_FALLBACK_WINDOW}.
 */
export function useFontPreviewVisible(index: number): {
	ref: RefObject<HTMLSpanElement | null>;
	visible: boolean;
} {
	const ref = useRef<HTMLSpanElement | null>(null);
	const [visible, setVisible] = useState(false);
	useEffect(() => {
		if (visible) return;
		if (typeof IntersectionObserver === "undefined") {
			if (index < FONT_PREVIEW_FALLBACK_WINDOW) setVisible(true);
			return;
		}
		const element = ref.current;
		if (!element) return;
		const observer = new IntersectionObserver(
			(entries) => {
				if (entries.some((entry) => entry.isIntersecting)) setVisible(true);
			},
			{ rootMargin: FONT_PREVIEW_ROOT_MARGIN },
		);
		observer.observe(element);
		return () => observer.disconnect();
	}, [index, visible]);
	return { ref, visible };
}
