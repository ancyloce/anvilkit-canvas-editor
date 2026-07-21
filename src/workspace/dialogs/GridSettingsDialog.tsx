"use client";

import { Button } from "@anvilkit/ui/button";
import {
	Dialog,
	DialogContent,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@anvilkit/ui/dialog";
import { Input } from "@anvilkit/ui/input";
import { useSyncExternalStore } from "react";
import {
	useCanvasStudio,
	useCanvasT,
} from "../../context/canvas-studio-context.js";

export interface GridSettingsDialogProps {
	onClose: () => void;
}

const MIN_GRID_SIZE = 1;
const MIN_SUBDIVISIONS = 0;
const MAX_SUBDIVISIONS = 10;
const MIN_SNAP_THRESHOLD = 1;
const MAX_SNAP_THRESHOLD = 32;

/** Parse + clamp a number-field value; null (= "don't write") when empty/NaN. */
function clampInt(raw: string, min: number, max: number): number | null {
	if (raw.trim() === "") return null;
	const parsed = Number(raw);
	if (!Number.isFinite(parsed)) return null;
	return Math.min(max, Math.max(min, Math.round(parsed)));
}

/**
 * FR-112 grid settings (code-split via its lazy trigger in
 * `CanvasAreaContextMenu`, like every dialog — constraint 20.15): grid size,
 * sub-divisions, main/sub-grid colors, the snap-to-grid / snap-to-objects
 * toggles, and the snap threshold. Everything here is TRANSIENT viewport
 * chrome — every change writes straight to the viewport store's setters, so
 * there are NO history commits and nothing touches the Canvas IR. Note the
 * grid's visibility toggle lives in the context menu (`Show/Hide grid`), and
 * snap-to-grid is deliberately independent of it (see `viewport-store.ts`).
 */
export default function GridSettingsDialog({
	onClose,
}: GridSettingsDialogProps): React.JSX.Element {
	const ctx = useCanvasStudio();
	const t = useCanvasT();
	const vs = useSyncExternalStore(
		ctx.viewportStore.subscribe,
		ctx.viewportStore.getState,
		ctx.viewportStore.getState,
	);

	return (
		<Dialog open onOpenChange={(open) => !open && onClose()}>
			<DialogContent data-testid="grid-settings-dialog">
				<DialogHeader>
					<DialogTitle>
						{t("canvas.grid.settings", "Grid settings")}
					</DialogTitle>
				</DialogHeader>
				<div className="flex flex-col gap-3 text-sm">
					<div className="flex items-center gap-2">
						<label className="flex items-center gap-1 text-xs text-muted-foreground">
							{t("canvas.grid.size", "Grid size")}
							<Input
								type="number"
								min={MIN_GRID_SIZE}
								value={String(vs.gridSize)}
								data-testid="grid-settings-size"
								className="h-7.5 w-20"
								onChange={(e) => {
									const next = clampInt(
										e.currentTarget.value,
										MIN_GRID_SIZE,
										Number.MAX_SAFE_INTEGER,
									);
									if (next !== null) vs.setGridSize(next);
								}}
							/>
						</label>
						<label className="flex items-center gap-1 text-xs text-muted-foreground">
							{t("canvas.grid.subdivisions", "Subdivisions")}
							<Input
								type="number"
								min={MIN_SUBDIVISIONS}
								max={MAX_SUBDIVISIONS}
								value={String(vs.gridSubdivisions)}
								data-testid="grid-settings-subdivisions"
								className="h-7.5 w-20"
								onChange={(e) => {
									const next = clampInt(
										e.currentTarget.value,
										MIN_SUBDIVISIONS,
										MAX_SUBDIVISIONS,
									);
									if (next !== null) vs.setGridSubdivisions(next);
								}}
							/>
						</label>
					</div>
					<div className="flex items-center gap-4">
						<label className="flex items-center gap-2 text-xs text-muted-foreground">
							{t("canvas.grid.color", "Grid color")}
							<input
								type="color"
								value={vs.gridColor}
								data-testid="grid-settings-color"
								className="h-7 w-10 cursor-pointer rounded border border-input bg-transparent"
								onChange={(e) => vs.setGridColor(e.currentTarget.value)}
							/>
						</label>
						<label className="flex items-center gap-2 text-xs text-muted-foreground">
							{t("canvas.grid.subColor", "Sub-grid color")}
							<input
								type="color"
								value={vs.subGridColor}
								data-testid="grid-settings-sub-color"
								className="h-7 w-10 cursor-pointer rounded border border-input bg-transparent"
								onChange={(e) => vs.setSubGridColor(e.currentTarget.value)}
							/>
						</label>
					</div>
					<label className="flex items-center gap-2 text-xs text-muted-foreground">
						<input
							type="checkbox"
							checked={vs.snapToGridEnabled}
							data-testid="grid-settings-snap-grid"
							className="h-3.5 w-3.5 cursor-pointer accent-primary"
							onChange={(e) => vs.setSnapToGridEnabled(e.currentTarget.checked)}
						/>
						{t("canvas.grid.snapToGrid", "Snap to grid")}
					</label>
					<label className="flex items-center gap-2 text-xs text-muted-foreground">
						<input
							type="checkbox"
							checked={vs.snapToObjectsEnabled}
							data-testid="grid-settings-snap-objects"
							className="h-3.5 w-3.5 cursor-pointer accent-primary"
							onChange={(e) =>
								vs.setSnapToObjectsEnabled(e.currentTarget.checked)
							}
						/>
						{t("canvas.grid.snapToObjects", "Snap to objects")}
					</label>
					<label className="flex items-center gap-1 text-xs text-muted-foreground">
						{t("canvas.grid.snapThreshold", "Snap threshold")}
						<Input
							type="number"
							min={MIN_SNAP_THRESHOLD}
							max={MAX_SNAP_THRESHOLD}
							value={String(vs.snapThreshold)}
							data-testid="grid-settings-snap-threshold"
							className="h-7.5 w-20"
							onChange={(e) => {
								const next = clampInt(
									e.currentTarget.value,
									MIN_SNAP_THRESHOLD,
									MAX_SNAP_THRESHOLD,
								);
								if (next !== null) vs.setSnapThreshold(next);
							}}
						/>
					</label>
				</div>
				<DialogFooter>
					<Button
						type="button"
						data-testid="grid-settings-close"
						onClick={onClose}
					>
						{t("canvas.dialog.close", "Close")}
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
