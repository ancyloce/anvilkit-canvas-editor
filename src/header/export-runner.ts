"use client";

import type { CanvasIR, CanvasPage } from "@anvilkit/canvas-core";
import type Konva from "konva";
import type { BrandKit } from "../brand/brand-kit.js";
import { rasterizePage } from "../render/rasterize-page.js";
import { buildSelectionExportPage } from "../render/selection-export.js";
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
			? buildSelectionExportPage(active, input.selectedIds ?? [])
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
		});
		return { filename: `${page.id}.${format}`, data: url, mimeType };
	}
	return input.exporter(
		{
			ir: docIr,
			activePageId: page.id,
			stage: input.stage,
			...(input.brandKit ? { brandKit: input.brandKit } : {}),
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
		},
		input.request,
	);
}
