"use client";

import type {
	BrandTokenRef,
	CanvasExportWarning,
	CanvasGradientFill,
	CanvasIR,
} from "@anvilkit/canvas-core";
import { resolveBrandToken } from "../brand/resolve-brand-token.js";
import type {
	CanvasExportArtifact,
	CanvasExporter,
	CanvasExportFormat,
} from "./types.js";

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
 */
function rasterExporter(
	mimeType: "image/png" | "image/jpeg" | "image/webp",
	ext: string,
): CanvasExporter {
	return ({ ir, stage }, { resolution, quality }) => {
		if (!stage) {
			throw new Error(`${ext.toUpperCase()} export needs a ready Konva stage.`);
		}
		const url = stage.toDataURL({
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

/** Built-in JSON exporter. Serializes the IR; round-trips back into the editor. */
export const jsonExporter: CanvasExporter = ({ ir }) => ({
	filename: exportFilename(ir, "json"),
	data: JSON.stringify(ir, null, 2),
	mimeType: "application/json",
});

/**
 * Built-in SVG exporter (FR-151, AC-010): core's `serializePageToSvg` on the
 * requested page, with brand tokens resolved against the editor's brand kit
 * (same resolution the stage uses). The serializer module is `import()`ed so
 * its weight stays out of the eager editor bundle.
 */
export const svgExporter: CanvasExporter = async ({
	ir,
	activePageId,
	brandKit,
}) => {
	const { serializePageToSvg } = await import("@anvilkit/canvas-core");
	const { svg, warnings } = await serializePageToSvg(ir, activePageId, {
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
		warnings: toExportWarnings(warnings),
	};
};

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
	const { serializeDocumentToPdf } = await import("@anvilkit/canvas-core");
	const { rasterizePage } = await import("../render/rasterize-page.js");
	const rasters = [];
	for (const page of ir.pages) {
		const { url } = await rasterizePage({
			page,
			assets: ir.assets,
			...(brandKit ? { brandKit } : {}),
			pixelRatio: 2 * (request.resolution || 1),
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
		warnings: toExportWarnings(warnings),
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

function toBlob(data: string | Uint8Array | Blob, mimeType: string): Blob {
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
