"use client";

import type { CanvasPage } from "@anvilkit/canvas-core";
import { Button } from "@anvilkit/ui/button";
import {
	ContextMenu,
	ContextMenuContent,
	ContextMenuItem,
	ContextMenuSeparator,
	ContextMenuTrigger,
} from "@anvilkit/ui/context-menu";
import { Input } from "@anvilkit/ui/input";
import { cn } from "@anvilkit/ui/lib/utils";
import { ChevronDown, ChevronUp, Copy, Plus, Trash2 } from "lucide-react";
import {
	lazy,
	type ReactNode,
	Suspense,
	useEffect,
	useLayoutEffect,
	useRef,
	useState,
	useSyncExternalStore,
} from "react";
import { computeWheelZoom } from "@/actions/viewport-actions.js";
import {
	useCanvasStudio,
	useCanvasT,
} from "@/context/canvas-studio-context.js";
import { useCanvasDialogs } from "@/context/dialog-context.js";
import {
	addPage,
	deletePage,
	duplicateCurrentPage,
	renamePage,
	reorderPage,
	switchToPage,
} from "@/pages/page-actions.js";
import { usePageThumbnails } from "@/perf/page-thumbnails.js";
import { CanvasRulers } from "./CanvasRulers.js";
import { type ElementActions, ElementControls } from "./ElementControls.js";

/** Dialog-class UI is code-split (PRD 0012 constraint 20.15). */
const PageSettingsDialog = lazy(
	() => import("../dialogs/PageSettingsDialog.js"),
);

/** Drag payload type for page-row reordering (kept off `Files` so the
 * upload `CanvasDropZone` never reacts to page drags). */
const PAGE_DRAG_MIME = "application/x-anvilkit-canvas-page";

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

	// Mirror the canvas viewport size into the viewport store so DOM-free
	// zoom-to-fit / zoom-to-selection actions can compute (A-07).
	useLayoutEffect(() => {
		const el = scrollRef.current;
		if (!el) return;
		const update = (): void => {
			ctx.viewportStore
				.getState()
				.setViewportSize({ width: el.clientWidth, height: el.clientHeight });
		};
		update();
		if (typeof ResizeObserver !== "function") return;
		const ro = new ResizeObserver(update);
		ro.observe(el);
		return () => ro.disconnect();
	}, [ctx]);

	// Ctrl/Cmd + wheel (and trackpad pinch, which browsers deliver as
	// ctrl+wheel) zooms AT THE CURSOR: the scroll offsets are re-derived so the
	// point under the pointer stays fixed. Plain wheel keeps native scrolling
	// (pan). Store-only — zoom never enters history (FR-043/§13.1).
	useEffect(() => {
		const el = scrollRef.current;
		if (!el) return;
		const onWheel = (e: WheelEvent): void => {
			if (!(e.ctrlKey || e.metaKey)) return;
			e.preventDefault();
			const viewport = ctx.viewportStore.getState();
			const next = computeWheelZoom(viewport.zoom, e.deltaY);
			if (next === viewport.zoom) return;
			const rect = el.getBoundingClientRect();
			const cx = e.clientX - rect.left;
			const cy = e.clientY - rect.top;
			const scale = next / viewport.zoom;
			const scrollLeft = (el.scrollLeft + cx) * scale - cx;
			const scrollTop = (el.scrollTop + cy) * scale - cy;
			viewport.setZoom(next);
			el.scrollLeft = scrollLeft;
			el.scrollTop = scrollTop;
		};
		el.addEventListener("wheel", onWheel, { passive: false });
		return () => el.removeEventListener("wheel", onWheel);
	}, [ctx]);

	return (
		// Relative wrapper so the rulers (C-02) can overlay the scroll viewport's
		// top/left edges without joining the scroll flow.
		<div className="relative flex min-h-0 flex-1 flex-col">
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
			<CanvasRulers scrollRef={scrollRef} />
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
	const t = useCanvasT();
	const dialogs = useCanvasDialogs();
	const [settingsOpen, setSettingsOpen] = useState(false);
	const [renaming, setRenaming] = useState(false);
	const [dropTarget, setDropTarget] = useState(false);
	const confirmDelete = (): void => {
		void dialogs
			.confirm({
				title: t("canvas.pages.deleteConfirmTitle", "Delete this page?"),
				description: t(
					"canvas.pages.deleteConfirmBody",
					"The page and everything on it will be removed. This can be undone.",
				),
				confirmLabel: t("canvas.pages.deleteTitle", "Delete"),
				destructive: true,
			})
			.then((ok) => {
				if (ok) deletePage(ctx, page.id);
			});
	};
	const width = page.size.width * zoom;
	const height = page.size.height * zoom;
	const label = page.name
		? t("canvas.pages.pageLabelNamed", "Page {n} · {name}")
				.replace("{n}", String(index + 1))
				.replace("{name}", page.name)
		: t("canvas.pages.pageLabel", "Page {n}").replace("{n}", String(index + 1));

	return (
		<div
			data-testid={`page-row-${page.id}`}
			data-active={isActive ? "true" : "false"}
			data-drop-target={dropTarget ? "true" : undefined}
			style={{ width }}
			className={cn(dropTarget && "rounded-sm ring-2 ring-violet-500/60")}
			onDragOver={(e) => {
				if (!e.dataTransfer.types.includes(PAGE_DRAG_MIME)) return;
				e.preventDefault();
				e.stopPropagation();
				e.dataTransfer.dropEffect = "move";
				setDropTarget(true);
			}}
			onDragLeave={() => setDropTarget(false)}
			onDrop={(e) => {
				if (!e.dataTransfer.types.includes(PAGE_DRAG_MIME)) return;
				e.preventDefault();
				e.stopPropagation();
				setDropTarget(false);
				const draggedId = e.dataTransfer.getData(PAGE_DRAG_MIME);
				if (draggedId && draggedId !== page.id) {
					reorderPage(ctx, draggedId, index);
				}
			}}
		>
			<ContextMenu>
				<ContextMenuContent data-testid={`page-menu-${page.id}`}>
					<ContextMenuItem
						data-testid={`page-menu-duplicate-${page.id}`}
						onClick={() => {
							switchToPage(ctx, page.id);
							duplicateCurrentPage(ctx);
						}}
					>
						{t("canvas.pages.duplicate", "Duplicate page")}
					</ContextMenuItem>
					<ContextMenuItem
						data-testid={`page-menu-rename-${page.id}`}
						onClick={() => {
							// Defer past the menu's focus-return: closing the menu focuses
							// the trigger, which would instantly blur the autofocused rename
							// input and end the rename before it starts.
							setTimeout(() => setRenaming(true), 0);
						}}
					>
						{t("canvas.pages.rename", "Rename page")}
					</ContextMenuItem>
					<ContextMenuItem
						data-testid={`page-menu-settings-${page.id}`}
						onClick={() => setSettingsOpen(true)}
					>
						{t("canvas.pageSettings.title", "Page settings")}
					</ContextMenuItem>
					<ContextMenuItem
						data-testid={`page-menu-move-up-${page.id}`}
						disabled={index === 0}
						onClick={() => reorderPage(ctx, page.id, index - 1)}
					>
						{t("canvas.pages.moveUp", "Move page up")}
					</ContextMenuItem>
					<ContextMenuItem
						data-testid={`page-menu-move-down-${page.id}`}
						disabled={index === total - 1}
						onClick={() => reorderPage(ctx, page.id, index + 1)}
					>
						{t("canvas.pages.moveDown", "Move page down")}
					</ContextMenuItem>
					<ContextMenuSeparator />
					<ContextMenuItem
						data-testid={`page-menu-delete-${page.id}`}
						variant="destructive"
						disabled={total <= 1}
						onClick={confirmDelete}
					>
						{t("canvas.pages.delete", "Delete page")}
					</ContextMenuItem>
				</ContextMenuContent>
				<ContextMenuTrigger className="flex flex-col gap-1.5">
					<div
						className="flex h-7 items-center gap-0.5"
						draggable={!renaming}
						onDragStart={(e) => {
							e.dataTransfer.setData(PAGE_DRAG_MIME, page.id);
							e.dataTransfer.effectAllowed = "move";
						}}
					>
						{renaming ? (
							<Input
								autoFocus
								defaultValue={page.name ?? ""}
								data-testid={`page-rename-input-${page.id}`}
								aria-label={t("canvas.pages.rename", "Rename page")}
								className="mr-auto h-6 w-36 px-1 text-xs"
								onBlur={(e) => {
									const next = e.currentTarget.value.trim() || undefined;
									if (next !== page.name) renamePage(ctx, page.id, next);
									setRenaming(false);
								}}
								onKeyDown={(e) => {
									e.stopPropagation();
									if (e.key === "Enter") e.currentTarget.blur();
									else if (e.key === "Escape") setRenaming(false);
								}}
							/>
						) : (
							<span
								className="mr-auto truncate text-xs font-medium text-muted-foreground"
								data-testid={`page-label-${page.id}`}
								onDoubleClick={() => setRenaming(true)}
							>
								{label}
							</span>
						)}
						<Button
							type="button"
							variant="ghost"
							size="icon-xs"
							className={SURFACE_GHOST}
							data-testid={`page-reorder-up-${page.id}`}
							aria-label={t("canvas.pages.moveUp", "Move page up")}
							title={t("canvas.pages.moveUpTitle", "Move up")}
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
							aria-label={t("canvas.pages.moveDown", "Move page down")}
							title={t("canvas.pages.moveDownTitle", "Move down")}
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
							aria-label={t("canvas.pages.duplicate", "Duplicate page")}
							title={t("canvas.pages.duplicateTitle", "Duplicate")}
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
							aria-label={t("canvas.pages.delete", "Delete page")}
							title={t("canvas.pages.deleteTitle", "Delete")}
							disabled={total <= 1}
							onClick={confirmDelete}
						>
							<Trash2 aria-hidden />
						</Button>
					</div>

					{isActive ? (
						// Outer wrapper stays unclipped so the floating controls can overhang
						// the page; the inner frame is the active-page card.
						<div className="relative mx-auto w-fit">
							<ElementControls actions={elementActions} />
							<div
								data-page-surface="active"
								className="overflow-hidden rounded-[3px] bg-background ring-2 ring-violet-500/80 shadow-[0_6px_24px_-6px_rgba(0,0,0,0.3)]"
							>
								{stage}
							</div>
						</div>
					) : (
						<button
							type="button"
							data-testid={`page-activate-${page.id}`}
							aria-label={t(
								"canvas.pages.activate",
								"Activate {label}",
							).replace("{label}", label)}
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
				</ContextMenuTrigger>
			</ContextMenu>
			{settingsOpen ? (
				<Suspense fallback={null}>
					<PageSettingsDialog
						page={page}
						onClose={() => setSettingsOpen(false)}
					/>
				</Suspense>
			) : null}
		</div>
	);
}
function AddPageButton({ width }: { width: number }): React.JSX.Element {
	const ctx = useCanvasStudio();
	const t = useCanvasT();
	const addPageLabel = t("canvas.pages.addPage", "Add page");
	return (
		<button
			type="button"
			data-testid="page-add"
			aria-label={addPageLabel}
			onClick={() => addPage(ctx)}
			className="flex h-12 items-center justify-center gap-2 rounded-lg border border-dashed border-foreground/20 text-sm font-medium text-muted-foreground transition hover:bg-muted hover:text-foreground"
			style={width > 0 ? { width } : undefined}
		>
			<Plus className="size-4" aria-hidden />
			{addPageLabel}
		</button>
	);
}
