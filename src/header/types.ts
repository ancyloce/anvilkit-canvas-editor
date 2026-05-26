import type { CanvasIR } from "@anvilkit/canvas-core";
import type Konva from "konva";
import type { ReactNode } from "react";

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

/** Built-in export formats. PNG/JSON ship with the editor; SVG/PDF are host-injected. */
export type CanvasExportFormat = "png" | "svg" | "pdf" | "json";

/** The live editor state an exporter reads from (sourced from the studio context). */
export interface CanvasExportContext {
	/** Current IR snapshot (`useCanvasStudio().getIR()`). */
	readonly ir: CanvasIR;
	/** Active artboard id — exporters that emit a single page use this. */
	readonly activePageId: string;
	/** The live Konva stage; `null` until the canvas mounts. Raster formats need it. */
	readonly stage: Konva.Stage | null;
}

/** The user-tunable knobs from the export popover (mirrors the reference panel). */
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
