"use client";

import { Button } from "@anvilkit/ui/button";
import { Input } from "@anvilkit/ui/input";
import { cn } from "@anvilkit/ui/lib/utils";
import { Separator } from "@anvilkit/ui/separator";
import { ChevronLeft } from "lucide-react";
import { type ReactNode, useState, useSyncExternalStore } from "react";
import { ChromeIcons } from "../../chrome/icons.js";
import { useCanvasStudio } from "../../context/canvas-studio-context.js";

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
	shareSlot,
	className,
}: WorkspaceHeaderProps): React.JSX.Element {
	const ctx = useCanvasStudio();
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

	const displayTitle = title ?? ctx.ir.title ?? "Untitled";
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
						aria-label="Back"
						title="Back"
						onClick={onBack}
					>
						<ChevronLeft aria-hidden />
					</Button>
					<Separator orientation="vertical" className="mx-1 h-4.5" />
				</>
			) : null}

			<Button
				type="button"
				variant="ghost"
				size="icon-sm"
				data-testid="workspace-undo"
				aria-label="Undo"
				title="Undo"
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
				aria-label="Redo"
				title="Redo"
				disabled={!canRedo}
				onClick={redo}
			>
				<ChromeIcons.redo aria-hidden />
			</Button>

			<Separator orientation="vertical" className="mx-1 h-4.5" />

			{editing ? (
				<Input
					key={displayTitle}
					type="text"
					aria-label="Document name"
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

			<div className="flex-1" />

			{avatarsSlot}
			{shareSlot}
		</header>
	);
}
