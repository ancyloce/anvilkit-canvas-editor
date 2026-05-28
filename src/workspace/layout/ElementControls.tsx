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

/** Gap (in screen px) between the bottom of the toolbar and the top of the
 * selection AABB. */
const ELEMENT_CONTROLS_GAP = 8;

/** Rotation-aware AABB of a node in design (page) coordinates. */
function nodeAABB(node: CanvasNode): {
	minX: number;
	minY: number;
	maxX: number;
	maxY: number;
} {
	const { x, y, rotation = 0, scaleX = 1, scaleY = 1 } = node.transform;
	const w = node.bounds.width * scaleX;
	const h = node.bounds.height * scaleY;
	if (!rotation) {
		return { minX: x, minY: y, maxX: x + w, maxY: y + h };
	}
	const cx = x + w / 2;
	const cy = y + h / 2;
	const rad = (rotation * Math.PI) / 180;
	const cos = Math.cos(rad);
	const sin = Math.sin(rad);
	const corners: ReadonlyArray<readonly [number, number]> = [
		[x, y],
		[x + w, y],
		[x + w, y + h],
		[x, y + h],
	];
	let minX = Number.POSITIVE_INFINITY;
	let minY = Number.POSITIVE_INFINITY;
	let maxX = Number.NEGATIVE_INFINITY;
	let maxY = Number.NEGATIVE_INFINITY;
	for (const [px, py] of corners) {
		const rx = cx + (px - cx) * cos - (py - cy) * sin;
		const ry = cy + (px - cx) * sin + (py - cy) * cos;
		if (rx < minX) minX = rx;
		if (ry < minY) minY = ry;
		if (rx > maxX) maxX = rx;
		if (ry > maxY) maxY = ry;
	}
	return { minX, minY, maxX, maxY };
}

/**
 * Floating per-selection controls pinned **above the selected element** (lock,
 * duplicate, delete, "⋯ more"). The toolbar is a DOM element so it doesn't
 * scale with the Konva canvas — but its position is computed from screen
 * coordinates (selection AABB × stage zoom + pan), so it tracks the element on
 * screen regardless of canvas zoom or hand-tool pan. Lock + delete run through
 * the existing command pipeline; duplicate / copy-paste-style / align /
 * layer-order are host callbacks (disabled when unwired).
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
	const zoom = useSyncExternalStore(
		ctx.viewportStore.subscribe,
		() => ctx.viewportStore.getState().zoom,
		() => ctx.viewportStore.getState().zoom,
	);
	const panX = useSyncExternalStore(
		ctx.viewportStore.subscribe,
		() => ctx.viewportStore.getState().panX,
		() => ctx.viewportStore.getState().panX,
	);
	const panY = useSyncExternalStore(
		ctx.viewportStore.subscribe,
		() => ctx.viewportStore.getState().panY,
		() => ctx.viewportStore.getState().panY,
	);

	if (selectedIds.length === 0) return null;
	const nodes = selectedIds
		.map((id) => findNode(ctx.ir, id)?.node)
		.filter((n): n is CanvasNode => Boolean(n));
	const primary = nodes[0];
	if (!primary) return null;

	// Selection AABB in design coords (union of nodes), then projected to
	// stage-container pixels via the current zoom + pan. The page wrapper is the
	// toolbar's positioned ancestor and shares the stage container's origin, so
	// these values are also the toolbar's `left`/`top` in CSS px.
	let minX = Number.POSITIVE_INFINITY;
	let minY = Number.POSITIVE_INFINITY;
	let maxX = Number.NEGATIVE_INFINITY;
	for (const n of nodes) {
		const b = nodeAABB(n);
		if (b.minX < minX) minX = b.minX;
		if (b.minY < minY) minY = b.minY;
		if (b.maxX > maxX) maxX = b.maxX;
	}
	const screenCenterX = ((minX + maxX) / 2) * zoom + panX;
	const screenTop = minY * zoom + panY;

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
				"pointer-events-auto absolute z-30 flex items-center gap-0.5 rounded-full bg-card px-1.5 py-1 shadow-lg ring-1 ring-border",
				className,
			)}
			style={{
				left: `${screenCenterX}px`,
				top: `${screenTop - ELEMENT_CONTROLS_GAP}px`,
				// translate(-50%, -100%) → toolbar's bottom-centre sits at (left, top),
				// i.e. it floats above the selection AABB regardless of its own size.
				transform: "translate(-50%, -100%)",
			}}
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
