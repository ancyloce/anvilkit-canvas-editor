"use client";

import { Button } from "@anvilkit/ui/button";
import { cn } from "@anvilkit/ui/lib/utils";
import { Separator } from "@anvilkit/ui/separator";
import { useSyncExternalStore } from "react";
import { useCanvasStudio } from "../context/canvas-studio-context.js";
import { ChromeIcons } from "./icons.js";

const ZOOM_MIN = 0.1;
const ZOOM_MAX = 4;
const ZOOM_STEP = 0.1;

const clampZoom = (z: number): number =>
	Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, Math.round(z * 100) / 100));

export interface ZoomControlProps {
	className?: string;
}

/**
 * Bottom-centre zoom pill (reference `.editor-zoom`): zoom out / current % /
 * zoom in, then the active artboard index. Bound to `viewportStore.zoom`
 * (a 1.0-based multiplier) and `pagesStore` for the page indicator.
 */
export function ZoomControl({
	className,
}: ZoomControlProps): React.JSX.Element {
	const ctx = useCanvasStudio();
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
	const setZoom = (z: number) =>
		ctx.viewportStore.getState().setZoom(clampZoom(z));

	return (
		<div
			data-testid="editor-zoom"
			className={cn(
				"absolute bottom-4.5 left-1/2 flex -translate-x-1/2 items-center gap-1.5 rounded-full border border-border bg-card px-2.5 py-1.5 text-xs shadow-md",
				className,
			)}
		>
			<Button
				type="button"
				variant="ghost"
				size="icon-xs"
				data-testid="zoom-out"
				aria-label="Zoom out"
				title="Zoom out"
				disabled={zoom <= ZOOM_MIN}
				onClick={() => setZoom(zoom - ZOOM_STEP)}
			>
				<ChromeIcons.zoomOut aria-hidden />
			</Button>
			<span
				data-testid="zoom-value"
				className="min-w-9 text-center font-mono tabular-nums text-foreground"
			>
				{Math.round(zoom * 100)}%
			</span>
			<Button
				type="button"
				variant="ghost"
				size="icon-xs"
				data-testid="zoom-in"
				aria-label="Zoom in"
				title="Zoom in"
				disabled={zoom >= ZOOM_MAX}
				onClick={() => setZoom(zoom + ZOOM_STEP)}
			>
				<ChromeIcons.zoomIn aria-hidden />
			</Button>
			<Separator orientation="vertical" className="mx-0.5 h-3.5" />
			<span data-testid="zoom-page" className="text-muted-foreground">
				Page {pageIndex >= 0 ? pageIndex + 1 : 1} / {pages.length}
			</span>
		</div>
	);
}
