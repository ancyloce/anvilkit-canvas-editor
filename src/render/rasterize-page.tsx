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
import { CanvasAssetsContext } from "../stage/CanvasAssetsContext.js";
import { CanvasNodeRenderer } from "../stage/CanvasNodeRenderer.js";
import { CanvasStage } from "../stage/CanvasStage.js";
import { RenderLayer } from "../stage/RenderLayer.js";

export interface RasterizePageInput {
	readonly page: CanvasPage;
	/**
	 * Asset map keyed by `assetId`. Image nodes look up their asset here.
	 * Defaults to an empty map; image nodes without an asset entry render
	 * nothing (matches the editor's behavior).
	 */
	readonly assets?: Record<string, CanvasAssetRef>;
	/** Defaults to 2 (retina-quality preview). */
	readonly pixelRatio?: number;
	/** Defaults to `"image/png"`. */
	readonly mimeType?: "image/png" | "image/jpeg" | "image/webp";
	/** Only honored for image/jpeg + image/webp. Defaults to 0.92. */
	readonly quality?: number;
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
	const pixelRatio = input.pixelRatio ?? 2;
	const mimeType = input.mimeType ?? "image/png";
	const quality = input.quality ?? 0.92;
	const assets = input.assets ?? {};

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
					<CanvasStage
						width={page.size.width}
						height={page.size.height}
						onReady={(s) => {
							stage = s;
						}}
					>
						<RenderLayer name="background" listening={false}>
							<Rect
								x={0}
								y={0}
								width={page.size.width}
								height={page.size.height}
								fill={page.background.value}
							/>
						</RenderLayer>
						<RenderLayer name="objects" listening={false}>
							<CanvasNodeRenderer node={page.root} />
						</RenderLayer>
					</CanvasStage>
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
		const url = (stage as Konva.Stage).toDataURL({
			pixelRatio,
			mimeType,
			quality,
		});
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
	if (node.type === "image") return [node.assetId];
	if (isContainerNode(node)) {
		return node.children.flatMap(collectImageAssetIds);
	}
	return [];
}
