"use client";

/**
 * @file Social size preset list (canvas-m3-006 / FR-060).
 *
 * Lists `CANVAS_SIZE_PRESETS` (`@anvilkit/canvas-core`) so a host can surface
 * the catalog in the editor. Presentational only: selecting a preset invokes
 * the optional `onSelect` callback and nothing else — no resize action is
 * wired here. canvas-m3-007 (Campaign Resize) is the consumer that turns a
 * selection into an actual document mutation.
 */

import {
	CANVAS_SIZE_PRESETS,
	type CanvasSizePreset,
} from "@anvilkit/canvas-core";
import { Button } from "@anvilkit/ui/button";
import { useCanvasT } from "../context/canvas-studio-context.js";

function presetCaption(preset: CanvasSizePreset): string {
	const unit = preset.unit === "px" ? "" : preset.unit;
	return `${preset.width}×${preset.height}${unit}`;
}

export interface SizePresetPickerProps {
	/** Invoked when a preset is chosen; the picker itself does not resize anything. */
	onSelect?: (preset: CanvasSizePreset) => void;
}

export function SizePresetPicker({
	onSelect,
}: SizePresetPickerProps): React.JSX.Element {
	const t = useCanvasT();
	return (
		<div data-testid="size-preset-picker" className="flex flex-col gap-1 p-2">
			<div className="text-xs font-medium text-muted-foreground">
				{t("canvas.sizePresets.title", "Social sizes")}
			</div>
			{CANVAS_SIZE_PRESETS.map((preset) => (
				<Button
					key={preset.id}
					type="button"
					variant="outline"
					size="sm"
					data-testid={`size-preset-${preset.id}`}
					className="justify-between"
					onClick={() => onSelect?.(preset)}
				>
					<span>{preset.label}</span>
					<span className="text-muted-foreground">{presetCaption(preset)}</span>
				</Button>
			))}
		</div>
	);
}
