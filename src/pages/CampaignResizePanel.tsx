"use client";

/**
 * @file Campaign resize panel (canvas-m3-007 / FR-061).
 *
 * Multi-select over `CANVAS_SIZE_PRESETS` (`@anvilkit/canvas-core`) feeding
 * `resizeToVariants` via `resizeActivePageToVariants`: choosing presets and
 * confirming generates one new, fully editable page per preset from the
 * active page's content, as a single undo step (see `campaign-resize-actions.ts`).
 */

import {
	CANVAS_SIZE_PRESETS,
	type CanvasSizePreset,
} from "@anvilkit/canvas-core";
import { Button } from "@anvilkit/ui/button";
import { useState } from "react";
import {
	useCanvasStudio,
	useCanvasT,
} from "../context/canvas-studio-context.js";
import { resizeActivePageToVariants } from "./campaign-resize-actions.js";

function presetCaption(preset: CanvasSizePreset): string {
	const unit = preset.unit === "px" ? "" : preset.unit;
	return `${preset.width}×${preset.height}${unit}`;
}

export function CampaignResizePanel(): React.JSX.Element {
	const ctx = useCanvasStudio();
	const t = useCanvasT();
	const [selectedIds, setSelectedIds] = useState<ReadonlySet<string>>(
		new Set(),
	);
	const [error, setError] = useState<string | null>(null);

	function toggle(id: string): void {
		setSelectedIds((prev) => {
			const next = new Set(prev);
			if (next.has(id)) next.delete(id);
			else next.add(id);
			return next;
		});
	}

	function createVariants(): void {
		const presets = CANVAS_SIZE_PRESETS.filter((preset) =>
			selectedIds.has(preset.id),
		);
		if (presets.length === 0) return;
		const result = resizeActivePageToVariants(ctx, ctx.activePageId, presets);
		if (result.ok) {
			setError(null);
			setSelectedIds(new Set());
		} else {
			setError(result.message);
		}
	}

	return (
		<div
			data-testid="campaign-resize-panel"
			className="flex flex-col gap-2 p-2"
		>
			<div className="text-xs font-medium text-muted-foreground">
				{t("canvas.campaignResize.title", "Resize for campaign")}
			</div>
			<div className="flex flex-col gap-1">
				{CANVAS_SIZE_PRESETS.map((preset) => {
					const selected = selectedIds.has(preset.id);
					return (
						<Button
							key={preset.id}
							type="button"
							variant={selected ? "default" : "outline"}
							size="sm"
							aria-pressed={selected}
							data-testid={`campaign-resize-preset-${preset.id}`}
							className="justify-between"
							onClick={() => toggle(preset.id)}
						>
							<span>{preset.label}</span>
							<span className={selected ? undefined : "text-muted-foreground"}>
								{presetCaption(preset)}
							</span>
						</Button>
					);
				})}
			</div>
			{error ? (
				<div
					data-testid="campaign-resize-error"
					className="text-[11px] text-destructive"
				>
					{error}
				</div>
			) : null}
			<Button
				type="button"
				size="sm"
				data-testid="campaign-resize-create"
				disabled={selectedIds.size === 0}
				onClick={createVariants}
			>
				{t("canvas.campaignResize.create", "Create variants")}
			</Button>
		</div>
	);
}
