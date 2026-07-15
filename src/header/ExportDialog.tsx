"use client";

import { Button } from "@anvilkit/ui/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@anvilkit/ui/dialog";
import { useMemo, useState, useSyncExternalStore } from "react";
import {
	useCanvasStudio,
	useCanvasT,
} from "../context/canvas-studio-context.js";
import { rasterizePage } from "../render/rasterize-page.js";
import { createExportStore } from "../stores/export-store.js";
import {
	DEFAULT_CANVAS_EXPORTERS,
	downloadCanvasArtifact,
} from "./exporters.js";
import type {
	CanvasExportFormat,
	CanvasExportPluginOptions,
	CanvasExportRequest,
} from "./types.js";

const FORMAT_ORDER: readonly CanvasExportFormat[] = [
	"png",
	"svg",
	"pdf",
	"json",
];

const RESOLUTIONS = [0.5, 1, 2, 3] as const;

export interface ExportDialogProps extends CanvasExportPluginOptions {
	onClose: () => void;
}

type PageScope = "current" | "all";

/**
 * The FR-150 export dialog (B-09) — the `createCanvasExportPlugin` popover's
 * contents graduated into a modal, per PRD 0012 §15.9: same
 * `CanvasExportPluginOptions`, same injected exporters, PNG/JSON built in.
 * Adds page scope (current/all), scale presets, FR-154 progress phases via
 * the export store, cancellation between pages, and per-format fidelity
 * disclosure (PDF is raster-embed — FR-151 note). Multi-page raster export
 * downloads sequentially (OD-2: ZIP deferred pending dependency approval).
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

	const available = useMemo(() => {
		const merged = { ...DEFAULT_CANVAS_EXPORTERS, ...exporters };
		const order = formats ?? FORMAT_ORDER;
		return order.filter((f) => merged[f]);
	}, [exporters, formats]);
	const merged = useMemo(
		() => ({ ...DEFAULT_CANVAS_EXPORTERS, ...exporters }),
		[exporters],
	);

	const [format, setFormat] = useState<CanvasExportFormat>(
		available[0] ?? "png",
	);
	const [scope, setScope] = useState<PageScope>("current");
	const [resolution, setResolution] = useState<number>(1);

	const busy =
		exportState.phase === "preparing" || exportState.phase === "rendering";

	const runExport = async (): Promise<void> => {
		const exporter = merged[format];
		if (!exporter) return;
		const ir = ctx.getIR();
		const request: CanvasExportRequest = {
			quality: 92,
			resolution,
			stripMetadata: true,
		};
		const pages =
			scope === "all"
				? ir.pages
				: ir.pages.filter((p) => p.id === ctx.activePageId);
		try {
			// Whole-document formats export once regardless of page scope.
			if (format === "json" || format === "pdf") {
				exportStore.getState().begin(1);
				const artifact = await exporter(
					{ ir, activePageId: ctx.activePageId, stage: ctx.stage },
					request,
				);
				downloadCanvasArtifact(artifact);
				exportStore.getState().advance();
				exportStore.getState().complete();
				return;
			}
			exportStore.getState().begin(pages.length);
			for (const [index, page] of pages.entries()) {
				if (exportStore.getState().cancelRequested) {
					exportStore.getState().markCancelled();
					return;
				}
				if (format === "png" && page.id !== ctx.activePageId) {
					// Off-screen pages raster through the shared offscreen renderer
					// (the live stage only holds the active page).
					const { url, mimeType } = await rasterizePage({
						page,
						assets: ir.assets,
						pixelRatio: 2 * resolution,
					});
					downloadCanvasArtifact({
						filename: `${ir.title?.trim() || ir.id}-${index + 1}.png`,
						data: url,
						mimeType,
					});
				} else {
					const artifact = await exporter(
						{ ir, activePageId: page.id, stage: ctx.stage },
						request,
					);
					downloadCanvasArtifact(
						pages.length > 1
							? { ...artifact, filename: `${index + 1}-${artifact.filename}` }
							: artifact,
					);
				}
				exportStore.getState().advance();
			}
			exportStore.getState().complete();
		} catch (err) {
			exportStore
				.getState()
				.fail(err instanceof Error ? err.message : String(err));
			onError?.(err, format);
		}
	};

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
					</div>

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
