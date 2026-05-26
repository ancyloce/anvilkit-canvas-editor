"use client";

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
import { useCanvasStudio } from "../context/canvas-studio-context.js";
import {
	DEFAULT_CANVAS_EXPORTERS,
	downloadCanvasArtifact,
} from "./exporters.js";
import type { CanvasExportFormat, CanvasExportPluginOptions } from "./types.js";

interface FormatMeta {
	readonly label: string;
	readonly hint: string;
	/** Raster pipelines honor quality/resolution; vector/data formats don't. */
	readonly raster: boolean;
}

const FORMAT_META: Record<CanvasExportFormat, FormatMeta> = {
	png: { label: "PNG", hint: "Best for photos", raster: true },
	svg: { label: "SVG", hint: "Scalable vector", raster: false },
	pdf: { label: "PDF", hint: "Print-ready", raster: true },
	json: { label: "JSON", hint: "Editable scene", raster: false },
};

const FORMAT_ORDER: readonly CanvasExportFormat[] = [
	"png",
	"svg",
	"pdf",
	"json",
];

const RESOLUTIONS = [
	{ value: "50", label: "50%", scale: 0.5 },
	{ value: "100", label: "100%", scale: 1 },
	{ value: "custom", label: "Custom", scale: 1 },
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
		try {
			const artifact = await exporter(
				{ ir: ctx.getIR(), activePageId: ctx.activePageId, stage: ctx.stage },
				{ quality, resolution: resolutionScale(resolution), stripMetadata },
			);
			downloadCanvasArtifact(artifact);
			setOpen(false);
		} catch (error) {
			if (onError) onError(error, activeFormat);
			else
				console.error("canvas export failed", { format: activeFormat, error });
		} finally {
			setBusy(false);
		}
	};

	return (
		<div data-testid="canvas-export-bar">
			<Popover open={open} onOpenChange={setOpen}>
				<PopoverTrigger
					data-testid="canvas-export-trigger"
					className={cn(buttonVariants({ size: "sm" }), "gap-1.5")}
				>
					<Download className="size-3.5" />
					Export
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
								Export image
							</p>
							<p className="truncate text-xs text-muted-foreground">
								{name}.{activeFormat}
								{page ? ` · ${page.size.width} × ${page.size.height} px` : ""}
							</p>
						</div>
					</div>

					{/* Format */}
					<section className="space-y-2 rounded-xl bg-muted/40 p-3">
						<p className="text-xs font-medium text-muted-foreground">Format</p>
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
											{FORMAT_META[f].hint}
										</span>
									</span>
									<RadioGroupItem id={`canvas-export-format-${f}`} value={f} />
								</Label>
							))}
						</RadioGroup>
					</section>

					{/* Quality */}
					<section className="space-y-2 rounded-xl bg-muted/40 p-3">
						<p className="text-xs font-medium text-muted-foreground">Quality</p>
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
							<span>Smaller file</span>
							<span>Best quality</span>
						</div>
					</section>

					{/* Resolution */}
					<section className="space-y-2 rounded-xl bg-muted/40 p-3">
						<p className="text-xs font-medium text-muted-foreground">
							Resolution
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
									{r.label}
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
								Remove metadata
							</p>
							<p className="text-[0.7rem] text-muted-foreground">
								Strips EXIF, location, camera info
							</p>
						</div>
						<Switch
							checked={stripMetadata}
							onCheckedChange={(checked) => setStripMetadata(checked)}
							aria-label="Remove metadata"
						/>
					</section>

					{/* Actions */}
					<div className="flex justify-end gap-2 pt-1">
						<Button
							variant="ghost"
							size="sm"
							onClick={() => setOpen(false)}
							data-testid="canvas-export-cancel"
						>
							Cancel
						</Button>
						<Button
							size="sm"
							disabled={busy}
							onClick={() => {
								void handleSave();
							}}
							data-testid="canvas-export-save"
						>
							Export {meta.label}
						</Button>
					</div>
				</PopoverPanel>
			</Popover>
		</div>
	);
}
