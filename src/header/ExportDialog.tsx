"use client";

import type { CanvasPage } from "@anvilkit/canvas-core";
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
import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import {
	useCanvasStudio,
	useCanvasT,
} from "../context/canvas-studio-context.js";
import { rasterizePage } from "../render/rasterize-page.js";
import { buildSelectionExportPage } from "../render/selection-export.js";
import { createExportStore } from "../stores/export-store.js";
import {
	DEFAULT_CANVAS_EXPORTERS,
	downloadCanvasArtifact,
	sanitizeExportFilename,
} from "./exporters.js";
import type {
	CanvasExporter,
	CanvasExportFormat,
	CanvasExportPluginOptions,
	CanvasExportRequest,
} from "./types.js";

const FORMAT_ORDER: readonly CanvasExportFormat[] = [
	"png",
	"jpeg",
	"webp",
	"svg",
	"pdf",
	"json",
];

const RESOLUTIONS = [0.5, 1, 2, 3] as const;

/** Raster formats rendered per page via the offscreen rasterizer. */
const RASTER_FORMATS = new Set<CanvasExportFormat>(["png", "jpeg", "webp"]);
/** Whole-document formats: one artifact for the whole (scoped) IR. */
const WHOLE_DOC_FORMATS = new Set<CanvasExportFormat>(["pdf", "json"]);
const RASTER_MIME: Record<string, "image/png" | "image/jpeg" | "image/webp"> = {
	png: "image/png",
	jpeg: "image/jpeg",
	webp: "image/webp",
};

export interface ExportDialogProps extends CanvasExportPluginOptions {
	onClose: () => void;
}

type PageScope = "current" | "all" | "selection";

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

	const selectedIds = ctx.selectionStore.getState().selectedIds;
	const hasSelection = selectedIds.length > 0;

	// FR-031/FR-032 preselected scope: the node menu's "Export selection" and
	// the page menu's "Export page" post a scoped request; consume it on open.
	useEffect(() => {
		const req = ctx.exportRequestStore?.getState().consume();
		if (!req) return;
		if (req.scope === "selection") setScope("selection");
		else if (req.scope === "all") setScope("all");
		else setScope("current");
	}, [ctx.exportRequestStore]);

	const isRaster = RASTER_FORMATS.has(format);
	const isWholeDoc = WHOLE_DOC_FORMATS.has(format);
	const transparentDisabled = format === "jpeg"; // JPEG has no alpha channel.
	const busy =
		exportState.phase === "preparing" || exportState.phase === "rendering";

	function scopedPages(): CanvasPage[] {
		if (scope === "all") return [...ir.pages];
		const active =
			ir.pages.find((p) => p.id === ctx.activePageId) ?? ir.pages[0];
		return active ? [active] : [];
	}

	/** Effective pixel ratio, honoring a custom width when set (FR-153). */
	function pixelRatioFor(page: CanvasPage): number {
		const base = 2 * (resolution || 1);
		const w = Number.parseFloat(customW);
		if (Number.isFinite(w) && w > 0 && page.size.width > 0) {
			return (w / page.size.width) * 2;
		}
		return base;
	}

	async function runExport(): Promise<void> {
		const exporter = merged[format];
		if (!exporter) return;
		const request: CanvasExportRequest = {
			quality: quality / 100,
			resolution,
			stripMetadata: true,
		};
		const effectiveScope: PageScope =
			scope === "selection" && !hasSelection ? "current" : scope;
		try {
			// FR-031 export-selection: synthesize a page framed to the selection.
			if (effectiveScope === "selection") {
				const active =
					ir.pages.find((p) => p.id === ctx.activePageId) ?? ir.pages[0];
				const selPage = active
					? buildSelectionExportPage(active, selectedIds)
					: null;
				if (!selPage) {
					exportStore
						.getState()
						.fail(t("canvas.export.empty", "Nothing to export"));
					return;
				}
				exportStore.getState().begin(1);
				await exportOnePage(exporter, selPage, request, 0, 1);
				exportStore.getState().complete();
				return;
			}

			const pages = scopedPages();
			if (pages.length === 0) {
				exportStore
					.getState()
					.fail(t("canvas.export.empty", "Nothing to export"));
				return;
			}

			// Whole-document formats (PDF/JSON): one artifact over the scoped IR.
			if (isWholeDoc) {
				exportStore.getState().begin(1);
				const scopedIr = { ...ir, pages };
				const artifact = await exporter(
					{
						ir: scopedIr,
						activePageId: pages[0]?.id ?? ctx.activePageId,
						stage: ctx.stage,
						...(ctx.brandKit ? { brandKit: ctx.brandKit } : {}),
					},
					request,
				);
				downloadCanvasArtifact({
					...artifact,
					filename: withFilename(artifact.filename),
				});
				exportStore.getState().advance();
				exportStore.getState().complete();
				return;
			}

			// Per-page formats (raster + SVG): one artifact per page.
			exportStore.getState().begin(pages.length);
			for (const [index, page] of pages.entries()) {
				if (exportStore.getState().cancelRequested) {
					exportStore.getState().markCancelled();
					return;
				}
				await exportOnePage(exporter, page, request, index, pages.length);
				exportStore.getState().advance();
			}
			exportStore.getState().complete();
		} catch (err) {
			exportStore
				.getState()
				.fail(err instanceof Error ? err.message : String(err));
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
	): Promise<void> {
		const numbered = (name: string): string => {
			const stem = sanitizeExportFilename(filename || name, "export");
			const ext = name.includes(".")
				? name.slice(name.lastIndexOf(".") + 1)
				: format;
			return total > 1 ? `${stem}-${index + 1}.${ext}` : `${stem}.${ext}`;
		};
		if (isRaster) {
			const { url, mimeType } = await rasterizePage({
				page,
				assets: ir.assets,
				...(ctx.brandKit ? { brandKit: ctx.brandKit } : {}),
				pixelRatio: pixelRatioFor(page),
				mimeType: RASTER_MIME[format],
				quality: quality / 100,
				includeBackground,
			});
			downloadCanvasArtifact({
				filename: numbered(`${page.id}.${format}`),
				data: url,
				mimeType,
			});
			return;
		}
		// SVG (and any injected per-page exporter): render this page as active.
		const artifact = await exporter(
			{
				ir,
				activePageId: page.id,
				stage: ctx.stage,
				...(ctx.brandKit ? { brandKit: ctx.brandKit } : {}),
			},
			request,
		);
		downloadCanvasArtifact({
			...artifact,
			filename: numbered(artifact.filename),
		});
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
