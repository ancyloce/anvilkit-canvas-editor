"use client";

import type {
	BrandTokenRef,
	CanvasAssetRef,
	CanvasExportWarning,
	CanvasGradientFill,
	CanvasIR,
} from "@anvilkit/canvas-core";
import { isLocalObjectUri } from "@anvilkit/canvas-core";
import type { LocalAssetStore } from "../assets/local-asset-store.js";
import { resolveBrandToken } from "../brand/resolve-brand-token.js";
import { exportStageContentDataURL } from "../render/export-stage.js";
import { createCanvasLayoutMeasurementProvider } from "../text/canvas-text-measurer.js";
import type {
	CanvasExportArtifact,
	CanvasExporter,
	CanvasExportFormat,
} from "./types.js";
import { CanvasExportCancelledError } from "./types.js";

/**
 * §14.5 export file-name sanitization: strip path separators, characters
 * illegal on common filesystems, control characters, and leading dots, then
 * cap the length. An empty result falls back to `fallback`.
 */
export function sanitizeExportFilename(
	stem: string,
	fallback = "canvas",
): string {
	let cleaned = "";
	for (const ch of stem.replace(/[/\\:*?"<>|]/g, " ")) {
		cleaned += ch.charCodeAt(0) < 0x20 ? " " : ch;
	}
	cleaned = cleaned
		.replace(/\s+/g, " ")
		// Trim leading/trailing dot+space runs — this also strips a `../../`
		// path-traversal prefix once separators became spaces.
		.replace(/^[.\s]+/, "")
		.replace(/[.\s]+$/, "")
		.slice(0, 120)
		.trim();
	return cleaned.length > 0 ? cleaned : fallback;
}

/** `<sanitized title>.<ext>`, falling back to the IR id then a generic stem. */
function exportFilename(ir: CanvasIR, ext: string): string {
	return `${sanitizeExportFilename(ir.title?.trim() || ir.id || "canvas")}.${ext}`;
}

/**
 * Map core serializer warnings (`SvgSerializeWarning`/`PdfSerializeWarning`)
 * into the shared {@link CanvasExportWarning} shape 1:1 — `code` carries the
 * same string value; core's serializer warnings are all degrade-level.
 */
function toExportWarnings(
	warnings: readonly {
		code: string;
		message: string;
		nodeId?: string;
		pageId?: string;
		fallback?: string;
	}[],
): CanvasExportWarning[] {
	return warnings.map((w) => ({
		level: "warn" as const,
		code: w.code,
		message: w.message,
		...(w.nodeId !== undefined ? { nodeId: w.nodeId } : {}),
		...(w.pageId !== undefined ? { pageId: w.pageId } : {}),
		...(w.fallback !== undefined ? { fallback: w.fallback } : {}),
	}));
}

/**
 * Shared raster exporter factory (B-18, AC-010): PNG/JPEG/WebP all read the
 * live Konva stage directly — no extra deps. `resolution` scales the (retina)
 * pixel ratio; `quality` applies to the lossy formats (Konva forwards it to
 * `canvas.toDataURL`) and is a no-op for PNG.
 *
 * Content-only (no transformer handles, guides, or remote-presence chrome),
 * and at the page's real 1:1 scale/position — not whatever pan/zoom the
 * user's viewport happened to be at. `exportStageContentDataURL` itself
 * snapshots/neutralizes/restores the stage's scale and position (E-8, E-14),
 * so every caller — this one included — gets that guarantee for free.
 */
function rasterExporter(
	mimeType: "image/png" | "image/jpeg" | "image/webp",
	ext: string,
): CanvasExporter {
	return ({ ir, stage }, { resolution, quality }) => {
		if (!stage) {
			throw new Error(`${ext.toUpperCase()} export needs a ready Konva stage.`);
		}
		const url = exportStageContentDataURL(stage, {
			pixelRatio: 2 * (resolution || 1),
			mimeType,
			...(mimeType !== "image/png" && quality !== undefined ? { quality } : {}),
		});
		return {
			filename: exportFilename(ir, ext),
			data: url,
			mimeType,
		};
	};
}

/** Built-in PNG exporter. */
export const pngExporter: CanvasExporter = rasterExporter("image/png", "png");

/** Built-in JPEG exporter (AC-010). White-on-transparent flattens to black in
 * JPEG's opaque colorspace — hosts needing a background should export PNG or
 * paint a page background. */
export const jpegExporter: CanvasExporter = rasterExporter("image/jpeg", "jpg");

/** Built-in WebP exporter (AC-010). Chromium-family browsers only — others
 * silently fall back to PNG bytes per the canvas spec. */
export const webpExporter: CanvasExporter = rasterExporter(
	"image/webp",
	"webp",
);

/**
 * Does this document reference bytes only this browser can resolve?
 *
 * The one piece of cp1-006 that stays in the eager chunk. Everything else —
 * the store, the scan, the base64 — sits behind the `import()`s below, so a
 * document with no browser-local assets pays nothing and its JSON export stays
 * synchronous and byte-identical to the pre-cp1-006 output.
 */
function hasLocalAssets(assets: Record<string, CanvasAssetRef>): boolean {
	for (const ref of Object.values(assets)) {
		if (isLocalObjectUri(ref.uri)) return true;
	}
	return false;
}

/**
 * Default ceiling on the browser-local bytes {@link createJsonExporter} will
 * inline as `data:` URIs — **10 MiB of source bytes**, ~14 MB once base64
 * inflates them by 4/3.
 *
 * The number is bounded from three directions and sits in the gap:
 *
 * - It must comfortably cover the ordinary case. PLAN-0035 §5 P1's own example
 *   is a 4 MB photo becoming ~5.5 MB of base64; two of those still inline.
 * - It must stay far below `cp1-001`'s 200 MiB store cap. That cap bounds
 *   *disk*; this one bounds a JSON string materialised in memory and then
 *   copied into a `Blob` for download, so the same figure would be a peak of
 *   half a gigabyte for a file nobody can open.
 * - It must leave the artifact something a host can actually move. A document
 *   JSON is routinely POSTed to an API, and a ~14 MB body already exceeds
 *   several common gateway limits; well past that the format stops being an
 *   interchange format at all.
 *
 * Override it per host via `createCanvasExportPlugin({ exporters: { json:
 * createJsonExporter({ maxInlineAssetBytes }) } })` — the existing exporter
 * override IS the configuration channel; cp1-006 adds no second one.
 */
export const DEFAULT_JSON_INLINE_ASSET_BYTES = 10 * 1024 * 1024;

/** Options for {@link createJsonExporter}. */
export interface CanvasJsonExporterOptions {
	/** Defaults to {@link DEFAULT_JSON_INLINE_ASSET_BYTES}. */
	readonly maxInlineAssetBytes?: number;
	/** Browser-local asset store. Defaults to the shared singleton. Test seam. */
	readonly store?: LocalAssetStore;
}

/**
 * Built-in JSON exporter (cp1-006). Serializes the IR and round-trips back
 * into the editor.
 *
 * Browser-local assets (`blob:`) are inlined as `data:` URIs when their total
 * fits under {@link CanvasJsonExporterOptions.maxInlineAssetBytes}; above it
 * the document is emitted unchanged **plus one warning naming each image that
 * will not travel**. It never silently emits an unresolvable URI, and it never
 * rewrites the live document — the inlined map exists only inside the
 * artifact.
 */
export function createJsonExporter(
	options: CanvasJsonExporterOptions = {},
): CanvasExporter {
	return ({ ir }) => {
		const filename = exportFilename(ir, "json");
		const mimeType = "application/json";
		if (!hasLocalAssets(ir.assets)) {
			return { filename, data: JSON.stringify(ir, null, 2), mimeType };
		}
		return import("../assets/local-asset-export.js")
			.then(({ inlineLocalAssetsForJson }) =>
				inlineLocalAssetsForJson(ir.assets, {
					maxInlineBytes:
						options.maxInlineAssetBytes ?? DEFAULT_JSON_INLINE_ASSET_BYTES,
					...(options.store ? { store: options.store } : {}),
				}),
			)
			.then(({ assets, warnings }) => ({
				filename,
				data: JSON.stringify(
					assets === ir.assets ? ir : { ...ir, assets },
					null,
					2,
				),
				mimeType,
				...(warnings.length > 0 ? { warnings } : {}),
			}));
	};
}

/** Built-in JSON exporter with the default inline cap. */
export const jsonExporter: CanvasExporter = createJsonExporter();

/** Options for {@link createSvgExporter}. */
export interface CanvasSvgExporterOptions {
	/** Browser-local asset store. Defaults to the shared singleton. Test seam. */
	readonly store?: LocalAssetStore;
}

/**
 * Built-in SVG exporter (FR-151, AC-010): core's `serializePageToSvg` on the
 * requested page, with brand tokens resolved against the editor's brand kit
 * (same resolution the stage uses). The serializer module is `import()`ed so
 * its weight stays out of the eager editor bundle.
 *
 * cp1-006: when the document holds browser-local (`blob:`) assets, the
 * serializer is handed the `SvgFetchAsset` it has always accepted, backed by
 * `cp1-001`'s store. Nothing about image emission is duplicated here — core
 * still does the fetch-to-`data:`-URI conversion, and the fetcher exists only
 * to turn an asset id back into bytes.
 *
 * `images` deliberately stays at its `"auto"` default rather than switching to
 * `"embed"`. Embed mode would also fetch-and-inline every *remote* URI, which
 * for existing documents means CORS-dependent network reads, a much larger
 * file, and a `MISSING_ASSET` warning wherever a fetch fails — a regression
 * cp1-006 is not asking for. The fetcher is consulted only for URIs that could
 * not be referenced at all, which is precisely the browser-local set. A caller
 * that *does* request `images: "embed"` gets local assets embedded through the
 * same fetcher.
 */
export function createSvgExporter(
	options: CanvasSvgExporterOptions = {},
): CanvasExporter {
	return async ({ ir, activePageId, brandKit }) => {
		const [
			{ layoutIssuesToExportWarnings, resolveCanvasLayout, serializePageToSvg },
			fetchAsset,
		] = await Promise.all([
			import("@anvilkit/canvas-core"),
			hasLocalAssets(ir.assets)
				? import("../assets/local-asset-export.js").then(
						({ createLocalAssetSvgFetcher }) =>
							createLocalAssetSvgFetcher(
								ir.assets,
								...(options.store ? ([options.store] as const) : []),
							),
					)
				: undefined,
		]);
		// T-M3-10: one resolution of the COMMITTED document per export operation —
		// the serializer never resolves itself (TD §12.4), and resolving here
		// (rather than reusing the live store) keeps previews out of exports.
		const measurement = createCanvasLayoutMeasurementProvider();
		const resolved = resolveCanvasLayout(ir, { measurement });
		const { svg, warnings } = await serializePageToSvg(ir, activePageId, {
			resolvedDocument: resolved,
			// T-M5-01: the SAME measurer the resolver used also wraps rich text in
			// the serializer — without it wrapped text exports one line per
			// paragraph (RICH_TEXT_WRAP_APPROXIMATE) and SVG↔renderer parity
			// breaks on any wrapping fixture.
			textMeasurer: measurement.measureText,
			...(fetchAsset ? { fetchAsset } : {}),
			...(brandKit
				? {
						resolveBrandToken: (
							ref: BrandTokenRef,
						): string | CanvasGradientFill | undefined =>
							resolveBrandToken(ref, brandKit),
					}
				: {}),
		});
		return {
			filename: exportFilename(ir, "svg"),
			data: svg,
			mimeType: "image/svg+xml",
			// T-M3-03 (AL-INTEGRATE-003): layout diagnostics ride into the export
			// result through the ONE shared map, alongside the serializer's own.
			warnings: [
				...toExportWarnings(warnings),
				...layoutIssuesToExportWarnings(resolved.diagnostics, {
					pageId: activePageId,
				}),
			],
		};
	};
}

/** Built-in SVG exporter reading the shared browser-local asset store. */
export const svgExporter: CanvasExporter = createSvgExporter();

/**
 * Built-in PDF exporter (FR-151/FR-152, AC-010): every page of the given IR
 * is rasterized off-screen (the live stage only holds the active page), then
 * core's raster-embed `serializeDocumentToPdf` packs one PDF page per canvas
 * page — this is what makes multi-page PDF export work (Flow 2). pdf-lib
 * loads via `import()` on first use, never in the eager bundle.
 */
export const pdfExporter: CanvasExporter = async (
	{ ir, brandKit },
	request,
) => {
	const [
		{
			layoutIssuesToExportWarnings,
			resolveCanvasLayout,
			serializeDocumentToPdf,
		},
		{ rasterizePage },
	] = await Promise.all([
		import("@anvilkit/canvas-core"),
		import("../render/rasterize-page.js"),
	]);
	// T-M3-10: ONE resolution of the committed document, shared by every
	// page's offscreen raster — raster and PDF derive from one resolved stage.
	const resolved = resolveCanvasLayout(ir, {
		measurement: createCanvasLayoutMeasurementProvider(),
	});
	const rasters = [];
	for (const page of ir.pages) {
		// Bug 4 (FR-154): check BETWEEN page iterations, mirroring the check the
		// dialog's per-page raster/SVG loop already does — a single page's own
		// rasterization is never interrupted mid-flight.
		if (request.isCancelled?.()) throw new CanvasExportCancelledError();
		const { url } = await rasterizePage({
			page,
			assets: ir.assets,
			...(brandKit ? { brandKit } : {}),
			pixelRatio: 2 * (request.resolution || 1),
			resolvedDocument: resolved,
		});
		rasters.push({ pageId: page.id, image: url });
	}
	const { pdf, warnings } = await serializeDocumentToPdf(ir, {
		rasters,
		pages: ir.pages.map((p) => p.id),
		...(ir.title !== undefined ? { title: ir.title } : {}),
	});
	return {
		filename: exportFilename(ir, "pdf"),
		data: pdf,
		mimeType: "application/pdf",
		// T-M3-03: layout diagnostics surface in the PDF result too.
		warnings: [
			...toExportWarnings(warnings),
			...layoutIssuesToExportWarnings(resolved.diagnostics),
		],
	};
};

/** Formats the editor can export with zero host wiring (AC-010: all six). */
export const DEFAULT_CANVAS_EXPORTERS: Partial<
	Record<CanvasExportFormat, CanvasExporter>
> = {
	png: pngExporter,
	jpeg: jpegExporter,
	webp: webpExporter,
	svg: svgExporter,
	pdf: pdfExporter,
	json: jsonExporter,
};

function dataUrlToBlob(dataUrl: string): Blob {
	const [meta, base64 = ""] = dataUrl.split(",");
	const mime = /:(.*?);/.exec(meta ?? "")?.[1] ?? "application/octet-stream";
	const binary = atob(base64);
	const bytes = new Uint8Array(binary.length);
	for (let i = 0; i < binary.length; i += 1) {
		bytes[i] = binary.charCodeAt(i);
	}
	return new Blob([bytes], { type: mime });
}

/** Converts an artifact's `data` (data URL, raw string, or bytes) into a real
 * `Blob` — used by {@link downloadCanvasArtifact} and reused verbatim by the
 * headless `export()` action (`header/export-action.ts`) so the two never
 * drift on how `CanvasExportArtifact.data` becomes downloadable bytes. */
export function toBlob(
	data: string | Uint8Array | Blob,
	mimeType: string,
): Blob {
	if (data instanceof Blob) return data;
	if (typeof data === "string") {
		return data.startsWith("data:")
			? dataUrlToBlob(data)
			: new Blob([data], { type: mimeType });
	}
	// `Uint8Array<ArrayBufferLike>` widens to a possibly-shared buffer; the DOM
	// `BlobPart` only accepts `ArrayBuffer`-backed views, so assert at the seam.
	return new Blob([data as BlobPart], { type: mimeType });
}

/** Trigger a browser download for an export artifact (client-only). */
export function downloadCanvasArtifact(artifact: CanvasExportArtifact): void {
	const blob = toBlob(artifact.data, artifact.mimeType);
	const url = URL.createObjectURL(blob);
	const anchor = document.createElement("a");
	anchor.href = url;
	anchor.download = sanitizeExportFilename(artifact.filename, "export");
	document.body.appendChild(anchor);
	anchor.click();
	anchor.remove();
	URL.revokeObjectURL(url);
}
