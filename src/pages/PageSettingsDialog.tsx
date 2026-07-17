"use client";

import type {
	CanvasCommand,
	CanvasPage,
	CanvasPageResizeMode,
} from "@anvilkit/canvas-core";
import { Button } from "@anvilkit/ui/button";
import {
	Dialog,
	DialogContent,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@anvilkit/ui/dialog";
import { Input } from "@anvilkit/ui/input";
import { useState } from "react";
import {
	useCanvasStudio,
	useCanvasT,
} from "../context/canvas-studio-context.js";
import { SizePresetPicker } from "./SizePresetPicker.js";

export interface PageSettingsDialogProps {
	page: CanvasPage;
	onClose: () => void;
}

const RESIZE_MODES: readonly CanvasPageResizeMode[] = [
	"canvas-only",
	"scale-content",
	"recenter",
];

const MODE_LABELS: Record<CanvasPageResizeMode, [string, string]> = {
	"canvas-only": ["canvas.pageSettings.canvasOnly", "Canvas only"],
	"scale-content": ["canvas.pageSettings.scaleContent", "Scale content"],
	recenter: ["canvas.pageSettings.recenter", "Recenter content"],
};

/**
 * FR-063 page settings (B-11): width/height (px — unit/DPI stay export-side
 * per OD-1), orientation swap, solid background color, and the FR-063 resize
 * modes, applied as ONE undo entry (`page.resize` + `page.set-background`).
 * Code-split via its lazy trigger like every dialog (constraint 20.15).
 */
export default function PageSettingsDialog({
	page,
	onClose,
}: PageSettingsDialogProps): React.JSX.Element {
	const ctx = useCanvasStudio();
	const t = useCanvasT();
	const [width, setWidth] = useState(String(page.size.width));
	const [height, setHeight] = useState(String(page.size.height));
	const [mode, setMode] = useState<CanvasPageResizeMode>("canvas-only");
	const [background, setBackground] = useState(
		page.background.kind === "solid" ? page.background.value : "#ffffff",
	);

	const apply = (): void => {
		const w = Math.max(1, Math.round(Number(width) || page.size.width));
		const h = Math.max(1, Math.round(Number(height) || page.size.height));
		const cmds: CanvasCommand[] = [];
		if (w !== page.size.width || h !== page.size.height) {
			cmds.push({
				type: "page.resize",
				pageId: page.id,
				from: { width: page.size.width, height: page.size.height },
				to: { width: w, height: h },
				mode,
			});
		}
		if (
			page.background.kind !== "solid" ||
			page.background.value !== background
		) {
			cmds.push({
				type: "page.set-background",
				pageId: page.id,
				from: page.background,
				to: { kind: "solid", value: background },
			});
		}
		const first = cmds[0];
		if (cmds.length === 1 && first) ctx.commit(first);
		else if (cmds.length > 1) ctx.commitBatch(cmds, "Page settings");
		onClose();
	};

	return (
		<Dialog open onOpenChange={(open) => !open && onClose()}>
			<DialogContent data-testid="page-settings-dialog">
				<DialogHeader>
					<DialogTitle>
						{t("canvas.pageSettings.title", "Page settings")}
					</DialogTitle>
				</DialogHeader>
				<div className="flex flex-col gap-3 text-sm">
					<div className="flex items-center gap-2">
						<label className="flex items-center gap-1 text-xs text-muted-foreground">
							{t("canvas.inspector.width", "Width")}
							<Input
								type="number"
								min={1}
								value={width}
								data-testid="page-settings-width"
								className="h-7.5 w-20"
								onChange={(e) => setWidth(e.currentTarget.value)}
							/>
						</label>
						<label className="flex items-center gap-1 text-xs text-muted-foreground">
							{t("canvas.inspector.height", "Height")}
							<Input
								type="number"
								min={1}
								value={height}
								data-testid="page-settings-height"
								className="h-7.5 w-20"
								onChange={(e) => setHeight(e.currentTarget.value)}
							/>
						</label>
						<Button
							type="button"
							size="sm"
							variant="outline"
							data-testid="page-settings-orientation"
							onClick={() => {
								setWidth(height);
								setHeight(width);
							}}
						>
							{t("canvas.pageSettings.swap", "Swap")}
						</Button>
					</div>
					<div className="flex items-center gap-2">
						<span className="text-xs text-muted-foreground">
							{t("canvas.pageSettings.resizeMode", "Content")}
						</span>
						{RESIZE_MODES.map((m) => (
							<Button
								key={m}
								type="button"
								size="sm"
								variant={mode === m ? "default" : "outline"}
								data-testid={`page-settings-mode-${m}`}
								onClick={() => setMode(m)}
							>
								{t(...MODE_LABELS[m])}
							</Button>
						))}
					</div>
					<label className="flex items-center gap-2 text-xs text-muted-foreground">
						{t("canvas.pageSettings.background", "Background")}
						<input
							type="color"
							value={background}
							data-testid="page-settings-background"
							className="h-7 w-10 cursor-pointer rounded border border-input bg-transparent"
							onChange={(e) => setBackground(e.currentTarget.value)}
						/>
					</label>
					<div className="max-h-48 overflow-y-auto rounded border border-border">
						<SizePresetPicker
							onSelect={(preset) => {
								setWidth(String(preset.width));
								setHeight(String(preset.height));
							}}
						/>
					</div>
				</div>
				<DialogFooter>
					<Button
						type="button"
						variant="outline"
						data-testid="page-settings-cancel"
						onClick={onClose}
					>
						{t("canvas.dialog.cancel", "Cancel")}
					</Button>
					<Button
						type="button"
						data-testid="page-settings-apply"
						onClick={apply}
					>
						{t("canvas.pageSettings.apply", "Apply")}
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
