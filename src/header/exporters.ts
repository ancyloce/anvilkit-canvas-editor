"use client";

import type { CanvasIR } from "@anvilkit/canvas-core";
import type {
	CanvasExportArtifact,
	CanvasExporter,
	CanvasExportFormat,
} from "./types.js";

/** `<title>.<ext>`, falling back to the IR id then a generic stem. */
function exportFilename(ir: CanvasIR, ext: string): string {
	const stem = ir.title?.trim() || ir.id || "canvas";
	return `${stem}.${ext}`;
}

/**
 * Built-in PNG exporter. Reads the live Konva stage directly — no extra deps.
 * `resolution` scales the (retina) pixel ratio; `quality` is a no-op for PNG.
 */
export const pngExporter: CanvasExporter = ({ ir, stage }, { resolution }) => {
	if (!stage) {
		throw new Error("PNG export needs a ready Konva stage.");
	}
	const url = stage.toDataURL({
		pixelRatio: 2 * (resolution || 1),
		mimeType: "image/png",
	});
	return {
		filename: exportFilename(ir, "png"),
		data: url,
		mimeType: "image/png",
	};
};

/** Built-in JSON exporter. Serializes the IR; round-trips back into the editor. */
export const jsonExporter: CanvasExporter = ({ ir }) => ({
	filename: exportFilename(ir, "json"),
	data: JSON.stringify(ir, null, 2),
	mimeType: "application/json",
});

/** Formats the editor can export with zero host wiring. */
export const DEFAULT_CANVAS_EXPORTERS: Partial<
	Record<CanvasExportFormat, CanvasExporter>
> = {
	png: pngExporter,
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
	anchor.download = artifact.filename;
	document.body.appendChild(anchor);
	anchor.click();
	anchor.remove();
	URL.revokeObjectURL(url);
}
