"use client";

import type {
	CanvasExportDiagnostic,
	CanvasExportWarning,
} from "@anvilkit/canvas-core";
import {
	CanvasExportDiagnosticError,
	canvasExportDiagnosticsForWarnings,
	normalizeCanvasExportError,
} from "@anvilkit/canvas-core";
import { useMemo } from "react";
import {
	type CanvasEditorActions,
	createCanvasEditorActions,
	useCanvasActions,
} from "../actions/editor-actions.js";
import {
	type CanvasExportResult,
	type CanvasExportResultArtifact,
	type CanvasStudioContextValue,
	useCanvasStudio,
} from "../context/canvas-studio-context.js";
import {
	assertExportWithinLimits,
	isSelectionResult,
	renderPageArtifact,
	renderWholeDocArtifact,
	resolveExportSelection,
	WHOLE_DOC_FORMATS,
} from "./export-runner.js";
import { DEFAULT_CANVAS_EXPORTERS, toBlob } from "./exporters.js";
import type {
	CanvasExportArtifact,
	CanvasExportFormat,
	CanvasExportRequest,
} from "./types.js";
import { CanvasExportCancelledError, CanvasExportEmptyError } from "./types.js";

/**
 * PRD §11.2 headless export request — format + page scope + output knobs.
 *
 * Named `*ActionRequest`, not the PRD's bare `CanvasExportRequest`: that name
 * is already taken by the export DIALOG's popover knobs
 * (`quality`/`resolution`/`stripMetadata`, `header/types.ts`). Same
 * disambiguation `@anvilkit/canvas-core`'s `CanvasExportJobRequest` already
 * documents for its own sibling collision with this package's `header/types.ts`
 * (`export/types.ts`'s module doc comment) — the "Job" qualifier there and the
 * "Action" qualifier here both exist so a THIRD unrelated concept never has to
 * fight over the bare `CanvasExportRequest`/`CanvasExportResult` names.
 */
export interface CanvasExportActionRequest {
	readonly format: CanvasExportFormat;
	/** Defaults to `"current"`. */
	readonly scope?: "current" | "all" | "pages" | "selection";
	/** Page ids for `scope: "pages"` (FR-152 selected pages). */
	readonly pageIds?: readonly string[];
	/** 0–100. Defaults to 92. Ignored by PNG/vector/data formats. */
	readonly quality?: number;
	/** Output scale factor. Defaults to 1. */
	readonly resolution?: number;
	/** Hard-limit overrides for this headless request. */
	readonly exportLimits?: CanvasExportRequest["limits"];
	/** Print metadata for `pdf-print`; defaults to the bounded raster contract. */
	readonly print?: CanvasExportRequest["print"];
	/** Paint the page background for raster formats. Defaults to `true`. */
	readonly includeBackground?: boolean;
}

/**
 * One artifact from a headless {@link CanvasStudioActions.export} call, and
 * the PRD §11.2 headless export result. Canonical definitions live in
 * `context/canvas-studio-context.ts` — `CanvasStudioContextValue.onExport`
 * (PRD §11.1) needs this exact shape, and `check-layering.mjs` forbids
 * `context/` (rank 1) from importing `header/` (rank 2), so the type can't be
 * owned here and merely used there. Re-exported unchanged so this stays the
 * natural import path for `CanvasStudioActions.export()`'s return type.
 */
export type {
	CanvasExportResult,
	CanvasExportResultArtifact,
} from "../context/canvas-studio-context.js";

/**
 * {@link CanvasEditorActions} plus the PRD §11.2 headless `export()` action —
 * named to match the PRD's `CanvasStudioActions` exactly.
 *
 * Split from `CanvasEditorActions` (rather than adding `export` there
 * directly) because `actions/editor-actions.ts` sits in the editor's
 * `interaction-core` layer (`scripts/check-layering.mjs`) and must not
 * depend on `header/`, which is where every built-in exporter (raster/SVG/
 * PDF/JSON) already lives. This file is the composition point allowed to
 * depend on both.
 */
export interface CanvasStudioActions extends CanvasEditorActions {
	/**
	 * FR-152/§11.2 headless export: render `request.format`/`request.scope`
	 * and resolve the real artifacts — WITHOUT opening the export dialog UI
	 * and WITHOUT touching its `export-store.ts` progress state. For host
	 * code that wants export bytes programmatically (e.g. a custom
	 * "download all" feature, or a server bridge), distinct from
	 * {@link CanvasEditorActions.requestExport}, which only opens the dialog
	 * UI. Uses the built-in exporters — all seven formats ship with no host
	 * wiring (AC-010); a host needing a fully custom exporter should call
	 * that exporter function directly instead of this facade.
	 */
	export(request: CanvasExportActionRequest): Promise<CanvasExportResult>;
}

async function exportImpl(
	ctx: CanvasStudioContextValue,
	request: CanvasExportActionRequest,
): Promise<CanvasExportResult> {
	const exporter = DEFAULT_CANVAS_EXPORTERS[request.format];
	if (!exporter) {
		throw new CanvasExportDiagnosticError(
			normalizeCanvasExportError(undefined, {
				unsupportedFormat: request.format,
			}),
		);
	}
	const ir = ctx.effectiveIR ?? ctx.getIR();
	const scope = request.scope ?? "current";
	const resolution = request.resolution ?? 1;
	const exportRequest: CanvasExportRequest = {
		quality: (request.quality ?? 92) / 100,
		resolution,
		stripMetadata: true,
		...(request.exportLimits ? { limits: request.exportLimits } : {}),
		...(request.print ? { print: request.print } : {}),
	};
	const pixelRatio = 2 * resolution;
	const includeBackground = request.includeBackground ?? true;
	const selectedIds = ctx.selectionStore.getState().selectedIds;

	const resolved = resolveExportSelection({
		ir,
		activePageId: ctx.activePageId,
		scope,
		...(request.pageIds ? { pageIds: request.pageIds } : {}),
		selectedIds,
		...(ctx.resolvedDocumentStore
			? { resolvedDocument: ctx.resolvedDocumentStore.getState().resolved }
			: {}),
	});
	const costPages = isSelectionResult(resolved)
		? [resolved.page]
		: resolved.pages;
	if (costPages.length === 0) {
		throw new CanvasExportEmptyError();
	}
	assertExportWithinLimits({
		format: request.format,
		pages: costPages,
		pixelRatio,
		requestedScale: resolution,
		...(request.exportLimits ? { limits: request.exportLimits } : {}),
	});

	const artifacts: CanvasExportResultArtifact[] = [];
	const warnings: CanvasExportWarning[] = [];
	const diagnostics: CanvasExportDiagnostic[] = [];
	const collect = (artifact: CanvasExportArtifact, pageId?: string): void => {
		artifacts.push({
			filename: artifact.filename,
			blob: toBlob(artifact.data, artifact.mimeType),
			...(pageId !== undefined ? { pageId } : {}),
		});
		if (artifact.warnings) {
			warnings.push(...artifact.warnings);
			diagnostics.push(
				...canvasExportDiagnosticsForWarnings(artifact.warnings),
			);
		}
	};
	// PRD §11.1: notify the host's `onExport` on every successful resolution
	// of this action, in addition to the resolved promise the caller already
	// has — mirrors `onChange` firing alongside `commit`'s return value.
	const finish = (): CanvasExportResult => {
		const result: CanvasExportResult = {
			format: request.format,
			artifacts,
			warnings,
			diagnostics,
		};
		ctx.onExport?.(result);
		return result;
	};

	if (isSelectionResult(resolved)) {
		const artifact = await renderPageArtifact({
			exporter,
			format: request.format,
			page: resolved.page,
			docIr: resolved.ir,
			stage: ctx.stage,
			...(ctx.brandKit ? { brandKit: ctx.brandKit } : {}),
			...(ctx.fontCatalog ? { fontCatalog: ctx.fontCatalog } : {}),
			request: exportRequest,
			pixelRatio,
			includeBackground,
		});
		collect(artifact, resolved.page.id);
		return finish();
	}

	if (WHOLE_DOC_FORMATS.has(request.format)) {
		const artifact = await renderWholeDocArtifact({
			exporter,
			ir,
			pages: resolved.pages,
			activePageId: ctx.activePageId,
			stage: ctx.stage,
			...(ctx.brandKit ? { brandKit: ctx.brandKit } : {}),
			...(ctx.fontCatalog ? { fontCatalog: ctx.fontCatalog } : {}),
			request: exportRequest,
		});
		collect(artifact);
		return finish();
	}

	for (const page of resolved.pages) {
		const artifact = await renderPageArtifact({
			exporter,
			format: request.format,
			page,
			docIr: ir,
			stage: ctx.stage,
			...(ctx.brandKit ? { brandKit: ctx.brandKit } : {}),
			...(ctx.fontCatalog ? { fontCatalog: ctx.fontCatalog } : {}),
			request: exportRequest,
			pixelRatio,
			includeBackground,
		});
		collect(artifact, page.id);
	}
	return finish();
}

async function exportWithDiagnostics(
	ctx: CanvasStudioContextValue,
	request: CanvasExportActionRequest,
): Promise<CanvasExportResult> {
	try {
		return await exportImpl(ctx, request);
	} catch (error) {
		if (
			error instanceof CanvasExportDiagnosticError ||
			error instanceof CanvasExportEmptyError ||
			error instanceof CanvasExportCancelledError ||
			(error !== null &&
				typeof error === "object" &&
				"code" in error &&
				error.code === "CANVAS_EXPORT_BUDGET_EXCEEDED")
		) {
			throw error;
		}
		throw new CanvasExportDiagnosticError(
			normalizeCanvasExportError(error, { source: "renderer" }),
			error,
		);
	}
}

/** Build a {@link CanvasStudioActions} facade over a studio context — the
 * `export`-augmented sibling of {@link createCanvasEditorActions}. */
export function createCanvasStudioActions(
	ctx: CanvasStudioContextValue,
): CanvasStudioActions {
	return {
		...createCanvasEditorActions(ctx),
		export: (request) => exportWithDiagnostics(ctx, request),
	};
}

/**
 * {@link CanvasStudioActions} as a hook — the `export`-augmented sibling of
 * {@link useCanvasActions}. Unlike `useCanvasActions` (which only reads the
 * STABLE store handles so it never re-renders on commit), this hook also
 * reads the full reactive `useCanvasStudio()` context because `export()`
 * needs the live `stage`/`brandKit` at call time.
 */
export function useCanvasStudioActions(): CanvasStudioActions {
	const editorActions = useCanvasActions();
	const ctx = useCanvasStudio();
	return useMemo(
		() => ({
			...editorActions,
			export: (request: CanvasExportActionRequest) =>
				exportWithDiagnostics(ctx, request),
		}),
		[editorActions, ctx],
	);
}
