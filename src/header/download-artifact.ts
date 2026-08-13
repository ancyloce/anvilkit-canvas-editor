import type { CanvasExportArtifact } from "./types.js";

/**
 * @file Turning a {@link CanvasExportArtifact} into a file the browser saves.
 *
 * A leaf on purpose. This logic lived in `header/exporters.ts`, which statically
 * imports the stage rasterizer, the layout measurer and the brand-token
 * resolver — fine for the export dialog, which is reached lazily, but a static
 * import of that module from `CanvasStudio.tsx` would drag all three into the
 * EAGER editor chunk and straight through the bundle budget. `exporters.ts`
 * re-exports every name below, so no existing importer moved.
 *
 * The point of it being one module is that there is exactly ONE download path.
 * `CanvasStudio`'s FR-172 recovery export used to hand-roll its own anchor, and
 * skipped the filename sanitization, the data-URL decoding, and the
 * appendChild-before-click in the process.
 */

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

/**
 * Converts an artifact's `data` (data URL, raw string, or bytes) into a real
 * `Blob` — used by {@link downloadCanvasArtifact} and reused verbatim by the
 * headless `export()` action (`header/export-action.ts`) so the two never drift
 * on how `CanvasExportArtifact.data` becomes downloadable bytes.
 */
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
