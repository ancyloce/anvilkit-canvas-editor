"use client";

import { Button } from "@anvilkit/ui/button";
import { cn } from "@anvilkit/ui/lib/utils";
import { ChevronLeft, ChevronRight, Copy, Plus, Trash2 } from "lucide-react";
import {
	type KeyboardEvent as ReactKeyboardEvent,
	useCallback,
	useEffect,
	useRef,
	useState,
	useSyncExternalStore,
} from "react";
import {
	useCanvasStudio,
	useCanvasT,
} from "../context/canvas-studio-context.js";
import { usePageThumbnails } from "../perf/page-thumbnails.js";
import {
	addPage,
	deletePage,
	duplicateCurrentPage,
	renamePage,
	reorderPage,
	switchToPage,
} from "./page-actions.js";

function tabLabel(name: string | undefined, id: string): string {
	if (name && name.length > 0) return name;
	return id.length > 6 ? id.slice(0, 6) : id;
}

export interface PageNavigatorProps {
	/** Optional id for the root element — useful for hosts that want to anchor styles. */
	id?: string;
}

export function PageNavigator({
	id,
}: PageNavigatorProps): React.JSX.Element | null {
	const ctx = useCanvasStudio();
	const t = useCanvasT();
	const moveLeftLabel = t("canvas.nav.moveLeft", "Move page left");
	const moveRightLabel = t("canvas.nav.moveRight", "Move page right");
	const addPageLabel = t("canvas.nav.addPage", "Add page");
	const duplicatePageLabel = t("canvas.nav.duplicatePage", "Duplicate page");
	const deletePageLabel = t("canvas.nav.deletePage", "Delete page");
	const activePageId = useSyncExternalStore(
		ctx.pagesStore.subscribe,
		() => ctx.pagesStore.getState().activePageId,
		() => ctx.pagesStore.getState().activePageId,
	);
	const pages = ctx.ir.pages;
	// I2-5 off-screen tiling: cached bitmap previews of non-active pages.
	const thumbnails = usePageThumbnails({
		pages,
		activePageId,
		assets: ctx.ir.assets,
	});

	const [renamingPageId, setRenamingPageId] = useState<string | null>(null);
	const [renamingValue, setRenamingValue] = useState("");
	const renameInputRef = useRef<HTMLInputElement | null>(null);

	useEffect(() => {
		if (renamingPageId !== null) renameInputRef.current?.focus();
	}, [renamingPageId]);

	// Bail out of rename mode if the page being renamed disappears (e.g. it was
	// deleted by another action). Otherwise the input would commit a name onto
	// a stale id. Adjusted during render (guarded, so it can't loop) rather than
	// in an effect, so the input unmounts in the same pass instead of one render
	// later: https://react.dev/learn/you-might-not-need-an-effect
	if (renamingPageId !== null && !pages.some((p) => p.id === renamingPageId)) {
		setRenamingPageId(null);
		setRenamingValue("");
	}

	const commitRename = useCallback(() => {
		if (renamingPageId === null) return;
		renamePage(ctx, renamingPageId, renamingValue.trim());
		setRenamingPageId(null);
		setRenamingValue("");
	}, [ctx, renamingPageId, renamingValue]);

	const cancelRename = useCallback(() => {
		setRenamingPageId(null);
		setRenamingValue("");
	}, []);

	const onRenameKeyDown = useCallback(
		(e: ReactKeyboardEvent<HTMLInputElement>) => {
			if (e.key === "Enter") {
				e.preventDefault();
				commitRename();
			} else if (e.key === "Escape") {
				e.preventDefault();
				cancelRename();
			}
		},
		[commitRename, cancelRename],
	);

	if (pages.length === 0) return null;
	const deleteDisabled = pages.length <= 1;
	const activeIndex = pages.findIndex((p) => p.id === activePageId);
	const reorderLeftDisabled = activeIndex <= 0;
	const reorderRightDisabled =
		activeIndex < 0 || activeIndex >= pages.length - 1;

	return (
		<div
			data-testid="page-navigator"
			className="flex h-10 items-center gap-1.5 border-b border-border bg-card px-2 select-none"
			{...(id !== undefined ? { id } : {})}
		>
			<div
				role="tablist"
				aria-label={t("canvas.nav.artboards", "Artboards")}
				data-testid="page-tablist"
				className="inline-flex items-center gap-1.5 overflow-x-auto"
			>
				{pages.map((p) => {
					const isActive = p.id === activePageId;
					const isRenaming = p.id === renamingPageId;
					if (isRenaming) {
						return (
							<input
								key={p.id}
								ref={renameInputRef}
								type="text"
								data-page-id={p.id}
								data-testid={`page-rename-input-${p.id}`}
								className="h-6 min-w-20 rounded-md border border-ring bg-background px-2 text-xs text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
								value={renamingValue}
								onChange={(e) => setRenamingValue(e.target.value)}
								onKeyDown={onRenameKeyDown}
								onBlur={commitRename}
								aria-label={t(
									"canvas.nav.renamePage",
									"Rename page {label}",
								).replace("{label}", tabLabel(p.name, p.id))}
							/>
						);
					}
					return (
						<button
							type="button"
							key={p.id}
							role="tab"
							aria-selected={isActive}
							data-page-id={p.id}
							data-active={isActive ? "true" : "false"}
							data-testid={`page-tab-${p.id}`}
							className={cn(
								"inline-flex h-6 items-center gap-1.5 rounded-md border px-2 text-xs whitespace-nowrap transition-colors",
								isActive
									? "border-primary bg-primary/10 text-foreground ring-1 ring-primary"
									: "border-border text-muted-foreground hover:bg-muted hover:text-foreground",
							)}
							onClick={() => switchToPage(ctx, p.id)}
							onDoubleClick={() => {
								setRenamingPageId(p.id);
								setRenamingValue(p.name ?? "");
							}}
						>
							{thumbnails.has(p.id) ? (
								<img
									src={thumbnails.get(p.id)}
									alt=""
									data-testid={`page-thumb-${p.id}`}
									className="h-4 max-w-8 rounded-xs object-contain align-middle"
								/>
							) : null}
							{tabLabel(p.name, p.id)}
						</button>
					);
				})}
			</div>
			<div className="ml-auto inline-flex items-center gap-1">
				<Button
					type="button"
					variant="ghost"
					size="icon-xs"
					data-testid="page-reorder-left"
					disabled={reorderLeftDisabled}
					onClick={() => reorderPage(ctx, activePageId, activeIndex - 1)}
					aria-label={moveLeftLabel}
					title={moveLeftLabel}
				>
					<ChevronLeft aria-hidden />
				</Button>
				<Button
					type="button"
					variant="ghost"
					size="icon-xs"
					data-testid="page-reorder-right"
					disabled={reorderRightDisabled}
					onClick={() => reorderPage(ctx, activePageId, activeIndex + 1)}
					aria-label={moveRightLabel}
					title={moveRightLabel}
				>
					<ChevronRight aria-hidden />
				</Button>
				<Button
					type="button"
					variant="ghost"
					size="icon-xs"
					data-testid="page-add"
					onClick={() => addPage(ctx)}
					aria-label={addPageLabel}
					title={addPageLabel}
				>
					<Plus aria-hidden />
				</Button>
				<Button
					type="button"
					variant="ghost"
					size="icon-xs"
					data-testid="page-duplicate"
					onClick={() => duplicateCurrentPage(ctx)}
					aria-label={duplicatePageLabel}
					title={duplicatePageLabel}
				>
					<Copy aria-hidden />
				</Button>
				<Button
					type="button"
					variant="ghost"
					size="icon-xs"
					data-testid="page-delete"
					disabled={deleteDisabled}
					onClick={() => deletePage(ctx, activePageId)}
					aria-label={deletePageLabel}
					title={
						deleteDisabled
							? t("canvas.nav.cannotDeleteOnly", "Cannot delete the only page")
							: deletePageLabel
					}
				>
					<Trash2 aria-hidden />
				</Button>
			</div>
		</div>
	);
}
