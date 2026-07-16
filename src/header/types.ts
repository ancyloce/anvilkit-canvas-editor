import type { CanvasExportWarning, CanvasIR } from "@anvilkit/canvas-core";
import type Konva from "konva";
import type { ReactNode } from "react";
import type { BrandKit } from "../brand/brand-kit.js";

/**
 * A pluggable action mounted in the {@link WorkspaceHeader}'s right cluster
 * (between the collaborator avatars and the host `shareSlot`). `render` runs
 * *inside* the `<CanvasStudio>` provider, so the returned node may call
 * {@link useCanvasStudio}. `id` keys the node and dedupes registrations.
 */
export interface CanvasHeaderPlugin {
	readonly id: string;
	readonly render: () => ReactNode;
}

/** Built-in export formats (AC-010). PNG/JPEG/WebP/JSON ship with the
 * editor; SVG/PDF are host-injected. Mirrors core's export vocabulary
 * (B-04) for the formats the editor UI can drive. */
export type CanvasExportFormat =
	| "png"
	| "jpeg"
	| "webp"
	| "svg"
	| "pdf"
	| "json";

/** The live editor state an exporter reads from (sourced from the studio context). */
export interface CanvasExportContext {
	/** Current IR snapshot (`useCanvasStudio().getIR()`). */
	readonly ir: CanvasIR;
	/** Active artboard id — exporters that emit a single page use this. */
	readonly activePageId: string;
	/** The live Konva stage; `null` until the canvas mounts. Raster formats need it. */
	readonly stage: Konva.Stage | null;
	/**
	 * The editor's brand kit, when the host wired one. The built-in SVG/PDF
	 * exporters resolve `BrandTokenRef` fills/fonts against it so exports
	 * agree with the live canvas; additive and optional (older host exporters
	 * ignore it).
	 */
	readonly brandKit?: BrandKit;
}

/**
 * The user-tunable knobs from the export popover (mirrors the reference panel).
 *
 * Naming: `@anvilkit/canvas-core`'s headless export job contract (FR-040,
 * canvas-m3-001) deliberately named its own request/response/artifact types
 * `CanvasExportJobRequest`/`CanvasExportJobResponse`/`CanvasExportJobArtifact`
 * rather than reusing these bare names — this type and
 * {@link CanvasExportArtifact} are unrelated, editor-UI-local concepts (popover
 * knobs / a downloadable-blob shape) and stay as they are.
 */
export interface CanvasExportRequest {
	/** 0–100. Honored by lossy raster encoders; ignored by PNG/vector/data. */
	readonly quality: number;
	/** Output scale factor (e.g. `1`, `0.5`). Raster exporters multiply pixelRatio by it. */
	readonly resolution: number;
	/** Strip EXIF/location/camera metadata from raster output. */
	readonly stripMetadata: boolean;
}

/** A downloadable artifact. `data` accepts a data URL, raw string, bytes, or a Blob. */
export interface CanvasExportArtifact {
	readonly filename: string;
	readonly data: string | Uint8Array | Blob;
	readonly mimeType: string;
	/**
	 * Structured fidelity warnings from serialization (FR-041, canvas-m3-002) —
	 * e.g. an unresolved brand token or an unsupported mask. Reuses
	 * `@anvilkit/canvas-core`'s `CanvasExportWarning` shape verbatim so a host
	 * wiring `canvasToSvg`/`canvasToPdf` (`@anvilkit/plugin-export-canvas`) can
	 * pass its `warnings` straight through without remapping (UX-007: "user
	 * can see export warnings before download"). Omitted or empty means no
	 * fidelity loss was detected.
	 */
	readonly warnings?: readonly CanvasExportWarning[];
}

/**
 * Turns the live editor state + the requested options into a downloadable
 * artifact. May be async (SVG/PDF serialization is). Throwing surfaces through
 * {@link CanvasExportPluginOptions.onError}.
 */
export type CanvasExporter = (
	ctx: CanvasExportContext,
	request: CanvasExportRequest,
) => CanvasExportArtifact | Promise<CanvasExportArtifact>;

/** Options for {@link createCanvasExportPlugin} / `<ExportMenu>`. */
export interface CanvasExportPluginOptions {
	/**
	 * Per-format serializers, merged over the built-in PNG/JSON exporters. The
	 * editor is Puck-independent and budget-capped, so it ships no SVG/PDF
	 * serializer — hosts inject those (e.g. from `@anvilkit/plugin-export-canvas`).
	 */
	readonly exporters?: Partial<Record<CanvasExportFormat, CanvasExporter>>;
	/**
	 * Which formats to show, in order. Defaults to every format that has an
	 * exporter, ordered PNG · SVG · PDF · JSON.
	 */
	readonly formats?: readonly CanvasExportFormat[];
	/** Invoked when an exporter throws. Defaults to `console.error`. */
	readonly onError?: (error: unknown, format: CanvasExportFormat) => void;
}
