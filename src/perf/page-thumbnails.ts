"use client";

import type {
	CanvasAssetRef,
	CanvasPage,
	CanvasResolvedDocument,
} from "@anvilkit/canvas-core";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { rasterizePage } from "../render/rasterize-page.js";
import {
	type CanvasInteractionPerformanceTracker,
	useCanvasInteractionActive,
} from "./interaction-performance.js";

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
	/**
	 * T-M3-10: the live resolution, so thumbnails of layout-bearing pages draw
	 * resolved geometry like the live stage does. Previews cannot taint a
	 * thumbnail — they only apply to selected (active-page) nodes and the
	 * active page never rasterizes here. `pageThumbnailKey` stays a valid cache
	 * key: resolution is a deterministic function of the fingerprinted page.
	 */
	resolvedDocument?: CanvasResolvedDocument;
	interactionPerformance?: CanvasInteractionPerformanceTracker;
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
	const {
		pages,
		activePageId,
		assets,
		resolvedDocument,
		interactionPerformance,
	} = args;
	const rasterize = args.rasterize ?? rasterizePage;
	const pixelRatio = args.pixelRatio ?? 1;
	const resolvedNodeCount = resolvedDocument?.records.size ?? 0;
	const thumbnailBatchSize =
		resolvedNodeCount >= 5_000
			? 2
			: resolvedNodeCount >= 1_000
				? 4
				: pages.length;
	const interactionActive = useCanvasInteractionActive(interactionPerformance);
	// E3-T2: a refreshed signed URL or newly rehydrated object URL changes
	// pixels even when the page tree is byte-identical.
	const assetFingerprint = useMemo(
		() => fnv1a(JSON.stringify(assets)),
		[assets],
	);
	const [urls, setUrls] = useState<Map<string, string>>(new Map());
	const cacheRef = useRef<Map<string, { key: string; url: string }>>(new Map());
	// Fingerprint currently being rasterized for a page id, so a re-run of this
	// effect (e.g. a remote-collab commit stream, or any OTHER page's content
	// changing and recreating the `pages` array) doesn't launch a second
	// concurrent off-screen `createRoot` + stage rasterize for the same page
	// at the same content version while the first is still in flight (E-15).
	const pendingRef = useRef<
		Map<string, { key: string; promise: Promise<void> }>
	>(new Map());

	/**
	 * Latest resolution, read at rasterize time rather than depended on (T-4.3).
	 * `resolvedDocument` changes identity on EVERY resolution — including every
	 * frame of a live preview — so keeping it in the dependency array re-ran the
	 * whole effect at pointer rate.
	 */
	const resolvedRef = useRef(resolvedDocument);
	useLayoutEffect(() => {
		resolvedRef.current = resolvedDocument;
	}, [resolvedDocument]);

	/**
	 * The inactive pages, held by element identity (T-4.3).
	 *
	 * The active page is never rasterized here, and previews only ever target
	 * the ACTIVE page — yet `withPreviews` rebuilds that page object on every
	 * frame, which rebuilt `pages` and re-ran this effect. Each re-run recomputes
	 * `pageThumbnailKey` for every other page, and that key is a full
	 * `JSON.stringify(page)`: on a 50-page document, 49 whole-page serializations
	 * per preview frame, always to conclude "still cached". Re-running only when
	 * an INACTIVE page actually changes removes that entirely.
	 */
	const inactivePages = useMemo(
		() => pages.filter((page) => page.id !== activePageId),
		[pages, activePageId],
	);

	useEffect(() => {
		// Direct manipulation paints the active page live. Keep cached thumbnails
		// stable until the gesture ends, then this dependency flips and one pass
		// rasterizes the latest committed inactive-page state.
		if (interactionActive) return;
		const interactionFrame = interactionPerformance?.current();
		const invalidationStartedAt = interactionPerformance?.now() ?? 0;
		let cancelled = false;
		const publish = () => {
			if (cancelled) return;
			setUrls(
				new Map(Array.from(cacheRef.current, ([id, entry]) => [id, entry.url])),
			);
		};
		// Drop cache entries for pages that no longer exist. The ACTIVE page is
		// included so switching pages keeps its already-rasterized thumbnail.
		const liveIds = new Set(inactivePages.map((p) => p.id));
		liveIds.add(activePageId);
		let pruned = false;
		for (const id of cacheRef.current.keys()) {
			if (!liveIds.has(id)) {
				cacheRef.current.delete(id);
				pruned = true;
			}
		}
		for (const id of pendingRef.current.keys()) {
			if (!liveIds.has(id)) pendingRef.current.delete(id);
		}
		if (pruned) publish();

		const candidates = inactivePages.flatMap((page) => {
			const key = `${pageThumbnailKey(page)}:${assetFingerprint}`;
			const cached = cacheRef.current.get(page.id);
			return cached?.key === key ? [] : [{ page, key }];
		});

		const rasterizeCandidate = ({
			page,
			key,
		}: (typeof candidates)[number]): Promise<void> => {
			const pending = pendingRef.current.get(page.id);
			if (pending?.key === key) return pending.promise;

			let promise: Promise<void>;
			try {
				promise = rasterize({
					page,
					assets,
					pixelRatio,
					...(resolvedRef.current
						? { resolvedDocument: resolvedRef.current }
						: {}),
				})
					.then((res) => {
						// An older request may finish after a new fingerprint was queued.
						// Only the request still owning this page slot may publish pixels.
						if (pendingRef.current.get(page.id)?.key === key) {
							cacheRef.current.set(page.id, { key, url: res.url });
						}
					})
					.catch(() => {
						// A failed rasterize just leaves the previous (or no) thumbnail.
					})
					.finally(() => {
						// Only clear if nothing newer superseded this key while it ran.
						if (pendingRef.current.get(page.id)?.key === key) {
							pendingRef.current.delete(page.id);
						}
					});
			} catch {
				// Preserve the async rasterizer's failure contract for a synchronous
				// test/host implementation: no thumbnail, and later retries stay open.
				return Promise.resolve();
			}
			pendingRef.current.set(page.id, { key, promise });
			return promise;
		};

		void (async () => {
			for (
				let offset = 0;
				offset < candidates.length;
				offset += thumbnailBatchSize
			) {
				const batch = candidates.slice(offset, offset + thumbnailBatchSize);
				await Promise.all(batch.map(rasterizeCandidate));
				if (cancelled) return;
				// Publish once per bounded batch. This both makes progress visible and
				// avoids one React commit per finished thumbnail on large documents.
				publish();
			}
		})();
		interactionPerformance?.recordDuration(
			interactionFrame,
			"thumbnail-invalidation",
			(interactionPerformance?.now() ?? invalidationStartedAt) -
				invalidationStartedAt,
		);
		return () => {
			cancelled = true;
		};
		// `resolvedDocument` is intentionally absent — see `resolvedRef` above.
	}, [
		inactivePages,
		activePageId,
		assets,
		assetFingerprint,
		rasterize,
		pixelRatio,
		interactionPerformance,
		interactionActive,
		thumbnailBatchSize,
	]);

	return urls;
}
