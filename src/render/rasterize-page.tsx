"use client";

import {
	type CanvasAssetRef,
	type CanvasNode,
	type CanvasPage,
	isContainerNode,
} from "@anvilkit/canvas-core";
import type Konva from "konva";
import { flushSync } from "react-dom";
import { createRoot, type Root } from "react-dom/client";
import { Rect } from "react-konva";
import type { BrandKit } from "../brand/brand-kit.js";
import { EMPTY_BRAND_KIT } from "../brand/brand-kit.js";
import { CanvasAssetsContext } from "../stage/CanvasAssetsContext.js";
import { CanvasBrandKitContext } from "../stage/CanvasBrandKitContext.js";
import { CanvasNodeRenderer } from "../stage/CanvasNodeRenderer.js";
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

	await preloadImageAssets(page, assets);

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
				</CanvasAssetsContext.Provider>,
			);
		});

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
		if (pixelRatioX === pixelRatioY) {
			url = readyStage.toDataURL({
				pixelRatio: pixelRatioX,
				mimeType,
				quality,
			});
		} else {
			// FR-153 non-proportional custom size (Bug 1): stretch via Konva's own
			// independent-axis stage scale rather than a uniform `pixelRatio` — the
			// stage is short-lived/off-screen (torn down in `finally` below), so
			// mutating its scale here has no side effects outside this call.
			readyStage.scaleX(pixelRatioX);
			readyStage.scaleY(pixelRatioY);
			url = readyStage.toDataURL({ pixelRatio: 1, mimeType, quality });
		}
		return { url, mimeType };
	} finally {
		root?.unmount();
		if (container.parentNode) {
			container.parentNode.removeChild(container);
		}
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

async function preloadImageAssets(
	page: CanvasPage,
	assets: Record<string, CanvasAssetRef>,
): Promise<void> {
	const ids = collectImageAssetIds(page.root);
	if (ids.length === 0) return;
	await Promise.all(
		ids.map(async (id) => {
			const ref = assets[id];
			if (!ref?.uri) return;
			try {
				await Promise.race([
					loadImage(ref.uri),
					timeout(ASSET_PRELOAD_TIMEOUT_MS),
				]);
			} catch {
				// Best-effort preload; render path will fall back to use-image.
			}
		}),
	);
}

function loadImage(uri: string): Promise<void> {
	return new Promise((resolve, reject) => {
		const img = new Image();
		img.crossOrigin = "anonymous";
		img.onload = () => resolve();
		img.onerror = () => reject(new Error(`load failed: ${uri}`));
		img.src = uri;
	});
}

function timeout(ms: number): Promise<void> {
	return new Promise((resolve) => {
		setTimeout(resolve, ms);
	});
}

function collectImageAssetIds(node: CanvasNode): string[] {
	if (node.type === "image" || node.type === "svg") return [node.assetId];
	if (isContainerNode(node)) {
		return node.children.flatMap(collectImageAssetIds);
	}
	return [];
}
