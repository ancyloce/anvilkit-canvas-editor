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
	type ReactNode,
	useState,
	useSyncExternalStore,
} from "react";
import { useCanvasActions } from "@/actions/editor-actions.js";
import { ChromeIcons } from "@/chrome/icons.js";
import {
	useCanvasStudio,
	useCanvasT,
} from "@/context/canvas-studio-context.js";
// Relative (not @/) on purpose: this type surfaces in the emitted .d.ts, and
// rslib rewrites alias paths only in .js, not in declarations — an aliased
// import here would ship an unresolvable "@/" to consumers.
import type { CanvasHeaderPlugin } from "../../header/types.js";
import { useRestoreLayout } from "../state/hooks.js";

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
	plugins,
	shareSlot,
	className,
}: WorkspaceHeaderProps): React.JSX.Element {
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

	const undo = () => {
		const next = ctx.historyStore.getState().undo(ctx.getIR());
		ctx.sceneStore?.getState().setIR(next);
	};
	const redo = () => {
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
	const zoom = useSyncExternalStore(
		ctx.viewportStore.subscribe,
		() => ctx.viewportStore.getState().zoom,
		() => ctx.viewportStore.getState().zoom,
	);
	const SAVE_LABELS: Record<string, [string, string]> = {
		clean: ["canvas.save.clean", "All changes saved"],
		dirty: ["canvas.save.dirty", "Unsaved changes"],
		saving: ["canvas.save.saving", "Saving…"],
		saved: ["canvas.save.saved", "Saved"],
		error: ["canvas.save.error", "Save failed — click to retry"],
		offline: ["canvas.save.offline", "Offline"],
	};

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
				</DropdownMenuContent>
			</DropdownMenu>

			{avatarsSlot}
			{plugins?.map((plugin) => (
				<Fragment key={plugin.id}>{plugin.render()}</Fragment>
			))}
			{shareSlot}
		</header>
	);
}
