"use client";

import { createContext, use } from "react";

/**
 * Already-decoded images, keyed by asset URI, handed to the renderer by a
 * caller that has finished loading them (K-17).
 *
 * This exists because the offscreen rasterizer could not otherwise KNOW when
 * its images were ready. `rasterizePage` preloads every asset and awaits the
 * decodes, but the renderer then went through `use-image`, which builds its
 * OWN `HTMLImageElement` and reports `loading` until that second load settles
 * — so the rasterizer had nothing to wait on and guessed with two animation
 * frames. Usually the second load resolved from cache inside that window;
 * when it did not, the export silently contained a blank image, or the
 * placeholder chrome.
 *
 * Handing the decoded elements down makes the export path DETERMINISTIC: the
 * image is `loaded` on the first render, with no second load to race. It also
 * removes the duplicate decode of what can be a very large bitmap.
 *
 * Scoped to the render pass that provides it rather than a module-level cache
 * on purpose — a long-lived global map of `HTMLImageElement`s in an editor is
 * a leak, and the live editor has no readiness problem to solve (it re-renders
 * when `use-image` settles).
 */
export const CanvasDecodedImagesContext = createContext<ReadonlyMap<
	string,
	HTMLImageElement
> | null>(null);

/**
 * The pre-decoded element for `uri`, when the surrounding pass supplied one.
 * `undefined` in the live editor, which loads through `use-image` as before.
 */
export function useDecodedImage(uri: string): HTMLImageElement | undefined {
	const decoded = use(CanvasDecodedImagesContext);
	if (!uri) return undefined;
	return decoded?.get(uri);
}
