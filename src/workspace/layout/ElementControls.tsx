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
import type Konva from "konva";
import { Copy, Lock, LockOpen, MoreHorizontal, Trash2 } from "lucide-react";
import { useEffect, useRef, useSyncExternalStore } from "react";
import {
	useCanvasStudio,
	useCanvasT,
} from "../../context/canvas-studio-context.js";

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

const ALIGN_OPTIONS: readonly {
	dir: AlignDirection;
	labelKey: string;
	label: string;
}[] = [
	{ dir: "left", labelKey: "canvas.align.left", label: "Align left" },
	{ dir: "center-h", labelKey: "canvas.align.centerH", label: "Align center" },
	{ dir: "right", labelKey: "canvas.align.right", label: "Align right" },
	{ dir: "top", labelKey: "canvas.align.top", label: "Align top" },
	{ dir: "center-v", labelKey: "canvas.align.centerV", label: "Align middle" },
	{ dir: "bottom", labelKey: "canvas.align.bottom", label: "Align bottom" },
];

const REORDER_OPTIONS: readonly {
	dir: ReorderDirection;
	labelKey: string;
	label: string;
}[] = [
	{ dir: "front", labelKey: "canvas.reorder.front", label: "Bring to front" },
	{
		dir: "forward",
		labelKey: "canvas.reorder.forward",
		label: "Bring forward",
	},
	{
		dir: "backward",
		labelKey: "canvas.reorder.backward",
		label: "Send backward",
	},
	{ dir: "back", labelKey: "canvas.reorder.back", label: "Send to back" },
];

/** Gap (in screen px) between the bottom of the toolbar and the top of the
 * selection AABB. */
const ELEMENT_CONTROLS_GAP = 8;

/**
 * Canvas-pixel bounding box of the selection (centre-X + top), measured via
 * Konva's `getClientRect`. Cost is O(selection size), independent of the
 * page's total node count — large pages don't slow this down. Returns null
 * when nothing resolves (empty selection, detached nodes, stage not ready).
 */
function measureSelection(
	stage: Konva.Stage | null,
	ids: readonly string[],
): { centerX: number; top: number } | null {
	if (!stage || ids.length === 0) return null;
	let minX = Number.POSITIVE_INFINITY;
	let minY = Number.POSITIVE_INFINITY;
	let maxX = Number.NEGATIVE_INFINITY;
	let found = false;
	for (const id of ids) {
		const knode = stage.findOne(`.${id}`);
		if (!knode) continue;
		const r = knode.getClientRect({ skipShadow: true, skipStroke: true });
		if (r.x < minX) minX = r.x;
		if (r.y < minY) minY = r.y;
		if (r.x + r.width > maxX) maxX = r.x + r.width;
		found = true;
	}
	return found ? { centerX: (minX + maxX) / 2, top: minY } : null;
}

/**
 * Floating per-selection controls pinned **above the selected element** (lock,
 * duplicate, delete, "⋯ more"). The toolbar is a DOM element so it doesn't
 * scale with the Konva canvas — but its position is computed from the rendered
 * canvas-pixel bounding box (via `Konva.Node#getClientRect`), so it tracks the
 * element on screen through any nested group transforms, rotation, zoom, or
 * hand-tool pan. Lock + delete run through the existing command pipeline;
 * duplicate / copy-paste-style / align / layer-order are host callbacks
 * (disabled when unwired).
 */
export function ElementControls({
	actions,
	className,
}: ElementControlsProps): React.JSX.Element | null {
	const ctx = useCanvasStudio();
	const t = useCanvasT();
	const selectedIds = useSyncExternalStore(
		ctx.selectionStore.subscribe,
		() => ctx.selectionStore.getState().selectedIds,
		() => ctx.selectionStore.getState().selectedIds,
	);
	// Subscribe to viewport changes so we re-render (and re-measure the
	// canvas-pixel rect via `getClientRect`) on every zoom/pan tick.
	useSyncExternalStore(
		ctx.viewportStore.subscribe,
		() => {
			const v = ctx.viewportStore.getState();
			return `${v.zoom}:${v.panX}:${v.panY}`;
		},
		() => {
			const v = ctx.viewportStore.getState();
			return `${v.zoom}:${v.panX}:${v.panY}`;
		},
	);

	const stage = ctx.stage;
	const { draftStore, selectionStore } = ctx;
	const toolbarRef = useRef<HTMLDivElement>(null);

	// Follow the element during a local MOVE drag without re-rendering React on
	// every pointer-move frame. We subscribe to the local `draftStore`
	// imperatively (remote collab moves never enter this store → no fire for
	// other users' drags) and rAF-throttle a direct DOM `style.left/top` update.
	// One measurement per animation frame, O(selection) — independent of total
	// page node count. The rAF defers the read until AFTER react-konva has
	// applied the latest draft offset to the Konva node, so `getClientRect`
	// returns the live position.
	useEffect(() => {
		if (!stage) return;
		let raf = 0;
		const apply = () => {
			raf = 0;
			const el = toolbarRef.current;
			if (!el) return;
			const r = measureSelection(stage, selectionStore.getState().selectedIds);
			if (!r) return;
			el.style.left = `${r.centerX}px`;
			el.style.top = `${r.top - ELEMENT_CONTROLS_GAP}px`;
		};
		const onDraftChange = () => {
			if (draftStore.getState().draft?.type !== "move") return;
			if (raf === 0) raf = requestAnimationFrame(apply);
		};
		const unsub = draftStore.subscribe(onDraftChange);
		return () => {
			if (raf) cancelAnimationFrame(raf);
			unsub();
		};
	}, [stage, draftStore, selectionStore]);

	if (selectedIds.length === 0) return null;
	const irNodes = selectedIds
		.map((id) => findNode(ctx.ir, id)?.node)
		.filter((n): n is CanvasNode => Boolean(n));
	const primary = irNodes[0];
	if (!primary || !stage) return null;

	// Initial / resting / post-commit position via the same measurement helper.
	// (During a move drag the effect above overrides this imperatively each
	// frame; on drag-end the IR commit re-renders React with the new position
	// and the inline `style` re-asserts to match.)
	const measured = measureSelection(stage, selectedIds);
	if (!measured) return null;
	const screenCenterX = measured.centerX;
	const screenTop = measured.top;

	const allLocked = irNodes.every((n) => n.locked === true);

	const toggleLock = () => {
		const nextLocked = !allLocked;
		for (const n of irNodes) {
			ctx.commit({
				type: "node.update",
				nodeId: n.id,
				kind: n.type,
				patch: { locked: nextLocked },
			} as CanvasAnyNodeUpdateCommand);
		}
		// On lock: drop the selection so the element can't be resized/rotated/
		// dragged. Locked nodes are also un-hittable by `findHitNodeId` and the
		// marquee, so the canvas can't re-select them — unlock from the layer
		// panel. On unlock: keep the selection so the user can keep editing.
		if (nextLocked) ctx.selectionStore.getState().clearSelection();
	};

	const deleteSelection = () => {
		// Locked nodes are protected from deletion.
		const lockedIds = new Set(
			irNodes.filter((n) => n.locked === true).map((n) => n.id),
		);
		for (const id of selectedIds) {
			if (lockedIds.has(id)) continue;
			ctx.commit({ type: "node.delete", nodeId: id });
		}
		ctx.selectionStore.getState().clearSelection();
	};

	return (
		<div
			ref={toolbarRef}
			data-testid="element-controls"
			data-ak-element-controls=""
			role="toolbar"
			aria-label={t("canvas.element.controls", "Element controls")}
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
				aria-label={
					allLocked
						? t("canvas.element.unlock", "Unlock")
						: t("canvas.element.lock", "Lock")
				}
				title={
					allLocked
						? t("canvas.element.unlock", "Unlock")
						: t("canvas.element.lock", "Lock")
				}
				onClick={toggleLock}
			>
				{allLocked ? <Lock aria-hidden /> : <LockOpen aria-hidden />}
			</Button>
			<Button
				type="button"
				size="icon-sm"
				variant="ghost"
				data-testid="element-controls-duplicate"
				aria-label={t("canvas.element.duplicate", "Duplicate")}
				title={t("canvas.element.duplicate", "Duplicate")}
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
				aria-label={t("canvas.element.delete", "Delete")}
				title={t("canvas.element.delete", "Delete")}
				onClick={deleteSelection}
			>
				<Trash2 aria-hidden />
			</Button>

			<DropdownMenu>
				<DropdownMenuTrigger
					data-testid="element-controls-more"
					aria-label={t("canvas.element.more", "More")}
					title={t("canvas.element.more", "More")}
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
						{t("canvas.element.copyStyle", "Copy style")}
					</DropdownMenuItem>
					<DropdownMenuItem
						data-testid="more-paste-style"
						disabled={!actions?.onPasteStyle}
						onClick={() => actions?.onPasteStyle?.(selectedIds)}
					>
						{t("canvas.element.pasteStyle", "Paste style")}
					</DropdownMenuItem>
					<DropdownMenuItem
						data-testid="more-delete"
						variant="destructive"
						onClick={deleteSelection}
					>
						{t("canvas.element.delete", "Delete")}
					</DropdownMenuItem>
					<DropdownMenuSeparator />
					{actions?.onAlign ? (
						<DropdownMenuSub>
							<DropdownMenuSubTrigger data-testid="more-align">
								{t("canvas.element.align", "Align")}
							</DropdownMenuSubTrigger>
							<DropdownMenuSubContent>
								{ALIGN_OPTIONS.map((o) => (
									<DropdownMenuItem
										key={o.dir}
										data-testid={`more-align-${o.dir}`}
										onClick={() => actions.onAlign?.(selectedIds, o.dir)}
									>
										{t(o.labelKey, o.label)}
									</DropdownMenuItem>
								))}
							</DropdownMenuSubContent>
						</DropdownMenuSub>
					) : (
						<DropdownMenuItem data-testid="more-align" disabled>
							{t("canvas.element.align", "Align")}
						</DropdownMenuItem>
					)}
					{actions?.onReorder ? (
						<DropdownMenuSub>
							<DropdownMenuSubTrigger data-testid="more-reorder">
								{t("canvas.element.layerOrder", "Layer order")}
							</DropdownMenuSubTrigger>
							<DropdownMenuSubContent>
								{REORDER_OPTIONS.map((o) => (
									<DropdownMenuItem
										key={o.dir}
										data-testid={`more-reorder-${o.dir}`}
										onClick={() => actions.onReorder?.(selectedIds, o.dir)}
									>
										{t(o.labelKey, o.label)}
									</DropdownMenuItem>
								))}
							</DropdownMenuSubContent>
						</DropdownMenuSub>
					) : (
						<DropdownMenuItem data-testid="more-reorder" disabled>
							{t("canvas.element.layerOrder", "Layer order")}
						</DropdownMenuItem>
					)}
				</DropdownMenuContent>
			</DropdownMenu>
		</div>
	);
}
