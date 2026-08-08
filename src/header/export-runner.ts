"use client";

import type {
	CanvasIR,
	CanvasPage,
	CanvasResolvedDocument,
} from "@anvilkit/canvas-core";
import { resolveCanvasDocument } from "@anvilkit/canvas-core";
import type Konva from "konva";
import type { BrandKit } from "../brand/brand-kit.js";
import { rasterizePage } from "../render/rasterize-page.js";
import { buildSelectionExportPage } from "../render/selection-export.js";
import { createCanvasLayoutMeasurementProvider } from "../text/canvas-text-measurer.js";
import type { CanvasFontCatalog } from "../text/font-catalog.js";
import type {
	CanvasExportArtifact,
	CanvasExporter,
	CanvasExportFormat,
	CanvasExportRequest,
} from "./types.js";
import { CanvasExportEmptyError } from "./types.js";

/**
 * Shared export-rendering logic (§11.2, FR-152, Bug 2/3 fixes): scope
 * resolution + per-page/whole-document artifact rendering, used by BOTH the
 * export dialog's `runExport` (`ExportDialog.tsx`) and the headless
 * `CanvasStudioActions.export()` action (`export-action.ts`) so scope
 * semantics and artifact rendering never drift between the two entry
 * points. Intentionally NOT re-exported from the package's public root —
 * an internal implementation detail of `header/`.
 */

/** Raster formats rendered per page via the offscreen rasterizer (B-18). */
export const RASTER_FORMATS = new Set<CanvasExportFormat>([
	"png",
	"jpeg",
	"webp",
]);
/** Whole-document formats: one artifact for the whole (scoped) IR. */
export const WHOLE_DOC_FORMATS = new Set<CanvasExportFormat>(["pdf", "json"]);
/** Format → MIME type for the built-in raster pipeline. */
const RASTER_MIME: Record<string, "image/png" | "image/jpeg" | "image/webp"> = {
	png: "image/png",
	jpeg: "image/jpeg",
	webp: "image/webp",
};

/** Page scope understood by the shared runner — mirrors
 * `CanvasExportUiRequest["scope"]` (`stores/export-request-store.ts`). */
export type CanvasExportScope = "current" | "all" | "pages" | "selection";

export interface ResolveExportScopeInput {
	readonly ir: CanvasIR;
	readonly activePageId: string;
	readonly scope: CanvasExportScope;
	/** Page ids for `scope: "pages"` (FR-152 selected pages). */
	readonly pageIds?: readonly string[];
	/** Node ids for `scope: "selection"` (FR-031 export selection). */
	readonly selectedIds?: readonly string[];
	/**
	 * T-M3-07: the live resolution, so a selection export frames Auto Layout
	 * nodes at their resolved geometry. Optional — callers without one fall
	 * back to stored geometry.
	 */
	readonly resolvedDocument?: CanvasResolvedDocument;
}

export interface ResolvedExportSelection {
	/** The synthetic single-page IR framed to the selection (FR-031). */
	readonly page: CanvasPage;
	/** `ir` scoped to ONLY `page` — the Bug 2 fix: non-raster selection export
	 * must never see the full, unscoped document. */
	readonly ir: CanvasIR;
}

export interface ResolvedExportPages {
	readonly pages: readonly CanvasPage[];
}

/**
 * Resolve a page scope (`current`/`all`/`pages`/`selection`) against a live
 * IR into the concrete page list (or synthetic selection page) an export
 * needs to render.
 *
 * Throws {@link CanvasExportEmptyError} when the SELECTION scope resolves to
 * nothing (an empty or off-page selection) — callers decide how to surface
 * that. The `pages`/`current`/`all` branches instead return an (possibly
 * empty) page list; callers already have their own "nothing to export"
 * check for that case.
 */
export function resolveExportSelection(
	input: ResolveExportScopeInput,
): ResolvedExportSelection | ResolvedExportPages {
	const { ir, activePageId, scope } = input;
	if (scope === "selection") {
		const active = ir.pages.find((p) => p.id === activePageId) ?? ir.pages[0];
		const page = active
			? buildSelectionExportPage(
					active,
					input.selectedIds ?? [],
					input.resolvedDocument,
				)
			: null;
		if (!page) throw new CanvasExportEmptyError();
		return { page, ir: { ...ir, pages: [page] } };
	}
	if (scope === "all") return { pages: [...ir.pages] };
	if (scope === "pages") {
		const idSet = new Set(input.pageIds ?? []);
		return { pages: ir.pages.filter((p) => idSet.has(p.id)) };
	}
	const active = ir.pages.find((p) => p.id === activePageId) ?? ir.pages[0];
	return { pages: active ? [active] : [] };
}

/** Narrows a {@link resolveExportSelection} result to the selection branch. */
export function isSelectionResult(
	result: ResolvedExportSelection | ResolvedExportPages,
): result is ResolvedExportSelection {
	return "page" in result;
}

export interface RenderPageArtifactInput {
	readonly exporter: CanvasExporter;
	readonly format: CanvasExportFormat;
	readonly page: CanvasPage;
	/** The IR the exporter resolves `activePageId` against — MUST contain
	 * `page` (Bug 2: pass a scoped IR for selection/whole-doc scopes, never
	 * the original unscoped document). */
	readonly docIr: CanvasIR;
	readonly stage: Konva.Stage | null;
	readonly brandKit?: BrandKit;
	/**
	 * cp2-007: the editor's resolved font catalog, forwarded onto the
	 * `CanvasExportContext` the exporter receives. Carried here for the
	 * same reason `brandKit` is — the runner is the ONE place both UI entry
	 * points (`ExportDialog`) and the headless action (`export-action.ts`) build
	 * an export context, so threading it here is what stops the two from
	 * drifting on what an exporter can see.
	 */
	readonly fontCatalog?: CanvasFontCatalog;
	readonly request: CanvasExportRequest;
	/** Defaults to `2` (retina). An `{x, y}` pair stretches non-proportionally
	 * (FR-153 custom width × height, Bug 1) via Konva's own axis scale. */
	readonly pixelRatio?: number | { readonly x: number; readonly y: number };
	/** Defaults to `true`. Raster-only. */
	readonly includeBackground?: boolean;
	/**
	 * FR-150: true when `exporter` is a host-supplied override for this format
	 * (`CanvasExportPluginOptions.exporters`), not the built-in default. The
	 * built-in PNG/JPEG/WebP exporters (`exporters.ts`) call `stage.toDataURL`
	 * on the LIVE on-screen Konva stage, which only ever shows the active
	 * page — safe for the offscreen `rasterizePage` fallback below, but wrong
	 * for a host override, which is expected to honor `docIr`/`page` like any
	 * other exporter. Defaults to `false` (preserves the offscreen-rasterizer
	 * path for the built-in exporters and for `export-action.ts`, which never
	 * accepts host overrides by design).
	 */
	readonly isHostOverride?: boolean;
}

/**
 * Render ONE artifact for one page. Raster formats go through the offscreen
 * rasterizer directly UNLESS a host explicitly overrode that format
 * (`isHostOverride`); everything else calls the injected `exporter` with
 * `docIr` (a properly scoped IR — see {@link resolveExportSelection}).
 */
/**
 * T-M3-10: one resolution per exported document object. `docIr` may be a
 * SCOPED document (a synthetic selection page, a filtered page list), whose
 * top-level transforms differ from the live document's — so the correct tree
 * is a resolution of `docIr` ITSELF, never the studio store's (which also
 * carries previews). The `WeakMap` makes the per-page export loop resolve the
 * shared document once and evicts with it.
 */
const exportResolutions = new WeakMap<CanvasIR, CanvasResolvedDocument>();
function exportResolutionFor(ir: CanvasIR): CanvasResolvedDocument {
	let resolved = exportResolutions.get(ir);
	if (!resolved) {
		// Plan 0023 M6-02: the COMPOSED resolver, not `resolveCanvasLayout`. With a
		// layout-only resolution a `component-instance` record still holds the
		// instance node, so the renderer's instance branch takes its degraded path
		// and a raster export would show the missing-component PLACEHOLDER instead
		// of the component. Expansion is what makes PNG/JPEG/WebP match the stage.
		resolved = resolveCanvasDocument(ir, {
			measurement: createCanvasLayoutMeasurementProvider(),
		});
		exportResolutions.set(ir, resolved);
	}
	return resolved;
}

export async function renderPageArtifact(
	input: RenderPageArtifactInput,
): Promise<CanvasExportArtifact> {
	const { format, page, docIr, request } = input;
	if (RASTER_FORMATS.has(format) && !input.isHostOverride) {
		const { url, mimeType } = await rasterizePage({
			page,
			assets: docIr.assets,
			...(input.brandKit ? { brandKit: input.brandKit } : {}),
			pixelRatio: input.pixelRatio ?? 2,
			mimeType: RASTER_MIME[format],
			quality: request.quality,
			includeBackground: input.includeBackground ?? true,
			resolvedDocument: exportResolutionFor(docIr),
		});
		return { filename: `${page.id}.${format}`, data: url, mimeType };
	}
	return input.exporter(
		{
			ir: docIr,
			activePageId: page.id,
			stage: input.stage,
			...(input.brandKit ? { brandKit: input.brandKit } : {}),
			...(input.fontCatalog ? { fontCatalog: input.fontCatalog } : {}),
		},
		request,
	);
}

export interface RenderWholeDocArtifactInput {
	readonly exporter: CanvasExporter;
	readonly ir: CanvasIR;
	readonly pages: readonly CanvasPage[];
	readonly activePageId: string;
	readonly stage: Konva.Stage | null;
	readonly brandKit?: BrandKit;
	/** cp2-007 — see {@link RenderPageArtifactInput.fontCatalog}. */
	readonly fontCatalog?: CanvasFontCatalog;
	readonly request: CanvasExportRequest;
}

/**
 * Render the ONE artifact whole-document formats (PDF/JSON) produce, over an
 * IR scoped to exactly `pages` — the Bug 2/Bug 3 fix: `all`/`pages`/
 * `selection` scopes must never leak the full unscoped document into a
 * PDF/JSON export.
 */
export async function renderWholeDocArtifact(
	input: RenderWholeDocArtifactInput,
): Promise<CanvasExportArtifact> {
	const scopedIr: CanvasIR = { ...input.ir, pages: [...input.pages] };
	return input.exporter(
		{
			ir: scopedIr,
			activePageId: input.pages[0]?.id ?? input.activePageId,
			stage: input.stage,
			...(input.brandKit ? { brandKit: input.brandKit } : {}),
			...(input.fontCatalog ? { fontCatalog: input.fontCatalog } : {}),
		},
		input.request,
	);
}
