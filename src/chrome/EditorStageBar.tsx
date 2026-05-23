"use client";

import { Button } from "@anvilkit/ui/button";
import { cn } from "@anvilkit/ui/lib/utils";
import { Separator } from "@anvilkit/ui/separator";
import { type ReactNode, useSyncExternalStore } from "react";
import { useCanvasStudio } from "../context/canvas-studio-context.js";
import { ChromeIcons } from "./icons.js";

export interface EditorStageBarProps {
	/** Right-aligned action slot (e.g. Share / Export / Publish buttons). */
	actions?: ReactNode;
	/** Collaborator avatars slot, rendered before the actions. */
	avatarsSlot?: ReactNode;
	/** Override the document title shown in the breadcrumb (defaults to `ir.title`). */
	title?: string;
	className?: string;
}

/**
 * Top strip of the stage column (reference `.editor-stage-bar`): undo/redo,
 * the document title, the active artboard's size chip, then host-supplied
 * collaborator avatars + actions. Undo/redo run through `historyStore` and
 * write the result back through `sceneStore`, matching `<CanvasStudio>`.
 */
export function EditorStageBar({
	actions,
	avatarsSlot,
	title,
	className,
}: EditorStageBarProps): React.JSX.Element {
	const ctx = useCanvasStudio();
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

	const docTitle = title ?? ctx.ir.title ?? "Untitled";
	const activePage = ctx.ir.pages.find((p) => p.id === ctx.activePageId);
	const size = activePage?.size;

	return (
		<header
			data-testid="editor-stage-bar"
			className={cn(
				"flex h-11 shrink-0 items-center gap-1.5 border-b border-border bg-card px-3.5",
				className,
			)}
		>
			<Button
				type="button"
				variant="ghost"
				size="icon-sm"
				data-testid="stage-undo"
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
				data-testid="stage-redo"
				aria-label="Redo"
				title="Redo"
				disabled={!canRedo}
				onClick={redo}
			>
				<ChromeIcons.redo aria-hidden />
			</Button>

			<Separator orientation="vertical" className="mx-1 h-4.5" />

			<span
				data-testid="stage-doc-title"
				className="truncate text-sm font-medium text-foreground"
			>
				{docTitle}
			</span>

			{size ? (
				<span
					data-testid="stage-doc-size"
					className="ml-1 inline-flex h-7 items-center rounded-full bg-muted px-3 font-mono text-xs text-muted-foreground"
				>
					{size.width} × {size.height}
				</span>
			) : null}

			<div className="flex-1" />

			{avatarsSlot}
			{actions}
		</header>
	);
}
