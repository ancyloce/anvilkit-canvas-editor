"use client";

import type {
	CanvasExportWarning,
	CanvasIR,
	CanvasPage,
} from "@anvilkit/canvas-core";
import { Button } from "@anvilkit/ui/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@anvilkit/ui/dialog";
import { Input } from "@anvilkit/ui/input";
import * as React from "react";
import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import {
	type CanvasExportResultArtifact,
	useCanvasStudio,
	useCanvasT,
} from "../context/canvas-studio-context.js";
import { useCanvasToaster } from "../context/toast-context.js";
import { createExportStore } from "../stores/export-store.js";
import {
	isSelectionResult,
	RASTER_FORMATS,
	type ResolvedExportPages,
	type ResolvedExportSelection,
	renderPageArtifact,
	renderWholeDocArtifact,
	resolveExportSelection,
	WHOLE_DOC_FORMATS,
} from "./export-runner.js";
import {
	DEFAULT_CANVAS_EXPORTERS,
	downloadCanvasArtifact,
	sanitizeExportFilename,
	toBlob,
} from "./exporters.js";
import type {
	CanvasExportArtifact,
	CanvasExporter,
	CanvasExportFormat,
	CanvasExportPluginOptions,
	CanvasExportRequest,
} from "./types.js";
import { CanvasExportCancelledError, CanvasExportEmptyError } from "./types.js";

const FORMAT_ORDER: readonly CanvasExportFormat[] = [
	"png",
	"jpeg",
	"webp",
	"svg",
	"pdf",
	"json",
];

const RESOLUTIONS = [0.5, 1, 2, 3] as const;

export interface ExportDialogProps extends CanvasExportPluginOptions {
	onClose: () => void;
}

type PageScope = "current" | "all" | "pages" | "selection";

/**
 * The FR-150 export dialog (B-09, extended for FR-151..153 and §14.5) — the
 * `createCanvasExportPlugin` popover's contents graduated into a modal, per
 * PRD 0012 §15.9: same `CanvasExportPluginOptions`, same injected exporters,
 * and now the full built-in format set (PNG/JPEG/WebP/SVG/PDF/JSON) plus
 * page scope (current/all/selection), scale presets, custom dimensions with
 * aspect lock, quality, transparent / include background, a sanitized file
 * name, FR-154 progress phases with cancellation, and per-format fidelity
 * disclosure. Multi-page raster export downloads one file per page (OD-2: ZIP
 * deferred pending dependency approval); multi-page PDF packs into one file.
 */
export default function ExportDialog({
	onClose,
	exporters,
	formats,
	onError,
}: ExportDialogProps): React.JSX.Element {
	const ctx = useCanvasStudio();
	const t = useCanvasT();
	const toaster = useCanvasToaster();
	const exportStore = useMemo(() => createExportStore(), []);
	const exportState = useSyncExternalStore(
		exportStore.subscribe,
		() => exportStore.getState(),
		() => exportStore.getState(),
	);

	const merged = useMemo(
		() => ({ ...DEFAULT_CANVAS_EXPORTERS, ...exporters }),
		[exporters],
	);
	const available = useMemo(() => {
		const order = formats ?? FORMAT_ORDER;
		return order.filter((f) => merged[f]);
	}, [merged, formats]);

	const [format, setFormat] = useState<CanvasExportFormat>(
		available[0] ?? "png",
	);
	const [scope, setScope] = useState<PageScope>("current");
	const [resolution, setResolution] = useState<number>(1);
	const [quality, setQuality] = useState<number>(92);
	const [includeBackground, setIncludeBackground] = useState(true);
	const ir = ctx.getIR();
	const [filename, setFilename] = useState(() =>
		sanitizeExportFilename(ir.title?.trim() || ir.id || "canvas"),
	);
	const [customW, setCustomW] = useState<string>("");
	const [customH, setCustomH] = useState<string>("");
	const [lockAspect, setLockAspect] = useState(true);
	// FR-152 "Selected pages" (Bug 3): populated only by an incoming
	// `scope: "pages"` request from the page navigator's multi-select — the
	// dialog has no page-multi-select UI of its own.
	const [pageIds, setPageIds] = useState<readonly string[]>([]);

	const selectedIds = ctx.selectionStore.getState().selectedIds;
	const hasSelection = selectedIds.length > 0;

	// FR-031/FR-032/FR-152 preselected scope: the node menu's "Export
	// selection", the page menu's "Export page"/"Export selected pages" post a
	// scoped request; consume it on open.
	useEffect(() => {
		const req = ctx.exportRequestStore?.getState().consume();
		if (!req) return;
		if (req.scope === "selection") setScope("selection");
		else if (req.scope === "all") setScope("all");
		else if (req.scope === "pages" && req.pageIds && req.pageIds.length > 0) {
			setPageIds(req.pageIds);
			setScope("pages");
		} else setScope("current");
	}, [ctx.exportRequestStore]);

	const isRaster = RASTER_FORMATS.has(format);
	const isWholeDoc = WHOLE_DOC_FORMATS.has(format);
	const transparentDisabled = format === "jpeg"; // JPEG has no alpha channel.
	const busy =
		exportState.phase === "preparing" || exportState.phase === "rendering";

	/** Effective pixel ratio, honoring custom width/height when set (FR-153,
	 * Bug 1 fix): an unlocked, non-proportional width × height pair now
	 * reaches the rasterizer as an independent `{x, y}` ratio instead of
	 * being silently collapsed to a single width-derived number. */
	function pixelRatioFor(page: CanvasPage): number | { x: number; y: number } {
		const base = 2 * (resolution || 1);
		const w = Number.parseFloat(customW);
		const h = Number.parseFloat(customH);
		const hasW = Number.isFinite(w) && w > 0 && page.size.width > 0;
		const hasH = Number.isFinite(h) && h > 0 && page.size.height > 0;
		if (!hasW && !hasH) return base;
		const x = hasW ? (w / page.size.width) * 2 : base;
		const y = hasH ? (h / page.size.height) * 2 : base;
		return x === y ? x : { x, y };
	}

	/**
	 * FR-170: a dedicated toast for export completion/failure, IN ADDITION to
	 * the inline `exportState.phase` status above — a user who closes this
	 * dialog while a longer export (e.g. multi-page PDF) is still running
	 * would otherwise never see that inline status resolve. `toaster` is a
	 * captured reference, not tied to this component's mount state, so it
	 * still fires correctly if `runExport`'s promise chain settles after the
	 * dialog (and this component) has already unmounted.
	 */
	function completeExport(): void {
		exportStore.getState().complete();
		toaster.add({
			type: "success",
			title: t("canvas.export.completed", "Export complete"),
		});
	}

	function failExport(message: string): void {
		exportStore.getState().fail(message);
		toaster.add({
			type: "error",
			title: t("canvas.export.failed", "Export failed"),
			description: message,
		});
	}

	async function runExport(): Promise<void> {
		const exporter = merged[format];
		if (!exporter) return;
		const request: CanvasExportRequest = {
			quality: quality / 100,
			resolution,
			stripMetadata: true,
			// Bug 4 (FR-154): poll-based cancellation the built-in multi-page PDF
			// exporter checks between its own per-page rasterization passes.
			isCancelled: () => exportStore.getState().cancelRequested,
		};
		const effectiveScope: PageScope =
			scope === "selection" && !hasSelection ? "current" : scope;
		try {
			let resolved: ResolvedExportSelection | ResolvedExportPages;
			try {
				resolved = resolveExportSelection({
					ir,
					activePageId: ctx.activePageId,
					scope: effectiveScope,
					pageIds,
					selectedIds,
				});
			} catch (err) {
				if (err instanceof CanvasExportEmptyError) {
					failExport(t("canvas.export.empty", "Nothing to export"));
					return;
				}
				throw err;
			}

			// FR-031 export-selection: ONE artifact over the synthetic selection
			// page, properly scoped (Bug 2) for every format — SVG no longer
			// throws, PDF/JSON no longer silently export the whole document.
			if (isSelectionResult(resolved)) {
				exportStore.getState().begin(1);
				if (exportStore.getState().cancelRequested) {
					exportStore.getState().markCancelled();
					return;
				}
				const artifact = await renderPageArtifact({
					exporter,
					format,
					page: resolved.page,
					docIr: resolved.ir,
					stage: ctx.stage,
					...(ctx.brandKit ? { brandKit: ctx.brandKit } : {}),
					request,
					pixelRatio: pixelRatioFor(resolved.page),
					includeBackground,
				});
				const downloadFilename = withFilename(artifact.filename);
				downloadCanvasArtifact({ ...artifact, filename: downloadFilename });
				// PRD §11.1: notify the host's `onExport` for this UI-driven export
				// too, with the SAME `CanvasExportResult` shape the headless
				// `useCanvasStudioActions().export()` action produces.
				ctx.onExport?.({
					format,
					artifacts: [
						{
							filename: downloadFilename,
							blob: toBlob(artifact.data, artifact.mimeType),
							pageId: resolved.page.id,
						},
					],
					warnings: artifact.warnings ?? [],
				});
				exportStore.getState().advance();
				completeExport();
				return;
			}

			const pages = resolved.pages;
			if (pages.length === 0) {
				failExport(t("canvas.export.empty", "Nothing to export"));
				return;
			}

			// Whole-document formats (PDF/JSON): one artifact over an IR scoped to
			// exactly `pages` (Bug 2/3: `all`/`pages`/`selection` scopes must never
			// leak the full unscoped document).
			if (isWholeDoc) {
				exportStore.getState().begin(1);
				if (exportStore.getState().cancelRequested) {
					exportStore.getState().markCancelled();
					return;
				}
				let artifact: CanvasExportArtifact;
				try {
					artifact = await renderWholeDocArtifact({
						exporter,
						ir,
						pages,
						activePageId: ctx.activePageId,
						stage: ctx.stage,
						...(ctx.brandKit ? { brandKit: ctx.brandKit } : {}),
						request,
					});
				} catch (err) {
					if (err instanceof CanvasExportCancelledError) {
						exportStore.getState().markCancelled();
						return;
					}
					throw err;
				}
				// Bug 4: cancellation may have landed while the (opaque,
				// un-interruptible) whole-doc render was in flight — discard the
				// finished artifact instead of downloading it.
				if (exportStore.getState().cancelRequested) {
					exportStore.getState().markCancelled();
					return;
				}
				const downloadFilename = withFilename(artifact.filename);
				downloadCanvasArtifact({ ...artifact, filename: downloadFilename });
				ctx.onExport?.({
					format,
					artifacts: [
						{
							filename: downloadFilename,
							blob: toBlob(artifact.data, artifact.mimeType),
						},
					],
					warnings: artifact.warnings ?? [],
				});
				exportStore.getState().advance();
				completeExport();
				return;
			}

			// Per-page formats (raster + SVG): one artifact per page. Every
			// page's artifact is collected into ONE `onExport` call after the
			// loop — mirrors the headless action's per-page-loop branch, which
			// also reports every page as one result (§11.2).
			exportStore.getState().begin(pages.length);
			const resultArtifacts: CanvasExportResultArtifact[] = [];
			const resultWarnings: CanvasExportWarning[] = [];
			for (const [index, page] of pages.entries()) {
				if (exportStore.getState().cancelRequested) {
					exportStore.getState().markCancelled();
					return;
				}
				const pageResult = await exportOnePage(
					exporter,
					page,
					request,
					index,
					pages.length,
				);
				resultArtifacts.push(pageResult.artifact);
				resultWarnings.push(...pageResult.warnings);
				exportStore.getState().advance();
			}
			ctx.onExport?.({
				format,
				artifacts: resultArtifacts,
				warnings: resultWarnings,
			});
			completeExport();
		} catch (err) {
			failExport(err instanceof Error ? err.message : String(err));
			onError?.(err, format);
		}
	}

	function withFilename(fallback: string): string {
		const stem = sanitizeExportFilename(filename || fallback, "export");
		const ext = fallback.includes(".")
			? fallback.slice(fallback.lastIndexOf(".") + 1)
			: format;
		return `${stem}.${ext}`;
	}

	async function exportOnePage(
		exporter: CanvasExporter,
		page: CanvasPage,
		request: CanvasExportRequest,
		index: number,
		total: number,
	): Promise<{
		artifact: CanvasExportResultArtifact;
		warnings: readonly CanvasExportWarning[];
	}> {
		const numbered = (name: string): string => {
			const stem = sanitizeExportFilename(filename || name, "export");
			const ext = name.includes(".")
				? name.slice(name.lastIndexOf(".") + 1)
				: format;
			return total > 1 ? `${stem}-${index + 1}.${ext}` : `${stem}.${ext}`;
		};
		const artifact = await renderPageArtifact({
			exporter,
			format,
			page,
			docIr: ir,
			stage: ctx.stage,
			...(ctx.brandKit ? { brandKit: ctx.brandKit } : {}),
			request,
			pixelRatio: pixelRatioFor(page),
			includeBackground,
		});
		const downloadFilename = numbered(artifact.filename);
		downloadCanvasArtifact({ ...artifact, filename: downloadFilename });
		return {
			artifact: {
				filename: downloadFilename,
				blob: toBlob(artifact.data, artifact.mimeType),
				pageId: page.id,
			},
			warnings: artifact.warnings ?? [],
		};
	}

	return (
		<Dialog open onOpenChange={(open) => !open && onClose()}>
			<DialogContent data-testid="export-dialog">
				<DialogHeader>
					<DialogTitle>{t("canvas.export.title", "Export")}</DialogTitle>
					<DialogDescription>
						{t("canvas.export.subtitle", "Choose a format, pages, and scale.")}
					</DialogDescription>
				</DialogHeader>

				<div className="flex flex-col gap-3 text-sm">
					<div className="flex flex-wrap gap-1.5" role="radiogroup">
						{available.map((f) => (
							<Button
								key={f}
								type="button"
								size="sm"
								variant={format === f ? "default" : "outline"}
								data-testid={`export-format-${f}`}
								aria-pressed={format === f}
								onClick={() => setFormat(f)}
							>
								{f.toUpperCase()}
							</Button>
						))}
					</div>

					{format === "pdf" ? (
						<p
							data-testid="export-fidelity-note"
							className="rounded-md bg-muted px-2 py-1.5 text-xs text-muted-foreground"
						>
							{t(
								"canvas.export.pdfFidelity",
								"PDF embeds rasterized pages — text is not selectable.",
							)}
						</p>
					) : null}

					<div className="flex items-center gap-2">
						<span className="text-xs text-muted-foreground">
							{t("canvas.export.pages", "Pages")}
						</span>
						<Button
							type="button"
							size="sm"
							variant={scope === "current" ? "default" : "outline"}
							data-testid="export-pages-current"
							onClick={() => setScope("current")}
						>
							{t("canvas.export.currentPage", "Current page")}
						</Button>
						<Button
							type="button"
							size="sm"
							variant={scope === "all" ? "default" : "outline"}
							data-testid="export-pages-all"
							onClick={() => setScope("all")}
						>
							{t("canvas.export.allPages", "All pages")}
						</Button>
						<Button
							type="button"
							size="sm"
							variant={scope === "selection" ? "default" : "outline"}
							data-testid="export-pages-selection"
							disabled={!hasSelection}
							title={
								hasSelection
									? undefined
									: t("canvas.export.selectionEmpty", "Select nodes first")
							}
							onClick={() => setScope("selection")}
						>
							{t("canvas.export.selection", "Selection")}
						</Button>
						{pageIds.length > 0 ? (
							<Button
								type="button"
								size="sm"
								variant={scope === "pages" ? "default" : "outline"}
								data-testid="export-pages-selected"
								aria-pressed={scope === "pages"}
								onClick={() => setScope("pages")}
							>
								{t(
									"canvas.export.selectedPages",
									"Selected pages ({n})",
								).replace("{n}", String(pageIds.length))}
							</Button>
						) : null}
					</div>

					{isRaster ? (
						<>
							<div className="flex items-center gap-2">
								<span className="text-xs text-muted-foreground">
									{t("canvas.export.scale", "Scale")}
								</span>
								{RESOLUTIONS.map((r) => (
									<Button
										key={r}
										type="button"
										size="sm"
										variant={resolution === r ? "default" : "outline"}
										data-testid={`export-scale-${r}`}
										onClick={() => setResolution(r)}
									>
										{r}x
									</Button>
								))}
							</div>

							<div className="flex items-center gap-2">
								<span className="text-xs text-muted-foreground">
									{t("canvas.export.customSize", "Custom size")}
								</span>
								<Input
									type="number"
									inputMode="numeric"
									className="h-7 w-20"
									aria-label={t("canvas.export.width", "Width")}
									data-testid="export-width"
									value={customW}
									placeholder="W"
									onChange={(e) => {
										const next = e.currentTarget.value;
										setCustomW(next);
										const active = ir.pages.find(
											(p) => p.id === ctx.activePageId,
										);
										const w = Number.parseFloat(next);
										if (
											lockAspect &&
											active &&
											Number.isFinite(w) &&
											active.size.width > 0
										) {
											setCustomH(
												String(
													Math.round(
														(w / active.size.width) * active.size.height,
													),
												),
											);
										}
									}}
								/>
								<span className="text-muted-foreground">×</span>
								<Input
									type="number"
									inputMode="numeric"
									className="h-7 w-20"
									aria-label={t("canvas.export.height", "Height")}
									data-testid="export-height"
									value={customH}
									placeholder="H"
									disabled={lockAspect}
									onChange={(e) => setCustomH(e.currentTarget.value)}
								/>
								<label className="flex items-center gap-1 text-xs text-muted-foreground">
									<input
										type="checkbox"
										data-testid="export-lock-aspect"
										checked={lockAspect}
										onChange={(e) => setLockAspect(e.currentTarget.checked)}
									/>
									{t("canvas.export.lockAspect", "Lock ratio")}
								</label>
							</div>

							{format !== "png" ? (
								<label className="flex items-center gap-2 text-xs text-muted-foreground">
									<span>{t("canvas.export.quality", "Quality")}</span>
									<input
										type="range"
										min={1}
										max={100}
										data-testid="export-quality"
										value={quality}
										onChange={(e) =>
											setQuality(Number.parseInt(e.currentTarget.value, 10))
										}
									/>
									<span className="tabular-nums">{quality}</span>
								</label>
							) : null}

							<label className="flex items-center gap-1.5 text-xs text-muted-foreground">
								<input
									type="checkbox"
									data-testid="export-include-background"
									checked={includeBackground && !transparentDisabled}
									disabled={transparentDisabled}
									onChange={(e) =>
										setIncludeBackground(e.currentTarget.checked)
									}
								/>
								{t("canvas.export.includeBackground", "Include background")}
								{transparentDisabled ? (
									<span className="italic">
										{t("canvas.export.jpegOpaque", "(JPEG is always opaque)")}
									</span>
								) : null}
							</label>
						</>
					) : null}

					<label className="flex items-center gap-2 text-xs text-muted-foreground">
						<span>{t("canvas.export.filename", "File name")}</span>
						<Input
							type="text"
							className="h-7 flex-1"
							data-testid="export-filename"
							value={filename}
							onChange={(e) => setFilename(e.currentTarget.value)}
						/>
					</label>

					{exportState.progress && exportState.phase !== "idle" ? (
						<div
							data-testid="export-progress"
							data-phase={exportState.phase}
							aria-live="polite"
							className="text-xs text-muted-foreground"
						>
							{exportState.phase === "completed"
								? t("canvas.export.completed", "Export complete")
								: exportState.phase === "failed"
									? (exportState.error ??
										t("canvas.export.failed", "Export failed"))
									: exportState.phase === "cancelled"
										? t("canvas.export.cancelled", "Export cancelled")
										: `${exportState.progress.done}/${exportState.progress.total}`}
						</div>
					) : null}
				</div>

				<DialogFooter>
					{busy ? (
						<Button
							type="button"
							variant="outline"
							data-testid="export-cancel"
							onClick={() => exportStore.getState().requestCancel()}
						>
							{t("canvas.dialog.cancel", "Cancel")}
						</Button>
					) : null}
					<Button
						type="button"
						data-testid="export-run"
						disabled={busy}
						onClick={() => void runExport()}
					>
						{t("canvas.export.run", "Export")}
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
