"use client";

import { type CanvasNode, findNode } from "@anvilkit/canvas-core";
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
	const selectedIds = useSyncExternalStore(
		ctx.selectionStore.subscribe,
		() => ctx.selectionStore.getState().selectedIds,
		() => ctx.selectionStore.getState().selectedIds,
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
			{ctx.continuousCreation === true ? (
				<span
					data-testid="workspace-continuous-indicator"
					className="mr-auto rounded-full bg-accent px-2 py-0.5 text-[11px] text-accent-foreground"
				>
					{t("canvas.footer.continuousCreation", "Continuous creation")}
				</span>
			) : null}
			<SelectionSummary selectedIds={selectedIds} />
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

/**
 * B-13 footer selection summary (FR-131): count, combined AABB
 * (transform+bounds, rotation ignored — same convention as
 * `zoomToSelectionImpl`), and locked/hidden counts. Hidden when nothing is
 * selected.
 */
function SelectionSummary({
	selectedIds,
}: {
	selectedIds: readonly string[];
}): React.JSX.Element | null {
	const ctx = useCanvasStudio();
	const t = useCanvasT();
	if (selectedIds.length === 0) return null;
	const nodes = selectedIds
		.map((id) => findNode(ctx.ir, id)?.node)
		.filter((n): n is CanvasNode => Boolean(n));
	if (nodes.length === 0) return null;
	let minX = Number.POSITIVE_INFINITY;
	let minY = Number.POSITIVE_INFINITY;
	let maxX = Number.NEGATIVE_INFINITY;
	let maxY = Number.NEGATIVE_INFINITY;
	let locked = 0;
	let hidden = 0;
	for (const n of nodes) {
		minX = Math.min(minX, n.transform.x);
		minY = Math.min(minY, n.transform.y);
		maxX = Math.max(maxX, n.transform.x + n.bounds.width);
		maxY = Math.max(maxY, n.transform.y + n.bounds.height);
		if (n.locked) locked += 1;
		if (n.visible === false) hidden += 1;
	}
	const fmt = (v: number): string => String(Math.round(v));
	return (
		<span
			data-testid="workspace-selection-summary"
			className="mr-auto flex items-center gap-2 text-muted-foreground"
		>
			<span data-testid="selection-summary-count">
				{t("canvas.footer.selectionCount", "{n} selected").replace(
					"{n}",
					String(nodes.length),
				)}
			</span>
			<span
				data-testid="selection-summary-bbox"
				className="font-mono tabular-nums"
			>
				{`${fmt(minX)}, ${fmt(minY)} · ${fmt(maxX - minX)}×${fmt(maxY - minY)}`}
			</span>
			{locked > 0 ? (
				<span data-testid="selection-summary-locked">
					{t("canvas.footer.selectionLocked", "{n} locked").replace(
						"{n}",
						String(locked),
					)}
				</span>
			) : null}
			{hidden > 0 ? (
				<span data-testid="selection-summary-hidden">
					{t("canvas.footer.selectionHidden", "{n} hidden").replace(
						"{n}",
						String(hidden),
					)}
				</span>
			) : null}
		</span>
	);
}
