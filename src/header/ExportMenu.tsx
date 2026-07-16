"use client";

import type { CanvasExportWarning } from "@anvilkit/canvas-core";
import { Button, buttonVariants } from "@anvilkit/ui/button";
import {
	Popover,
	PopoverPanel,
	PopoverTrigger,
} from "@anvilkit/ui/components/animate-ui/components/base/popover";
import { Switch } from "@anvilkit/ui/components/animate-ui/components/base/switch";
import { Label } from "@anvilkit/ui/label";
import { cn } from "@anvilkit/ui/lib/utils";
import { RadioGroup, RadioGroupItem } from "@anvilkit/ui/radio-group";
import { Slider } from "@anvilkit/ui/slider";
import { Download } from "lucide-react";
import { useState } from "react";
import {
	useCanvasStudio,
	useCanvasT,
} from "../context/canvas-studio-context.js";
import {
	DEFAULT_CANVAS_EXPORTERS,
	downloadCanvasArtifact,
} from "./exporters.js";
import type { CanvasExportFormat, CanvasExportPluginOptions } from "./types.js";

interface FormatMeta {
	/** Format acronym — locale-neutral, not translated. */
	readonly label: string;
	/** i18n key for the hint; `hint` is the English fallback. */
	readonly hintKey: string;
	readonly hint: string;
	/** Raster pipelines honor quality/resolution; vector/data formats don't. */
	readonly raster: boolean;
}

const FORMAT_META: Record<CanvasExportFormat, FormatMeta> = {
	png: {
		label: "PNG",
		hintKey: "canvas.export.hint.png",
		hint: "Best for photos",
		raster: true,
	},
	jpeg: {
		label: "JPG",
		hintKey: "canvas.export.hint.jpeg",
		hint: "Small photos, no transparency",
		raster: true,
	},
	webp: {
		label: "WebP",
		hintKey: "canvas.export.hint.webp",
		hint: "Modern small raster",
		raster: true,
	},
	svg: {
		label: "SVG",
		hintKey: "canvas.export.hint.svg",
		hint: "Scalable vector",
		raster: false,
	},
	pdf: {
		label: "PDF",
		hintKey: "canvas.export.hint.pdf",
		hint: "Print-ready",
		raster: true,
	},
	json: {
		label: "JSON",
		hintKey: "canvas.export.hint.json",
		hint: "Editable scene",
		raster: false,
	},
};

const FORMAT_ORDER: readonly CanvasExportFormat[] = [
	"png",
	"jpeg",
	"webp",
	"svg",
	"pdf",
	"json",
];

const RESOLUTIONS = [
	{ value: "50", labelKey: "canvas.export.res50", label: "50%", scale: 0.5 },
	{ value: "100", labelKey: "canvas.export.res100", label: "100%", scale: 1 },
	{
		value: "custom",
		labelKey: "canvas.export.resCustom",
		label: "Custom",
		scale: 1,
	},
] as const;

function resolutionScale(value: string): number {
	return RESOLUTIONS.find((r) => r.value === value)?.scale ?? 1;
}

/**
 * The header export control: an `@anvilkit/ui` popover laid out after the
 * reference "Export image" panel (format cards · quality · resolution ·
 * metadata toggle · Export). Reads the live stage/IR from
 * {@link useCanvasStudio} and runs the matching exporter, then downloads.
 * PNG/JSON are built in; SVG/PDF (and overrides) arrive via `exporters`.
 */
export function ExportMenu({
	exporters,
	formats,
	onError,
}: CanvasExportPluginOptions): React.JSX.Element | null {
	const ctx = useCanvasStudio();
	const t = useCanvasT();
	const merged = { ...DEFAULT_CANVAS_EXPORTERS, ...exporters };
	const available = (formats ?? FORMAT_ORDER).filter((f) => merged[f]);

	const [open, setOpen] = useState(false);
	const [format, setFormat] = useState<CanvasExportFormat>(
		available[0] ?? "png",
	);
	const [quality, setQuality] = useState(90);
	const [resolution, setResolution] = useState("100");
	const [stripMetadata, setStripMetadata] = useState(true);
	const [busy, setBusy] = useState(false);
	// Default in-UI failure surface (W6). When the host wires `onError` it owns
	// the reporting; otherwise we show an inline message so a failed export is
	// never silent (previously it only logged to the console).
	const [error, setError] = useState<string | null>(null);
	// FR-041/UX-007 (canvas-m3-002/008): fidelity warnings from the artifact,
	// if the exporter attached any. The download still fires immediately (the
	// artifact is already fully rendered by the time warnings are known), but
	// the popover stays open so the warnings are visible right alongside it
	// rather than silently discarded.
	const [warnings, setWarnings] = useState<readonly CanvasExportWarning[]>([]);

	if (available.length === 0) return null;

	// `format` may point at a removed exporter after a prop change; fall back.
	const activeFormat = available.includes(format)
		? format
		: (available[0] ?? format);
	const meta = FORMAT_META[activeFormat];
	const page =
		ctx.ir.pages.find((p) => p.id === ctx.activePageId) ?? ctx.ir.pages[0];
	const name = ctx.ir.title || ctx.activePageId;

	const handleSave = async () => {
		const exporter = merged[activeFormat];
		if (!exporter || busy) return;
		setBusy(true);
		setError(null);
		setWarnings([]);
		try {
			const artifact = await exporter(
				{
					ir: ctx.getIR(),
					activePageId: ctx.activePageId,
					stage: ctx.stage,
					...(ctx.brandKit ? { brandKit: ctx.brandKit } : {}),
				},
				{ quality, resolution: resolutionScale(resolution), stripMetadata },
			);
			downloadCanvasArtifact(artifact);
			if (artifact.warnings && artifact.warnings.length > 0) {
				setWarnings(artifact.warnings);
			} else {
				setOpen(false);
			}
		} catch (err) {
			// Host owns reporting when it wired `onError`; otherwise surface the
			// failure inline (W6) so the user isn't left with a silently dead button.
			if (onError) onError(err, activeFormat);
			else {
				console.error("canvas export failed", {
					format: activeFormat,
					error: err,
				});
				setError(err instanceof Error ? err.message : String(err));
			}
		} finally {
			setBusy(false);
		}
	};

	return (
		<div data-testid="canvas-export-bar">
			<Popover
				open={open}
				onOpenChange={(next) => {
					setOpen(next);
					if (next) {
						setError(null);
						setWarnings([]);
					}
				}}
			>
				<PopoverTrigger
					data-testid="canvas-export-trigger"
					className={cn(buttonVariants({ size: "sm" }), "gap-1.5")}
				>
					<Download className="size-3.5" />
					{t("canvas.export.trigger", "Export")}
				</PopoverTrigger>
				<PopoverPanel
					align="end"
					sideOffset={8}
					className="w-80 space-y-3 p-3"
					data-testid="canvas-export-panel"
				>
					{/* Header — filename + source dimensions */}
					<div className="flex items-center gap-3">
						<div className="flex size-10 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground">
							<Download className="size-4" />
						</div>
						<div className="min-w-0">
							<p className="truncate text-sm font-semibold text-foreground">
								{t("canvas.export.title", "Export image")}
							</p>
							<p className="truncate text-xs text-muted-foreground">
								{name}.{activeFormat}
								{page ? ` · ${page.size.width} × ${page.size.height} px` : ""}
							</p>
						</div>
					</div>

					{/* Format */}
					<section className="space-y-2 rounded-xl bg-muted/40 p-3">
						<p className="text-xs font-medium text-muted-foreground">
							{t("canvas.export.format", "Format")}
						</p>
						<RadioGroup
							className="grid-cols-2"
							value={activeFormat}
							onValueChange={(value) => setFormat(value as CanvasExportFormat)}
						>
							{available.map((f) => (
								<Label
									key={f}
									htmlFor={`canvas-export-format-${f}`}
									data-testid={`canvas-export-${f}`}
									data-active={activeFormat === f}
									className={cn(
										"flex cursor-pointer items-center justify-between gap-2 rounded-lg border border-border bg-background p-2.5",
										"data-[active=true]:border-primary data-[active=true]:ring-1 data-[active=true]:ring-primary",
									)}
								>
									<span className="flex flex-col gap-0.5">
										<span className="text-sm font-semibold text-foreground">
											{FORMAT_META[f].label}
										</span>
										<span className="text-[0.7rem] font-normal text-muted-foreground">
											{t(FORMAT_META[f].hintKey, FORMAT_META[f].hint)}
										</span>
									</span>
									<RadioGroupItem id={`canvas-export-format-${f}`} value={f} />
								</Label>
							))}
						</RadioGroup>
					</section>

					{/* Quality */}
					<section className="space-y-2 rounded-xl bg-muted/40 p-3">
						<p className="text-xs font-medium text-muted-foreground">
							{t("canvas.export.quality", "Quality")}
						</p>
						<Slider
							value={[quality]}
							min={0}
							max={100}
							disabled={!meta.raster}
							onValueChange={(value) =>
								setQuality(Array.isArray(value) ? (value[0] ?? 0) : value)
							}
						/>
						<div className="flex justify-between text-[0.7rem] text-muted-foreground">
							<span>{t("canvas.export.smallerFile", "Smaller file")}</span>
							<span>{t("canvas.export.bestQuality", "Best quality")}</span>
						</div>
					</section>

					{/* Resolution */}
					<section className="space-y-2 rounded-xl bg-muted/40 p-3">
						<p className="text-xs font-medium text-muted-foreground">
							{t("canvas.export.resolution", "Resolution")}
						</p>
						<RadioGroup
							className="grid-cols-3"
							value={resolution}
							disabled={!meta.raster}
							onValueChange={(value) => setResolution(String(value))}
						>
							{RESOLUTIONS.map((r) => (
								<Label
									key={r.value}
									htmlFor={`canvas-export-res-${r.value}`}
									data-active={resolution === r.value}
									className={cn(
										"flex cursor-pointer items-center justify-center gap-1.5 rounded-lg border border-border bg-background p-2 text-sm font-semibold",
										"data-[active=true]:border-primary data-[active=true]:ring-1 data-[active=true]:ring-primary",
										!meta.raster && "cursor-not-allowed opacity-50",
									)}
								>
									{t(r.labelKey, r.label)}
									<RadioGroupItem
										id={`canvas-export-res-${r.value}`}
										value={r.value}
										disabled={!meta.raster}
									/>
								</Label>
							))}
						</RadioGroup>
					</section>

					{/* Remove metadata */}
					<section className="flex items-center justify-between rounded-xl bg-muted/40 p-3">
						<div className="space-y-0.5">
							<p className="text-sm font-medium text-foreground">
								{t("canvas.export.removeMetadata", "Remove metadata")}
							</p>
							<p className="text-[0.7rem] text-muted-foreground">
								{t(
									"canvas.export.removeMetadataHint",
									"Strips EXIF, location, camera info",
								)}
							</p>
						</div>
						<Switch
							checked={stripMetadata}
							onCheckedChange={(checked) => setStripMetadata(checked)}
							aria-label={t("canvas.export.removeMetadata", "Remove metadata")}
						/>
					</section>

					{/* Fidelity warnings (FR-041/UX-007, canvas-m3-002/008) — shown
					    after a successful export whose artifact carried any; cleared
					    on a new attempt or on reopen. The download already fired. */}
					{warnings.length > 0 ? (
						<ul
							data-testid="canvas-export-warnings"
							className="space-y-1 rounded-md bg-amber-500/10 px-2.5 py-1.5 text-[0.7rem] text-amber-700 dark:text-amber-400"
						>
							{warnings.map((warning) => (
								<li
									key={`${warning.code}-${warning.nodeId ?? warning.pageId ?? ""}`}
								>
									{warning.message}
									{warning.fallback ? ` — ${warning.fallback}` : ""}
								</li>
							))}
						</ul>
					) : null}

					{/* Inline failure surface (W6) — shown only when the host did not
					    wire `onError`; cleared on a new attempt or on reopen. */}
					{error ? (
						<p
							role="alert"
							data-testid="canvas-export-error"
							className="rounded-md bg-destructive/10 px-2.5 py-1.5 text-[0.7rem] text-destructive"
						>
							{t("canvas.export.failed", "Export failed:")} {error}
						</p>
					) : null}

					{/* Actions */}
					<div className="flex justify-end gap-2 pt-1">
						<Button
							variant="ghost"
							size="sm"
							onClick={() => setOpen(false)}
							data-testid="canvas-export-cancel"
						>
							{t("canvas.export.cancel", "Cancel")}
						</Button>
						<Button
							size="sm"
							disabled={busy}
							onClick={() => {
								void handleSave();
							}}
							data-testid="canvas-export-save"
						>
							{t("canvas.export.exportFormat", "Export {label}").replace(
								"{label}",
								meta.label,
							)}
						</Button>
					</div>
				</PopoverPanel>
			</Popover>
		</div>
	);
}
