"use client";

import {
	type CanvasAnyNodeUpdateCommand,
	type CanvasNode,
	findNode,
} from "@anvilkit/canvas-core";
import { Button, buttonVariants } from "@anvilkit/ui/button";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuSeparator,
	DropdownMenuSub,
	DropdownMenuSubContent,
	DropdownMenuSubTrigger,
	DropdownMenuTrigger,
} from "@anvilkit/ui/dropdown-menu";
import { cn } from "@anvilkit/ui/lib/utils";
import { Copy, Lock, LockOpen, MoreHorizontal, Trash2 } from "lucide-react";
import { useSyncExternalStore } from "react";
import { useCanvasStudio } from "../../context/canvas-studio-context.js";

export type AlignDirection =
	| "left"
	| "center-h"
	| "right"
	| "top"
	| "center-v"
	| "bottom";

export type ReorderDirection = "front" | "forward" | "backward" | "back";

/**
 * Optional host-supplied actions for operations with **no backing IR command**
 * today (PRD §2). Each menu item is disabled until the host wires a handler —
 * the layout-only refactor adds the affordance without inventing commands.
 */
export interface ElementActions {
	onDuplicate?: (ids: readonly string[]) => void;
	onCopyStyle?: (id: string) => void;
	onPasteStyle?: (ids: readonly string[]) => void;
	onAlign?: (ids: readonly string[], direction: AlignDirection) => void;
	onReorder?: (ids: readonly string[], direction: ReorderDirection) => void;
}

export interface ElementControlsProps {
	actions?: ElementActions;
	className?: string;
}

const ALIGN_OPTIONS: readonly { dir: AlignDirection; label: string }[] = [
	{ dir: "left", label: "Align left" },
	{ dir: "center-h", label: "Align center" },
	{ dir: "right", label: "Align right" },
	{ dir: "top", label: "Align top" },
	{ dir: "center-v", label: "Align middle" },
	{ dir: "bottom", label: "Align bottom" },
];

const REORDER_OPTIONS: readonly { dir: ReorderDirection; label: string }[] = [
	{ dir: "front", label: "Bring to front" },
	{ dir: "forward", label: "Bring forward" },
	{ dir: "backward", label: "Send backward" },
	{ dir: "back", label: "Send to back" },
];

/**
 * Floating per-selection controls pinned above the selection: lock, duplicate,
 * delete, and a "⋯ more" menu. Lock + delete run through the existing command
 * pipeline; duplicate / copy-paste-style / align / layer-order are host
 * callbacks (disabled when unwired). These are the floating selection controls
 * for the `CanvasWorkspace` shell.
 */
export function ElementControls({
	actions,
	className,
}: ElementControlsProps): React.JSX.Element | null {
	const ctx = useCanvasStudio();
	const selectedIds = useSyncExternalStore(
		ctx.selectionStore.subscribe,
		() => ctx.selectionStore.getState().selectedIds,
		() => ctx.selectionStore.getState().selectedIds,
	);

	if (selectedIds.length === 0) return null;
	const nodes = selectedIds
		.map((id) => findNode(ctx.ir, id)?.node)
		.filter((n): n is CanvasNode => Boolean(n));
	const primary = nodes[0];
	if (!primary) return null;

	const allLocked = nodes.every((n) => n.locked === true);

	const toggleLock = () => {
		for (const n of nodes) {
			ctx.commit({
				type: "node.update",
				nodeId: n.id,
				kind: n.type,
				patch: { locked: !allLocked },
			} as CanvasAnyNodeUpdateCommand);
		}
	};

	const deleteSelection = () => {
		for (const id of selectedIds) {
			ctx.commit({ type: "node.delete", nodeId: id });
		}
		ctx.selectionStore.getState().clearSelection();
	};

	return (
		<div
			data-testid="element-controls"
			data-ak-element-controls=""
			role="toolbar"
			aria-label="Element controls"
			className={cn(
				"absolute -top-11 left-1/2 z-30 flex -translate-x-1/2 items-center gap-0.5 rounded-full bg-card px-1.5 py-1 shadow-lg ring-1 ring-border",
				className,
			)}
		>
			<Button
				type="button"
				size="icon-sm"
				variant="ghost"
				data-testid="element-controls-lock"
				aria-pressed={allLocked}
				aria-label={allLocked ? "Unlock" : "Lock"}
				title={allLocked ? "Unlock" : "Lock"}
				onClick={toggleLock}
			>
				{allLocked ? <Lock aria-hidden /> : <LockOpen aria-hidden />}
			</Button>
			<Button
				type="button"
				size="icon-sm"
				variant="ghost"
				data-testid="element-controls-duplicate"
				aria-label="Duplicate"
				title="Duplicate"
				disabled={!actions?.onDuplicate}
				onClick={() => actions?.onDuplicate?.(selectedIds)}
			>
				<Copy aria-hidden />
			</Button>
			<Button
				type="button"
				size="icon-sm"
				variant="ghost"
				data-testid="element-controls-delete"
				aria-label="Delete"
				title="Delete"
				onClick={deleteSelection}
			>
				<Trash2 aria-hidden />
			</Button>

			<DropdownMenu>
				<DropdownMenuTrigger
					data-testid="element-controls-more"
					aria-label="More"
					title="More"
					className={cn(buttonVariants({ variant: "ghost", size: "icon-sm" }))}
				>
					<MoreHorizontal aria-hidden />
				</DropdownMenuTrigger>
				<DropdownMenuContent align="center">
					<DropdownMenuItem
						data-testid="more-copy-style"
						disabled={!actions?.onCopyStyle}
						onClick={() => actions?.onCopyStyle?.(primary.id)}
					>
						Copy style
					</DropdownMenuItem>
					<DropdownMenuItem
						data-testid="more-paste-style"
						disabled={!actions?.onPasteStyle}
						onClick={() => actions?.onPasteStyle?.(selectedIds)}
					>
						Paste style
					</DropdownMenuItem>
					<DropdownMenuItem
						data-testid="more-delete"
						variant="destructive"
						onClick={deleteSelection}
					>
						Delete
					</DropdownMenuItem>
					<DropdownMenuSeparator />
					{actions?.onAlign ? (
						<DropdownMenuSub>
							<DropdownMenuSubTrigger data-testid="more-align">
								Align
							</DropdownMenuSubTrigger>
							<DropdownMenuSubContent>
								{ALIGN_OPTIONS.map((o) => (
									<DropdownMenuItem
										key={o.dir}
										data-testid={`more-align-${o.dir}`}
										onClick={() => actions.onAlign?.(selectedIds, o.dir)}
									>
										{o.label}
									</DropdownMenuItem>
								))}
							</DropdownMenuSubContent>
						</DropdownMenuSub>
					) : (
						<DropdownMenuItem data-testid="more-align" disabled>
							Align
						</DropdownMenuItem>
					)}
					{actions?.onReorder ? (
						<DropdownMenuSub>
							<DropdownMenuSubTrigger data-testid="more-reorder">
								Layer order
							</DropdownMenuSubTrigger>
							<DropdownMenuSubContent>
								{REORDER_OPTIONS.map((o) => (
									<DropdownMenuItem
										key={o.dir}
										data-testid={`more-reorder-${o.dir}`}
										onClick={() => actions.onReorder?.(selectedIds, o.dir)}
									>
										{o.label}
									</DropdownMenuItem>
								))}
							</DropdownMenuSubContent>
						</DropdownMenuSub>
					) : (
						<DropdownMenuItem data-testid="more-reorder" disabled>
							Layer order
						</DropdownMenuItem>
					)}
				</DropdownMenuContent>
			</DropdownMenu>
		</div>
	);
}
