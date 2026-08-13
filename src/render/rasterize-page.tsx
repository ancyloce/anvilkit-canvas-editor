"use client";

import {
	type CanvasAssetRef,
	type CanvasNode,
	type CanvasPage,
	type CanvasResolvedDocument,
	isContainerNode,
} from "@anvilkit/canvas-core";
import type Konva from "konva";
import * as React from "react";
import { flushSync } from "react-dom";
import { createRoot, type Root } from "react-dom/client";
import { Rect } from "react-konva";
import type { BrandKit } from "../brand/brand-kit.js";
import { EMPTY_BRAND_KIT } from "../brand/brand-kit.js";
import { CanvasAssetsContext } from "../stage/CanvasAssetsContext.js";
import { CanvasBrandKitContext } from "../stage/CanvasBrandKitContext.js";
import { CanvasDecodedImagesContext } from "../stage/CanvasDecodedImagesContext.js";
import { CanvasNodeRenderer } from "../stage/CanvasNodeRenderer.js";
import { CanvasResolvedDocumentContext } from "../stage/CanvasResolvedDocumentContext.js";
import { CanvasStage } from "../stage/CanvasStage.js";
import { RenderLayer } from "../stage/RenderLayer.js";
import { pageBackgroundFill } from "./page-background.js";

export interface RasterizePageInput {
	readonly page: CanvasPage;
	/**
	 * Asset map keyed by `assetId`. Image nodes look up their asset here.
	 * Defaults to an empty map; image nodes without an asset entry render
	 * nothing (matches the editor's behavior).
	 */
	readonly assets?: Record<string, CanvasAssetRef>;
	/**
	 * Brand kit to resolve `BrandTokenRef` fills/fonts against (canvas-m1-013)
	 * — the SAME resolution `<CanvasNodeRenderer>` performs on the live stage,
	 * via `CanvasBrandKitContext`. Defaults to an empty kit (every token
	 * degrades to its neutral fallback, never throws).
	 */
	readonly brandKit?: BrandKit;
	/**
	 * Defaults to 2 (retina-quality preview). Pass an `{x, y}` pair for
	 * independent horizontal/vertical scale — FR-153's custom width × height
	 * export, where an unlocked aspect ratio stretches non-proportionally.
	 * Implemented via Konva's own `stage.scaleX`/`scaleY` (no custom pixel
	 * resampling): the off-screen stage this function builds is torn down
	 * immediately after, so mutating its scale here is safe.
	 */
	readonly pixelRatio?: number | { readonly x: number; readonly y: number };
	/** Defaults to `"image/png"`. */
	readonly mimeType?: "image/png" | "image/jpeg" | "image/webp";
	/** Only honored for image/jpeg + image/webp. Defaults to 0.92. */
	readonly quality?: number;
	/**
	 * Paint the page background (default `true`). `false` renders content only
	 * — the FR-150 "transparent background" / "include background" export
	 * options. JPEG has no alpha channel, so a background-less JPEG flattens
	 * to black; the export dialog disables the option there.
	 */
	readonly includeBackground?: boolean;
	/**
	 * T-M3-10: a resolution of the document this page belongs to. When present
	 * the offscreen render draws RESOLVED geometry (via
	 * `CanvasResolvedDocumentContext`) — the same tree the live stage shows —
	 * without mounting a studio context, so the pass stays non-interactive and
	 * preview-free. Omit for documents without layout intent.
	 */
	readonly resolvedDocument?: CanvasResolvedDocument;
}

export interface RasterizePageResult {
	readonly url: string;
	readonly mimeType: string;
}

/**
 * Render a single `CanvasIR` page into a detached `Konva.Stage` and
 * return a data URL of its contents. The stage is built off-screen
 * (the container element is appended to the body but positioned far
 * outside the viewport) and torn down before the function resolves,
 * so callers do not need to manage lifecycle.
 *
 * The render path reuses `<CanvasStage>` + `<CanvasNodeRenderer>` so
 * non-active artboard previews match the live editor's output for
 * every node kind already wired into the renderer. Image nodes are
 * pre-decoded against `input.assets` so the async `useImage` path
 * settles before `stage.toDataURL` is called.
 */
export async function rasterizePage(
	input: RasterizePageInput,
): Promise<RasterizePageResult> {
	const { page } = input;
	const pixelRatioInput = input.pixelRatio ?? 2;
	const pixelRatioX =
		typeof pixelRatioInput === "number" ? pixelRatioInput : pixelRatioInput.x;
	const pixelRatioY =
		typeof pixelRatioInput === "number" ? pixelRatioInput : pixelRatioInput.y;
	const mimeType = input.mimeType ?? "image/png";
	const quality = input.quality ?? 0.92;
	const assets = input.assets ?? {};
	const brandKit = input.brandKit ?? EMPTY_BRAND_KIT;
	const includeBackground = input.includeBackground ?? true;

	// Plan 0023 M6-02: preload from the EXPANDED page when the caller supplied a
	// component resolution. A component's images live in the DEFINITION tree, not
	// the page, so walking the raw page would miss them entirely and every image
	// inside a component would race `use-image` and rasterize blank.
	const decodedImages = await preloadImageAssets(
		input.resolvedDocument?.source.pages.find((p) => p.id === page.id) ?? page,
		assets,
	);

	const container = document.createElement("div");
	container.setAttribute("data-rasterize-page", page.id);
	container.style.position = "absolute";
	container.style.left = "-99999px";
	container.style.top = "-99999px";
	container.style.pointerEvents = "none";
	document.body.appendChild(container);

	let stage: Konva.Stage | null = null;
	let root: Root | null = null;
	try {
		root = createRoot(container);
		flushSync(() => {
			root?.render(
				<CanvasResolvedDocumentContext.Provider
					value={input.resolvedDocument ?? null}
				>
					{/* K-17: hand the renderer the elements we already decoded, so
					    every image is `loaded` on the FIRST render. Without this the
					    renderer started a second load through `use-image` and this
					    function had nothing to wait on — it guessed with two animation
					    frames, and an image that missed the window exported blank. */}
					<CanvasDecodedImagesContext.Provider value={decodedImages}>
					<CanvasAssetsContext.Provider value={assets}>
						<CanvasBrandKitContext.Provider value={brandKit}>
							<CanvasStage
								width={page.size.width}
								height={page.size.height}
								onReady={(s) => {
									stage = s;
								}}
							>
								{includeBackground ? (
									<RenderLayer name="background" listening={false}>
										<Rect
											x={0}
											y={0}
											width={page.size.width}
											height={page.size.height}
											fill={pageBackgroundFill(page.background)}
										/>
									</RenderLayer>
								) : null}
								<RenderLayer name="objects" listening={false}>
									<CanvasNodeRenderer node={page.root} />
								</RenderLayer>
							</CanvasStage>
						</CanvasBrandKitContext.Provider>
					</CanvasAssetsContext.Provider>
					</CanvasDecodedImagesContext.Provider>
				</CanvasResolvedDocumentContext.Provider>,
			);
		});

		// K-17: fonts have to be RESOLVED before we serialize. Konva measures and
		// draws text with whatever family is resolved at draw time, so an export
		// issued while a web font is still loading renders in the fallback face —
		// with different metrics than the layout engine assumed, which shows up
		// as wrapping that disagrees with the editor.
		//
		// Ordering matters and is the reason this sits AFTER the render: the
		// render is what makes the loads pending (`CanvasTextNodeRenderer` calls
		// `useFontStatus`, which kicks off `document.fonts.load` per family), and
		// `document.fonts.ready` only waits on loads already in flight. The frame
		// yields below then let React flush the re-render each arriving font
		// triggers, so the serialize sees re-measured text.
		await waitForFonts();

		// `useImage` performs async setState after Image.onload. Yield two
		// frames so those states flush before we serialize. The first frame also
		// lets `<CanvasStage>`'s passive onReady effect populate `stage` (it does
		// not run during the synchronous flushSync above), so the guard below
		// must stay after these awaits.
		await waitFrame();
		await waitFrame();

		if (!stage) {
			throw new Error("rasterizePage: stage was not initialized");
		}
		const readyStage = stage as Konva.Stage;
		let url: string;
		// The capture rect is EXPLICIT. `toDataURL` with no rect resolves its
		// origin and size from `getClientRect()`, which for a Stage is the union
		// of every visible child's rect — stroke- and shadow-inflated, and taken
		// before any `clipFunc` is applied (`konva/lib/Container.js`). So a node
		// overhanging the page, a drop shadow, or an oversized photo inside a
		// clipping frame all silently resize and re-origin the output.
		//
		// This path has a second failure the live stage does not: with
		// `includeBackground: false` (FR-150 transparent background) no page-sized
		// <Rect> is mounted at all, so nothing anchored the union at (0,0) and the
		// export cropped to whatever the content happened to span.
		const { width: pageWidth, height: pageHeight } = page.size;
		if (pixelRatioX === pixelRatioY) {
			url = readyStage.toDataURL({
				x: 0,
				y: 0,
				width: pageWidth,
				height: pageHeight,
				pixelRatio: pixelRatioX,
				mimeType,
				quality,
			});
		} else {
			// FR-153 non-proportional custom size (Bug 1): stretch via Konva's own
			// independent-axis stage scale rather than a uniform `pixelRatio` — the
			// stage is short-lived/off-screen (torn down in `finally` below), so
			// mutating its scale here has no side effects outside this call.
			//
			// The rect is in POST-scale units: `_toKonvaCanvas` sizes its canvas
			// from `config.width` and then draws the scene THROUGH the stage
			// transform, so the requested output is `page × per-axis ratio`.
			readyStage.scaleX(pixelRatioX);
			readyStage.scaleY(pixelRatioY);
			url = readyStage.toDataURL({
				x: 0,
				y: 0,
				width: pageWidth * pixelRatioX,
				height: pageHeight * pixelRatioY,
				pixelRatio: 1,
				mimeType,
				quality,
			});
		}
		return { url, mimeType };
	} finally {
		root?.unmount();
		if (container.parentNode) {
			container.parentNode.removeChild(container);
		}
	}
}

/**
 * Best-effort wait for in-flight web fonts, bounded so a font that never
 * arrives cannot hang an export. Absent in jsdom/SSR (no CSS Font Loading
 * API), where it resolves immediately — the same "never crash" contract
 * `text/font-status.ts` holds for FR-083.
 */
const FONT_READY_TIMEOUT_MS = 2000;

async function waitForFonts(): Promise<void> {
	const fonts = (document as { fonts?: FontFaceSet }).fonts;
	if (!fonts || typeof fonts.ready?.then !== "function") return;
	try {
		await Promise.race([fonts.ready, timeout(FONT_READY_TIMEOUT_MS)]);
	} catch {
		// A rejected font load must not fail the export; the fallback face is
		// still a legitimate render.
	}
}

function waitFrame(): Promise<void> {
	return new Promise((resolve) => {
		if (typeof requestAnimationFrame === "function") {
			requestAnimationFrame(() => resolve());
			return;
		}
		setTimeout(resolve, 0);
	});
}

const ASSET_PRELOAD_TIMEOUT_MS = 2000;

/**
 * Decode every image the page references, and KEEP the elements (K-17).
 *
 * These used to be loaded and thrown away — the renderer then built its own
 * through `use-image`, so the decode happened twice and, more importantly,
 * this function had no way to know when the renderer's copy was ready. Handing
 * the elements down through `CanvasDecodedImagesContext` is what removes the
 * guesswork. Keyed by URI because that is what the renderer resolves an asset
 * to.
 *
 * Still best-effort: a failed or slow asset is simply absent from the map and
 * the renderer falls back to `use-image`, exactly as before.
 */
async function preloadImageAssets(
	page: CanvasPage,
	assets: Record<string, CanvasAssetRef>,
): Promise<ReadonlyMap<string, HTMLImageElement>> {
	const decoded = new Map<string, HTMLImageElement>();
	const ids = collectImageAssetIds(page.root);
	if (ids.length === 0) return decoded;
	await Promise.all(
		ids.map(async (id) => {
			const ref = assets[id];
			if (!ref?.uri) return;
			const uri = ref.uri;
			try {
				const image = await Promise.race([
					loadImage(uri),
					timeout(ASSET_PRELOAD_TIMEOUT_MS),
				]);
				// `timeout` resolves with nothing; only a real load contributes.
				if (image) decoded.set(uri, image);
			} catch {
				// Best-effort preload; render path will fall back to use-image.
			}
		}),
	);
	return decoded;
}

function loadImage(uri: string): Promise<HTMLImageElement> {
	return new Promise((resolve, reject) => {
		const img = new Image();
		// CORS mode must match the renderer's fallback path (E-1) — a
		// differently-credentialed element would taint the canvas and make
		// `toDataURL` throw `SecurityError`.
		img.crossOrigin = "anonymous";
		img.onload = () => resolve(img);
		img.onerror = () => reject(new Error(`load failed: ${uri}`));
		img.src = uri;
	});
}

function timeout(ms: number): Promise<undefined> {
	return new Promise((resolve) => {
		setTimeout(() => resolve(undefined), ms);
	});
}

function collectImageAssetIds(node: CanvasNode): string[] {
	if (node.type === "image" || node.type === "svg") return [node.assetId];
	// A video's poster is an asset-id reference resolved the same way as an
	// image/svg's — omitting it here left it unpreloaded, so it was flakily
	// still "loading" (and rendered as nothing) by the time the raster/PDF
	// capture ran (E-12).
	if (node.type === "video") return node.poster ? [node.poster] : [];
	if (isContainerNode(node)) {
		return node.children.flatMap(collectImageAssetIds);
	}
	return [];
}
