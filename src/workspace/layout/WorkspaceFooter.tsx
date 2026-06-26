"use client";

import { Button } from "@anvilkit/ui/button";
import { cn } from "@anvilkit/ui/lib/utils";
import { Separator } from "@anvilkit/ui/separator";
import { useSyncExternalStore } from "react";
import { ChromeIcons } from "@/chrome/icons.js";
import {
	useCanvasStudio,
	useCanvasT,
} from "@/context/canvas-studio-context.js";

const ZOOM_MIN = 0.1;
const ZOOM_MAX = 4;
const ZOOM_STEP = 0.1;

const clampZoom = (z: number): number =>
	Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, Math.round(z * 100) / 100));

export interface WorkspaceFooterProps {
	className?: string;
}

/**
 * Full-width bottom footer (Canva style): a zoom slider with ± steppers and a
 * percentage readout, then the page indicator. Bound to `viewportStore.zoom`
 * and `pagesStore`.
 */
export function WorkspaceFooter({
	className,
}: WorkspaceFooterProps): React.JSX.Element {
	const ctx = useCanvasStudio();
	const t = useCanvasT();
	const zoom = useSyncExternalStore(
		ctx.viewportStore.subscribe,
		() => ctx.viewportStore.getState().zoom,
		() => ctx.viewportStore.getState().zoom,
	);
	const activePageId = useSyncExternalStore(
		ctx.pagesStore.subscribe,
		() => ctx.pagesStore.getState().activePageId,
		() => ctx.pagesStore.getState().activePageId,
	);

	const pages = ctx.ir.pages;
	const pageIndex = pages.findIndex((p) => p.id === activePageId);
	const percent = Math.round(zoom * 100);
	const setZoom = (z: number) =>
		ctx.viewportStore.getState().setZoom(clampZoom(z));

	return (
		<footer
			data-testid="workspace-footer"
			className={cn(
				"flex h-9 shrink-0 items-center justify-end gap-3 border-t border-border bg-card px-3 text-xs",
				className,
			)}
		>
			<div data-testid="workspace-zoom" className="flex items-center gap-2">
				<Button
					type="button"
					variant="ghost"
					size="icon-xs"
					data-testid="workspace-zoom-out"
					aria-label={t("canvas.footer.zoomOut", "Zoom out")}
					title={t("canvas.footer.zoomOut", "Zoom out")}
					disabled={zoom <= ZOOM_MIN}
					onClick={() => setZoom(zoom - ZOOM_STEP)}
				>
					<ChromeIcons.zoomOut aria-hidden />
				</Button>
				<input
					type="range"
					aria-label={t("canvas.footer.zoom", "Zoom")}
					data-testid="workspace-zoom-slider"
					min={Math.round(ZOOM_MIN * 100)}
					max={Math.round(ZOOM_MAX * 100)}
					step={1}
					value={percent}
					onChange={(e) => setZoom(Number(e.currentTarget.value) / 100)}
					className="h-1 w-28 cursor-pointer accent-primary"
				/>
				<Button
					type="button"
					variant="ghost"
					size="icon-xs"
					data-testid="workspace-zoom-in"
					aria-label={t("canvas.footer.zoomIn", "Zoom in")}
					title={t("canvas.footer.zoomIn", "Zoom in")}
					disabled={zoom >= ZOOM_MAX}
					onClick={() => setZoom(zoom + ZOOM_STEP)}
				>
					<ChromeIcons.zoomIn aria-hidden />
				</Button>
				<span className="min-w-9 text-center font-mono text-foreground tabular-nums">
					{percent}%
				</span>
			</div>
			<Separator
				orientation="vertical"
				className="h-4 data-vertical:self-center"
			/>
			<span
				data-testid="workspace-page-count"
				className="text-muted-foreground"
			>
				{t("canvas.footer.pageIndicator", "Page {n} / {total}")
					.replace("{n}", String(pageIndex >= 0 ? pageIndex + 1 : 1))
					.replace("{total}", String(pages.length))}
			</span>
		</footer>
	);
}
