"use client";

import type { CanvasPage } from "@anvilkit/canvas-core";
import { Button } from "@anvilkit/ui/button";
import { cn } from "@anvilkit/ui/lib/utils";
import { ChevronDown, ChevronUp, Copy, Plus, Trash2 } from "lucide-react";
import {
	type ReactNode,
	useLayoutEffect,
	useRef,
	useSyncExternalStore,
} from "react";
import { useCanvasStudio } from "../../context/canvas-studio-context.js";
import {
	addPage,
	deletePage,
	duplicateCurrentPage,
	reorderPage,
	switchToPage,
} from "../../pages/page-actions.js";
import { usePageThumbnails } from "../../perf/page-thumbnails.js";
import { type ElementActions, ElementControls } from "./ElementControls.js";

/** Padding (px) reserved inside the scroll viewport for the fit calculation. */
const FIT_PAD_X = 56; // px-7 both sides
const FIT_PAD_Y = 120; // pt-16 + pb-14
const FIT_MARGIN = 0.96; // breathing room around the fitted page
const ZOOM_MIN = 0.1;
const ZOOM_MAX = 4;

export interface PagesCanvasProps {
	/**
	 * The live, interactive Konva stage for the **active** page, supplied by
	 * `CanvasStudio.renderShell`. Slotted in document order; every other page
	 * renders as a cached, non-interactive thumbnail.
	 */
	stage: ReactNode;
	elementActions?: ElementActions;
}

/**
 * Canva-style vertical multi-page view. Owns the scrollable canvas viewport on
 * the neutral-gray surface: the active page is the live editable Konva stage; the rest
 * are cached rasterized thumbnails (`usePageThumbnails`). Clicking a thumbnail
 * activates that page. On entry the active page is zoomed to fit the visible
 * area; all pages share the viewport `zoom`, so the footer slider scales the
 * whole canvas uniformly.
 */
export function PagesCanvas({
	stage,
	elementActions,
}: PagesCanvasProps): React.JSX.Element {
	const ctx = useCanvasStudio();
	const scrollRef = useRef<HTMLDivElement>(null);
	const fittedRef = useRef(false);
	const activePageId = useSyncExternalStore(
		ctx.pagesStore.subscribe,
		() => ctx.pagesStore.getState().activePageId,
		() => ctx.pagesStore.getState().activePageId,
	);
	const zoom = useSyncExternalStore(
		ctx.viewportStore.subscribe,
		() => ctx.viewportStore.getState().zoom,
		() => ctx.viewportStore.getState().zoom,
	);
	const pages = ctx.ir.pages;
	const thumbnails = usePageThumbnails({
		pages,
		activePageId,
		assets: ctx.ir.assets,
	});
	const addWidth = (pages[0]?.size.width ?? 0) * zoom;

	// Zoom the active page to fit the visible area, once, on entry. Runs again
	// only until it succeeds (the viewport may not be measured on first paint).
	useLayoutEffect(() => {
		if (fittedRef.current) return;
		const el = scrollRef.current;
		if (!el) return;
		const fit = (): boolean => {
			if (fittedRef.current) return false;
			const page = ctx.ir.pages.find(
				(p) => p.id === ctx.pagesStore.getState().activePageId,
			);
			if (!page) return false;
			const availW = el.clientWidth - FIT_PAD_X;
			const availH = el.clientHeight - FIT_PAD_Y;
			if (availW <= 0 || availH <= 0) return false;
			const raw =
				Math.min(availW / page.size.width, availH / page.size.height) *
				FIT_MARGIN;
			const z = Math.min(
				ZOOM_MAX,
				Math.max(ZOOM_MIN, Math.round(raw * 100) / 100),
			);
			ctx.viewportStore.getState().setZoom(z);
			fittedRef.current = true;
			return true;
		};
		if (fit()) return;
		if (typeof ResizeObserver !== "function") return;
		const ro = new ResizeObserver(() => {
			if (fit()) ro.disconnect();
		});
		ro.observe(el);
		return () => ro.disconnect();
	}, [ctx]);

	return (
    <div
      ref={scrollRef}
      data-testid="pages-canvas"
      className="min-h-0 flex-1 overflow-auto px-7 pt-16 pb-14 dark:bg-neutral-800 bg-neutral-50"
    >
      <div className="flex flex-col items-center gap-8 pb-8">
        {pages.map((page, index) => (
          <PageRow
            key={page.id}
            page={page}
            index={index}
            total={pages.length}
            zoom={zoom}
            isActive={page.id === activePageId}
            stage={stage}
            elementActions={elementActions}
            thumbnail={thumbnails.get(page.id)}
          />
        ))}
        <AddPageButton width={addWidth} />
      </div>
    </div>
  );
}

interface PageRowProps {
	page: CanvasPage;
	index: number;
	total: number;
	zoom: number;
	isActive: boolean;
	stage: ReactNode;
	elementActions?: ElementActions;
	thumbnail: string | undefined;
}

/** Ghost icon button base color for the (theme-adaptive) canvas surface. */
const SURFACE_GHOST = "text-muted-foreground";

function PageRow({
	page,
	index,
	total,
	zoom,
	isActive,
	stage,
	elementActions,
	thumbnail,
}: PageRowProps): React.JSX.Element {
	const ctx = useCanvasStudio();
	const width = page.size.width * zoom;
	const height = page.size.height * zoom;
	const label = page.name
		? `Page ${index + 1} · ${page.name}`
		: `Page ${index + 1}`;

	return (
		<div
			data-testid={`page-row-${page.id}`}
			data-active={isActive ? "true" : "false"}
			className="flex flex-col gap-1.5"
			style={{ width }}
		>
			<div className="flex h-7 items-center gap-0.5">
				<span className="mr-auto truncate text-xs font-medium text-muted-foreground">
					{label}
				</span>
				<Button
					type="button"
					variant="ghost"
					size="icon-xs"
					className={SURFACE_GHOST}
					data-testid={`page-reorder-up-${page.id}`}
					aria-label="Move page up"
					title="Move up"
					disabled={index === 0}
					onClick={() => reorderPage(ctx, page.id, index - 1)}
				>
					<ChevronUp aria-hidden />
				</Button>
				<Button
					type="button"
					variant="ghost"
					size="icon-xs"
					className={SURFACE_GHOST}
					data-testid={`page-reorder-down-${page.id}`}
					aria-label="Move page down"
					title="Move down"
					disabled={index === total - 1}
					onClick={() => reorderPage(ctx, page.id, index + 1)}
				>
					<ChevronDown aria-hidden />
				</Button>
				<Button
					type="button"
					variant="ghost"
					size="icon-xs"
					className={SURFACE_GHOST}
					data-testid={`page-duplicate-${page.id}`}
					aria-label="Duplicate page"
					title="Duplicate"
					onClick={() => {
						switchToPage(ctx, page.id);
						duplicateCurrentPage(ctx);
					}}
				>
					<Copy aria-hidden />
				</Button>
				<Button
					type="button"
					variant="ghost"
					size="icon-xs"
					className={SURFACE_GHOST}
					data-testid={`page-delete-${page.id}`}
					aria-label="Delete page"
					title="Delete"
					disabled={total <= 1}
					onClick={() => deletePage(ctx, page.id)}
				>
					<Trash2 aria-hidden />
				</Button>
			</div>

			{isActive ? (
				// Outer wrapper stays unclipped so the floating controls can overhang
				// the page; the inner frame is the active-page card.
				<div className="relative mx-auto w-fit">
					<ElementControls actions={elementActions} />
					<div className="overflow-hidden rounded-[3px] bg-background ring-2 ring-violet-500/80 shadow-[0_6px_24px_-6px_rgba(0,0,0,0.3)]">
						{stage}
					</div>
				</div>
			) : (
				<button
					type="button"
					data-testid={`page-activate-${page.id}`}
					aria-label={`Activate ${label}`}
					onClick={() => switchToPage(ctx, page.id)}
					className={cn(
						"block overflow-hidden rounded-[3px] bg-background shadow-[0_4px_20px_-6px_rgba(0,0,0,0.3)] ring-1 ring-foreground/15 transition hover:ring-2 hover:ring-violet-500/60",
					)}
					style={{ width, height }}
				>
					{thumbnail ? (
						<img
							src={thumbnail}
							alt=""
							draggable={false}
							className="block size-full object-contain"
						/>
					) : null}
				</button>
			)}
		</div>
	);
}

function AddPageButton({ width }: { width: number }): React.JSX.Element {
	const ctx = useCanvasStudio();
	return (
		<button
			type="button"
			data-testid="page-add"
			aria-label="Add page"
			onClick={() => addPage(ctx)}
			className="flex h-12 items-center justify-center gap-2 rounded-lg border border-dashed border-foreground/20 text-sm font-medium text-muted-foreground transition hover:bg-muted hover:text-foreground"
			style={width > 0 ? { width } : undefined}
		>
			<Plus className="size-4" aria-hidden />
			Add page
		</button>
	);
}
