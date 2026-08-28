import type {
	CanvasExportDiagnostic,
	CanvasExportLimits,
	CanvasExportWarning,
	CanvasIR,
	CanvasPrintPdfMetadata,
} from "@anvilkit/canvas-core";
import type Konva from "konva";
import type { ReactNode } from "react";
import type { BrandKit } from "../brand/brand-kit.js";
import type { CanvasFontCatalog } from "../text/font-catalog.js";

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

/** Built-in export formats (AC-010). Mirrors core's complete export
 * vocabulary (B-04), including the distinct print-preflight PDF path. */
export type CanvasExportFormat =
	| "png"
	| "jpeg"
	| "webp"
	| "svg"
	| "pdf"
	| "pdf-print"
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
	/**
	 * The editor's RESOLVED font catalog (`cp2-007`) —
	 * `DEFAULT_FONT_CATALOG` extended by `<CanvasStudio fontCatalog>`. The
	 * built-in SVG exporter derives its `@font-face` manifest from it, so a
	 * family the picker offered is the same family the export can embed.
	 * Additive and optional (older host exporters ignore it); a host-built
	 * context that omits it gets exactly the pre-`cp2-007` behaviour.
	 *
	 * **Only entries carrying `source.files` can be embedded.** Every default
	 * entry is a stylesheet URL with no files, so the default catalog alone
	 * derives an EMPTY manifest — byte-identical output to passing nothing, with
	 * core's existing `FONT_NOT_IN_MANIFEST` warning per painted family.
	 */
	readonly fontCatalog?: CanvasFontCatalog;
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
	/** Host policy overrides. Omitted fields retain the secure core defaults. */
	readonly limits?: Partial<CanvasExportLimits>;
	/** Print contract for `pdf-print`; ignored by every other format. */
	readonly print?: CanvasPrintPdfMetadata;
	/**
	 * Poll-based cancellation (FR-154): when present and returns `true`, a
	 * built-in multi-page exporter (PDF) stops between page iterations and
	 * throws {@link CanvasExportCancelledError} instead of completing.
	 * Optional — most callers (the headless `export()` action, host-injected
	 * exporters that don't support cancellation) omit it and run to
	 * completion. A single page's own render call is never interrupted
	 * mid-flight — only the boundary BETWEEN pages is checked, mirroring the
	 * dialog's existing per-page raster/SVG loop.
	 */
	readonly isCancelled?: () => boolean;
}

/**
 * Thrown by a multi-page built-in exporter (PDF) when
 * {@link CanvasExportRequest.isCancelled} starts returning `true` between
 * page iterations (FR-154). The export dialog's `runExport` catches this
 * specifically and marks the export `"cancelled"` instead of `"failed"`,
 * discarding the artifact instead of downloading it. A host-injected
 * multi-page exporter honoring `isCancelled` may throw the same class to get
 * identical cancel semantics.
 */
export class CanvasExportCancelledError extends Error {
	readonly code = "CANVAS_EXPORT_CANCELLED" as const;
	readonly diagnostic: CanvasExportDiagnostic;

	constructor(message = "Canvas export was cancelled.") {
		super(message);
		this.name = "CanvasExportCancelledError";
		this.diagnostic = {
			code: this.code,
			category: "cancellation",
			level: "error",
			message,
			correctiveAction: "Start the export again when ready.",
		};
	}
}

/**
 * Thrown when a requested export scope resolves to nothing exportable — an
 * empty selection, or a `"pages"` request whose ids no longer exist on the
 * document. Callers map it to their own "Nothing to export" surface (the
 * dialog's `export-store` fail phase; the headless `export()` action's
 * rejected promise).
 */
export class CanvasExportEmptyError extends Error {
	constructor(message = "Nothing to export") {
		super(message);
		this.name = "CanvasExportEmptyError";
	}
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
	/** Configurable hard ceilings, merged over core's secure defaults. */
	readonly exportLimits?: Partial<CanvasExportLimits>;
	/**
	 * Per-format serializers, merged over all seven built-in exporters. Hosts
	 * may replace any built-in implementation without changing UI vocabulary.
	 */
	readonly exporters?: Partial<Record<CanvasExportFormat, CanvasExporter>>;
	/**
	 * Which formats to show, in order. Defaults to every format that has an
	 * exporter, ordered PNG · JPEG · WebP · SVG · PDF · Print PDF · JSON.
	 */
	readonly formats?: readonly CanvasExportFormat[];
	/** Invoked when an exporter throws, with its stable normalized diagnostic. */
	readonly onError?: (
		error: unknown,
		format: CanvasExportFormat,
		diagnostic: CanvasExportDiagnostic,
	) => void;
}
