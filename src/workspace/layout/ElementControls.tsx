"use client";

import {
	type AlignEdge,
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
	type CanvasDistributeAxis,
	useCanvasActions,
} from "@/actions/editor-actions.js";
import {
	useCanvasStudio,
	useCanvasT,
} from "@/context/canvas-studio-context.js";
import { findNodeById } from "@/stage/find-node-by-id.js";

export type AlignDirection =
	| "left"
	| "center-h"
	| "right"
	| "top"
	| "center-v"
	| "bottom";

export type ReorderDirection = "front" | "forward" | "backward" | "back";

/**
 * Optional host-supplied action OVERRIDES (backward compatibility) — they
 * take precedence when set. Duplicate, align, distribute, reorder, group,
 * ungroup, and copy/paste style (C-05, via `node.applyStyle`) are all built
 * in via the unified action layer (M0-02/B-13/C-05).
 */
export interface ElementActions {
	onDuplicate?: (ids: readonly string[]) => void;
	onCopyStyle?: (id: string) => void;
	onPasteStyle?: (ids: readonly string[]) => void;
	onAlign?: (ids: readonly string[], direction: AlignDirection) => void;
	onReorder?: (ids: readonly string[], direction: ReorderDirection) => void;
}

/** Menu direction → core {@link AlignEdge} used by the action layer. */
const ALIGN_EDGE: Record<AlignDirection, AlignEdge> = {
	left: "left",
	"center-h": "hcenter",
	right: "right",
	top: "top",
	"center-v": "vcenter",
	bottom: "bottom",
};

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

const DISTRIBUTE_OPTIONS: readonly {
	axis: CanvasDistributeAxis;
	labelKey: string;
	label: string;
}[] = [
	{
		axis: "x",
		labelKey: "canvas.distribute.h",
		label: "Distribute horizontally",
	},
	{
		axis: "y",
		labelKey: "canvas.distribute.v",
		label: "Distribute vertically",
	},
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
		const knode = findNodeById(stage, id);
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
	const editorActions = useCanvasActions();
	const t = useCanvasT();
	const selectedIds = useSyncExternalStore(
		ctx.selectionStore.subscribe,
		() => ctx.selectionStore.getState().selectedIds,
		() => ctx.selectionStore.getState().selectedIds,
	);
	const editingNodeId = useSyncExternalStore(
		ctx.editingStore.subscribe,
		() => ctx.editingStore.getState().editingNodeId,
		() => ctx.editingStore.getState().editingNodeId,
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

	// While inline text editing is active the RichTextToolbar owns the floating
	// chrome — both selection toolbars stay hidden (FR-180).
	if (editingNodeId !== null) return null;
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

	// FR-180: one batched undo entry for the whole selection via the unified
	// action layer (was a per-node commit loop → N entries). The action also
	// drops the selection on lock — a locked element can't be resized/rotated/
	// dragged and is un-hittable by `findHitNodeId` and the marquee, so unlock
	// happens from the layer panel; on unlock the selection is kept.
	const toggleLock = () => {
		editorActions.toggleLockSelection();
	};

	// Unified action layer (M0-02): one undo entry for multi-delete, locked
	// nodes protected, selection cleared — identical semantics from every UI
	// surface.
	const deleteSelection = () => {
		editorActions.deleteSelection();
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
				// FR-024/FR-180: an all-locked selection keeps only Unlock live —
				// every mutating control disables instead of silently no-op'ing.
				disabled={allLocked}
				aria-label={t("canvas.element.duplicate", "Duplicate")}
				title={t("canvas.element.duplicate", "Duplicate")}
				onClick={() => {
					// Host override for backward compatibility; built-in duplicate
					// (fresh ids, next to the original, one batch) otherwise (A-05).
					if (actions?.onDuplicate) actions.onDuplicate(selectedIds);
					else editorActions.duplicateSelection();
				}}
			>
				<Copy aria-hidden />
			</Button>
			<Button
				type="button"
				size="icon-sm"
				variant="ghost"
				data-testid="element-controls-delete"
				disabled={allLocked}
				aria-label={t("canvas.element.delete", "Delete")}
				title={t("canvas.element.delete", "Delete")}
				onClick={deleteSelection}
			>
				<Trash2 aria-hidden />
			</Button>

			<DropdownMenu>
				<DropdownMenuTrigger
					data-testid="element-controls-more"
					disabled={allLocked}
					aria-label={t("canvas.element.more", "More")}
					title={t("canvas.element.more", "More")}
					className={cn(buttonVariants({ variant: "ghost", size: "icon-sm" }))}
				>
					<MoreHorizontal aria-hidden />
				</DropdownMenuTrigger>
				<DropdownMenuContent align="center">
					<DropdownMenuItem
						data-testid="more-copy-style"
						onClick={() =>
							actions?.onCopyStyle
								? actions.onCopyStyle(primary.id)
								: editorActions.copyStyle()
						}
					>
						{t("canvas.element.copyStyle", "Copy style")}
					</DropdownMenuItem>
					<DropdownMenuItem
						data-testid="more-paste-style"
						disabled={!actions?.onPasteStyle && !editorActions.hasCopiedStyle()}
						onClick={() =>
							actions?.onPasteStyle
								? actions.onPasteStyle(selectedIds)
								: editorActions.pasteStyle()
						}
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
					<DropdownMenuSub>
						<DropdownMenuSubTrigger
							data-testid="more-align"
							disabled={selectedIds.length < 2}
						>
							{t("canvas.element.align", "Align")}
						</DropdownMenuSubTrigger>
						<DropdownMenuSubContent>
							{ALIGN_OPTIONS.map((o) => (
								<DropdownMenuItem
									key={o.dir}
									data-testid={`more-align-${o.dir}`}
									onClick={() => {
										// Host override for backward compatibility; the built-in
										// action layer otherwise (single undoable batch).
										if (actions?.onAlign) {
											actions.onAlign(selectedIds, o.dir);
										} else {
											editorActions.alignSelection(ALIGN_EDGE[o.dir]);
										}
									}}
								>
									{t(o.labelKey, o.label)}
								</DropdownMenuItem>
							))}
						</DropdownMenuSubContent>
					</DropdownMenuSub>
					<DropdownMenuSub>
						<DropdownMenuSubTrigger
							data-testid="more-distribute"
							disabled={selectedIds.length < 3}
						>
							{t("canvas.element.distribute", "Distribute")}
						</DropdownMenuSubTrigger>
						<DropdownMenuSubContent>
							{DISTRIBUTE_OPTIONS.map((o) => (
								<DropdownMenuItem
									key={o.axis}
									data-testid={`more-distribute-${o.axis}`}
									onClick={() => editorActions.distributeSelection(o.axis)}
								>
									{t(o.labelKey, o.label)}
								</DropdownMenuItem>
							))}
							<DropdownMenuItem
								data-testid="more-tidy-up"
								onClick={() => editorActions.tidyUpSelection()}
							>
								{t("canvas.element.tidyUp", "Tidy up")}
							</DropdownMenuItem>
						</DropdownMenuSubContent>
					</DropdownMenuSub>
					<DropdownMenuSub>
						<DropdownMenuSubTrigger data-testid="more-reorder">
							{t("canvas.element.layerOrder", "Layer order")}
						</DropdownMenuSubTrigger>
						<DropdownMenuSubContent>
							{REORDER_OPTIONS.map((o) => (
								<DropdownMenuItem
									key={o.dir}
									data-testid={`more-reorder-${o.dir}`}
									onClick={() => {
										// Host override for backward compatibility; the built-in
										// action layer otherwise (B-13, one undoable batch).
										if (actions?.onReorder)
											actions.onReorder(selectedIds, o.dir);
										else editorActions.reorderSelection(o.dir);
									}}
								>
									{t(o.labelKey, o.label)}
								</DropdownMenuItem>
							))}
						</DropdownMenuSubContent>
					</DropdownMenuSub>
					<DropdownMenuSeparator />
					<DropdownMenuItem
						data-testid="more-group"
						disabled={selectedIds.length < 2}
						onClick={() => editorActions.groupSelection()}
					>
						{t("canvas.menu.group", "Group")}
					</DropdownMenuItem>
					<DropdownMenuItem
						data-testid="more-ungroup"
						disabled={!irNodes.some((n) => n.type === "group")}
						onClick={() => editorActions.ungroupSelection()}
					>
						{t("canvas.menu.ungroup", "Ungroup")}
					</DropdownMenuItem>
				</DropdownMenuContent>
			</DropdownMenu>
		</div>
	);
}
