"use client";

import { Button } from "@anvilkit/ui/button";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from "@anvilkit/ui/dropdown-menu";
import { Input } from "@anvilkit/ui/input";
import { cn } from "@anvilkit/ui/lib/utils";
import { Separator } from "@anvilkit/ui/separator";
import { ChevronLeft, MoreHorizontal } from "lucide-react";
import {
	Fragment,
	lazy,
	type ReactNode,
	Suspense,
	useEffect,
	useRef,
	useState,
	useSyncExternalStore,
} from "react";
import { useCanvasActions } from "@/actions/editor-actions.js";
import { ChromeIcons } from "@/chrome/icons.js";
import {
	useCanvasStudio,
	useCanvasT,
} from "@/context/canvas-studio-context.js";
import { useCanvasToaster } from "@/context/toast-context.js";
// Relative (not @/) on purpose: this type surfaces in the emitted .d.ts, and
// rslib rewrites alias paths only in .js, not in declarations — an aliased
// import here would ship an unresolvable "@/" to consumers.
import type { CanvasHeaderPlugin } from "../../header/types.js";
// Relative (not @/): this type surfaces in the emitted .d.ts.
import type { CanvasShortcutOptions } from "../shortcuts/shortcut-registry.js";
import { useRestoreLayout } from "../state/hooks.js";

/** FR-042 dialog-class surface — code-split like every dialog (§20.15). */
const ShortcutHelpDialog = lazy(
	() => import("../dialogs/ShortcutHelpDialog.js"),
);
const INTEGER_DIMENSION_FORMATTER = new Intl.NumberFormat(undefined, {
	maximumFractionDigits: 0,
});
const FRACTIONAL_DIMENSION_FORMATTER = new Intl.NumberFormat(undefined, {
	maximumFractionDigits: 2,
});
const SAVE_LABELS: Record<string, [string, string]> = {
	clean: ["canvas.save.clean", "All changes saved"],
	dirty: ["canvas.save.dirty", "Unsaved changes"],
	saving: ["canvas.save.saving", "Saving…"],
	saved: ["canvas.save.saved", "Saved"],
	error: ["canvas.save.error", "Save failed — click to retry"],
	offline: ["canvas.save.offline", "Offline"],
};

/**
 * Format a page dimension for the header (§8.7): locale-grouped, integers shown
 * without decimals, fractional units (in/cm/mm) kept to two places. `Intl`
 * handles the locale separators.
 */
function formatDimension(value: number): string {
	return (
		Number.isInteger(value)
			? INTEGER_DIMENSION_FORMATTER
			: FRACTIONAL_DIMENSION_FORMATTER
	).format(value);
}

export interface WorkspaceHeaderProps {
	/** Host back action. When omitted, the Back button is hidden. */
	onBack?: () => void;
	/** Controlled document title. Defaults to `ir.title`. */
	title?: string;
	/**
	 * Commit a renamed title. When provided, the name becomes click-to-edit;
	 * when omitted the name is read-only (no `ir.title` command exists — §2).
	 */
	onTitleChange?: (next: string) => void;
	/** Collaborator avatars slot (host-rendered). */
	avatarsSlot?: ReactNode;
	/**
	 * The workspace's shortcut configuration (A-04), threaded through so the
	 * FR-042 help dialog lists host-provided entries. `false` (shortcuts
	 * disabled) hides the help menu item entirely.
	 */
	shortcuts?: boolean | CanvasShortcutOptions;
	/**
	 * Header plugins (e.g. the built-in export popover from
	 * {@link createCanvasExportPlugin}). Rendered between the avatars and the
	 * host `shareSlot`, inside the studio provider so they can use hooks.
	 */
	plugins?: readonly CanvasHeaderPlugin[];
	/** Share / Export / Publish slot (host-rendered). */
	shareSlot?: ReactNode;
	className?: string;
}

/**
 * Full-width top header: Back · undo/redo · editable name · avatars · Share.
 * Undo/redo run the standard `historyStore` → `sceneStore` wiring. The name is
 * click-to-edit only when `onTitleChange` is wired (the host owns persistence).
 */
export function WorkspaceHeader({
	onBack,
	title,
	onTitleChange,
	avatarsSlot,
	shortcuts = true,
	plugins,
	shareSlot,
	className,
}: WorkspaceHeaderProps): React.JSX.Element {
	const [shortcutHelpOpen, setShortcutHelpOpen] = useState(false);
	const ctx = useCanvasStudio();
	const t = useCanvasT();
	const backLabel = t("canvas.header.back", "Back");
	const undoLabel = t("canvas.header.undo", "Undo");
	const redoLabel = t("canvas.header.redo", "Redo");
	const [editing, setEditing] = useState(false);

	const canUndo = useSyncExternalStore(
		ctx.historyStore.subscribe,
		() => ctx.historyStore.getState().canUndo(),
		() => ctx.historyStore.getState().canUndo(),
	);
	const canRedo = useSyncExternalStore(
		ctx.historyStore.subscribe,
		() => ctx.historyStore.getState().canRedo(),
		() => ctx.historyStore.getState().canRedo(),
	);

	// Prefer the context-level seam — it fires onChange/onChanges like every
	// other commit (E-20); partial test contexts without it fall back to the
	// pre-P0-9 direct historyStore -> sceneStore wiring.
	const undo = () => {
		if (ctx.undo) {
			ctx.undo();
			return;
		}
		const next = ctx.historyStore.getState().undo(ctx.getIR());
		ctx.sceneStore?.getState().setIR(next);
	};
	const redo = () => {
		if (ctx.redo) {
			ctx.redo();
			return;
		}
		const next = ctx.historyStore.getState().redo(ctx.getIR());
		ctx.sceneStore?.getState().setIR(next);
	};

	const actions = useCanvasActions();
	const restoreLayout = useRestoreLayout();
	const saveStatusStore = ctx.saveStatusStore;
	const saveStatus = useSyncExternalStore(
		saveStatusStore?.subscribe ?? (() => () => undefined),
		() => saveStatusStore?.getState().status ?? "clean",
		() => saveStatusStore?.getState().status ?? "clean",
	);
	// FR-170 save failure/recovery toast: the header pill above already shows
	// live status text, but that's easy to miss buried in the chrome — this is
	// the SAME `saveStatusStore` subscription, so it needs no new observation
	// point. Fires once when a save enters "error" (never once per retry: the
	// ref-tracked episode flag stays set through any number of retries that
	// keep landing back on "error"), and again exactly once when it recovers
	// — never on every routine autosave, which would be constant noise for a
	// debounced save firing every few seconds of typing.
	const saveErrorEpisodeRef = useRef(false);
	const toaster = useCanvasToaster();
	useEffect(() => {
		if (!saveStatusStore) return;
		if (saveStatus === "error") {
			if (saveErrorEpisodeRef.current) return;
			saveErrorEpisodeRef.current = true;
			toaster.add({
				type: "error",
				title: t("canvas.toast.saveFailed", "Couldn't save your changes"),
			});
			return;
		}
		if (
			saveErrorEpisodeRef.current &&
			(saveStatus === "saved" || saveStatus === "clean")
		) {
			saveErrorEpisodeRef.current = false;
			toaster.add({
				type: "success",
				title: t("canvas.toast.saveRecovered", "Changes saved"),
			});
		}
	}, [saveStatus, saveStatusStore, t, toaster]);
	const zoom = useSyncExternalStore(
		ctx.viewportStore.subscribe,
		() => ctx.viewportStore.getState().zoom,
		() => ctx.viewportStore.getState().zoom,
	);
	// FR-003 page-size display: the active page's dimensions, unit-aware and
	// locale-formatted. Reads live `ir`/`activePageId` off the context.
	const activePage =
		ctx.ir.pages.find((p) => p.id === ctx.activePageId) ?? ctx.ir.pages[0];
	const pageSizeLabel = activePage
		? `${formatDimension(activePage.size.width)} × ${formatDimension(
				activePage.size.height,
			)} ${activePage.size.unit ?? "px"}`
		: null;
	const displayTitle =
		title ?? ctx.ir.title ?? t("canvas.header.untitled", "Untitled");
	const editable = typeof onTitleChange === "function";

	const commitTitle = (value: string) => {
		setEditing(false);
		const trimmed = value.trim();
		if (trimmed.length > 0 && trimmed !== displayTitle)
			onTitleChange?.(trimmed);
	};

	return (
		<header
			data-testid="workspace-header"
			className={cn(
				"flex h-12 shrink-0 items-center gap-1.5 border-b border-border bg-card px-3",
				className,
			)}
		>
			{onBack ? (
				<>
					<Button
						type="button"
						variant="ghost"
						size="icon-sm"
						data-testid="workspace-back"
						aria-label={backLabel}
						title={backLabel}
						onClick={onBack}
					>
						<ChevronLeft aria-hidden />
					</Button>
					<Separator
						orientation="vertical"
						className="mx-1 h-4.5 data-vertical:self-center"
					/>
				</>
			) : null}

			<Button
				type="button"
				variant="ghost"
				size="icon-sm"
				data-testid="workspace-undo"
				aria-label={undoLabel}
				title={
					canUndo
						? undoLabel
						: t("canvas.header.nothingToUndo", "Nothing to undo")
				}
				disabled={!canUndo}
				onClick={undo}
			>
				<ChromeIcons.undo aria-hidden />
			</Button>
			<Button
				type="button"
				variant="ghost"
				size="icon-sm"
				data-testid="workspace-redo"
				aria-label={redoLabel}
				title={
					canRedo
						? redoLabel
						: t("canvas.header.nothingToRedo", "Nothing to redo")
				}
				disabled={!canRedo}
				onClick={redo}
			>
				<ChromeIcons.redo aria-hidden />
			</Button>

			<Separator
				orientation="vertical"
				className="mx-1 h-4.5 data-vertical:self-center"
			/>

			{editing ? (
				<Input
					key={displayTitle}
					type="text"
					aria-label={t("canvas.header.documentName", "Document name")}
					defaultValue={displayTitle}
					autoFocus
					data-testid="workspace-title-input"
					className="h-7.5 w-56 text-sm"
					onBlur={(e) => commitTitle(e.currentTarget.value)}
					onKeyDown={(e) => {
						if (e.key === "Enter") e.currentTarget.blur();
						else if (e.key === "Escape") setEditing(false);
					}}
				/>
			) : (
				<button
					type="button"
					data-testid="workspace-title"
					className={cn(
						"truncate rounded-md px-2 py-1 text-sm font-medium text-foreground",
						editable ? "cursor-text hover:bg-muted" : "cursor-default",
					)}
					disabled={!editable}
					onClick={() => editable && setEditing(true)}
				>
					{displayTitle}
				</button>
			)}

			{saveStatusStore ? (
				<button
					type="button"
					data-testid="workspace-save-status"
					data-status={saveStatus}
					aria-live="polite"
					className={cn(
						"ml-1 rounded-full px-2 py-0.5 text-[11px]",
						saveStatus === "error"
							? "bg-destructive/10 text-destructive"
							: "text-muted-foreground hover:bg-muted",
					)}
					title={t(...(SAVE_LABELS[saveStatus] as [string, string]))}
					onClick={() => {
						if (saveStatus === "error" || saveStatus === "dirty") {
							void ctx.save?.();
						}
					}}
				>
					{t(...(SAVE_LABELS[saveStatus] as [string, string]))}
				</button>
			) : null}

			<div className="flex-1" />

			{pageSizeLabel ? (
				<span
					data-testid="workspace-header-page-size"
					className="mr-2 hidden tabular-nums text-xs text-muted-foreground sm:inline"
					title={t("canvas.header.pageSize", "Page size")}
				>
					{pageSizeLabel}
				</span>
			) : null}

			<div
				data-testid="workspace-header-zoom"
				className="mr-1 flex items-center gap-0.5 text-xs text-muted-foreground"
			>
				<Button
					type="button"
					variant="ghost"
					size="icon-sm"
					data-testid="workspace-header-zoom-out"
					aria-label={t("canvas.footer.zoomOut", "Zoom out")}
					title={t("canvas.footer.zoomOut", "Zoom out")}
					onClick={() => actions.zoomOut()}
				>
					<ChromeIcons.zoomOut aria-hidden />
				</Button>
				<span className="w-10 text-center tabular-nums">
					{Math.round(zoom * 100)}%
				</span>
				<Button
					type="button"
					variant="ghost"
					size="icon-sm"
					data-testid="workspace-header-zoom-in"
					aria-label={t("canvas.footer.zoomIn", "Zoom in")}
					title={t("canvas.footer.zoomIn", "Zoom in")}
					onClick={() => actions.zoomIn()}
				>
					<ChromeIcons.zoomIn aria-hidden />
				</Button>
			</div>

			<DropdownMenu>
				<DropdownMenuTrigger
					data-testid="workspace-more-menu"
					aria-label={t("canvas.header.moreMenu", "More")}
					title={t("canvas.header.moreMenu", "More")}
					className="rounded-md p-1.5 text-muted-foreground hover:bg-muted"
				>
					<MoreHorizontal aria-hidden className="size-4" />
				</DropdownMenuTrigger>
				<DropdownMenuContent align="end">
					<DropdownMenuItem
						data-testid="header-menu-copy"
						onClick={() => void actions.copySelection()}
					>
						{t("canvas.menu.copy", "Copy")}
					</DropdownMenuItem>
					<DropdownMenuItem
						data-testid="header-menu-paste"
						onClick={() => void actions.paste()}
					>
						{t("canvas.menu.paste", "Paste")}
					</DropdownMenuItem>
					<DropdownMenuItem
						data-testid="header-menu-duplicate"
						onClick={() => actions.duplicateSelection()}
					>
						{t("canvas.menu.duplicate", "Duplicate")}
					</DropdownMenuItem>
					<DropdownMenuSeparator />
					<DropdownMenuItem
						data-testid="header-menu-zoom-fit"
						onClick={() => actions.zoomToFit()}
					>
						{t("canvas.shortcut.zoomToFit", "Zoom to fit")}
					</DropdownMenuItem>
					<DropdownMenuItem
						data-testid="header-menu-actual-size"
						onClick={() => actions.resetZoom()}
					>
						{t("canvas.shortcut.actualSize", "Actual size")}
					</DropdownMenuItem>
					<DropdownMenuSeparator />
					<DropdownMenuItem
						data-testid="header-menu-restore-layout"
						onClick={restoreLayout}
					>
						{t("canvas.workspace.restoreLayout", "Restore default layout")}
					</DropdownMenuItem>
					{shortcuts !== false ? (
						<DropdownMenuItem
							data-testid="header-menu-shortcut-help"
							onClick={() => setShortcutHelpOpen(true)}
						>
							{t("canvas.shortcutHelp.title", "Keyboard shortcuts")}
						</DropdownMenuItem>
					) : null}
				</DropdownMenuContent>
			</DropdownMenu>

			{avatarsSlot}
			{plugins?.map((plugin) => (
				<Fragment key={plugin.id}>{plugin.render()}</Fragment>
			))}
			{shareSlot}
			{shortcutHelpOpen ? (
				<Suspense fallback={null}>
					<ShortcutHelpDialog
						{...(typeof shortcuts === "object" ? { options: shortcuts } : {})}
						onClose={() => setShortcutHelpOpen(false)}
					/>
				</Suspense>
			) : null}
		</header>
	);
}
