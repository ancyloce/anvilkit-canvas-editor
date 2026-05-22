"use client";

import type { CanvasAssetRef, CanvasPage } from "@anvilkit/canvas-core";
import { useEffect, useRef, useState } from "react";
import { rasterizePage } from "../render/rasterize-page.js";

/** 32-bit FNV-1a hash of a string → hex. Cheap, deterministic content fingerprint. */
function fnv1a(str: string): string {
	let h = 0x811c9dc5;
	for (let i = 0; i < str.length; i += 1) {
		h ^= str.charCodeAt(i);
		h = Math.imul(h, 0x01000193);
	}
	return (h >>> 0).toString(16);
}

/**
 * A content fingerprint for a page's thumbnail. Changes whenever anything that
 * affects the render changes (size, background, any node prop/position), so a
 * cached thumbnail is reused until — and only until — the page actually changes.
 * Pure and deterministic. (`CanvasPage` has no per-page `updatedAt`, so we
 * fingerprint the serialized page.)
 */
export function pageThumbnailKey(page: CanvasPage): string {
	return `${page.id}:${fnv1a(JSON.stringify(page))}`;
}

export interface PageThumbnailsArgs {
	pages: readonly CanvasPage[];
	activePageId: string;
	assets: Record<string, CanvasAssetRef>;
	/** Injectable for tests; defaults to the real off-screen rasterizer. */
	rasterize?: typeof rasterizePage;
	/** Thumbnail render scale. Defaults to 1 (small previews). */
	pixelRatio?: number;
}

/**
 * I2-5 off-screen page tiling: rasterize each NON-active page to a cached data
 * URL ("off-screen thumbnails from cached `CanvasIR`"), so the navigator can
 * preview every artboard without mounting a live `<Stage>` per page. Each page
 * is rasterized once per content fingerprint ({@link pageThumbnailKey}) and
 * reused until it changes; the active page is skipped (it renders live).
 * Returns a map of `pageId → dataURL` (absent until the first rasterize settles).
 */
export function usePageThumbnails(
	args: PageThumbnailsArgs,
): Map<string, string> {
	const { pages, activePageId, assets } = args;
	const rasterize = args.rasterize ?? rasterizePage;
	const pixelRatio = args.pixelRatio ?? 1;
	const [urls, setUrls] = useState<Map<string, string>>(new Map());
	const cacheRef = useRef<Map<string, { key: string; url: string }>>(new Map());

	useEffect(() => {
		let cancelled = false;
		const publish = () => {
			if (cancelled) return;
			setUrls(
				new Map(Array.from(cacheRef.current, ([id, entry]) => [id, entry.url])),
			);
		};
		// Drop cache entries for pages that no longer exist.
		const liveIds = new Set(pages.map((p) => p.id));
		let pruned = false;
		for (const id of cacheRef.current.keys()) {
			if (!liveIds.has(id)) {
				cacheRef.current.delete(id);
				pruned = true;
			}
		}
		if (pruned) publish();

		for (const page of pages) {
			if (page.id === activePageId) continue; // active page is live
			const key = pageThumbnailKey(page);
			const cached = cacheRef.current.get(page.id);
			if (cached && cached.key === key) continue; // thumbnail still valid
			rasterize({ page, assets, pixelRatio })
				.then((res) => {
					if (cancelled) return;
					cacheRef.current.set(page.id, { key, url: res.url });
					publish();
				})
				.catch(() => {
					// A failed rasterize just leaves the previous (or no) thumbnail.
				});
		}
		return () => {
			cancelled = true;
		};
	}, [pages, activePageId, assets, rasterize, pixelRatio]);

	return urls;
}
