"use client";

import {
	type CanvasAnyNodeUpdateCommand,
	type CanvasGroupNode,
	type CanvasNode,
	type CanvasNodeKind,
	type CanvasPage,
	isContainerNode,
} from "@anvilkit/canvas-core";
import { Button } from "@anvilkit/ui/button";
import { cn } from "@anvilkit/ui/lib/utils";
import { Windowed } from "@anvilkit/ui/windowed";
import {
	Eye,
	EyeOff,
	Group as GroupIcon,
	Lock,
	LockOpen,
	Ungroup,
} from "lucide-react";
import { useCallback, useMemo, useSyncExternalStore } from "react";
import {
	type CanvasT,
	useCanvasStudio,
	useCanvasT,
} from "../context/canvas-studio-context.js";
import {
	canGroupSelection,
	canUngroupSelection,
	groupSelection,
	ungroupSelection,
} from "../selection/group-actions.js";

const INDENT_PX = 14;
const ROW_PAD_X = 8;

interface FlatRow {
	node: CanvasNode;
	depth: number;
}

function flattenChildren(group: CanvasGroupNode): FlatRow[] {
	const rows: FlatRow[] = [];
	const walk = (children: readonly CanvasNode[], depth: number) => {
		// Top-most layer should render first row — match Figma/Photoshop where
		// the topmost layer is at the top of the panel.
		for (let i = children.length - 1; i >= 0; i--) {
			const child = children[i];
			if (!child) continue;
			rows.push({ node: child, depth });
			if (isContainerNode(child)) {
				walk(child.children, depth + 1);
			}
		}
	};
	walk(group.children, 0);
	return rows;
}

const KIND_LABEL_KEYS: Record<CanvasNodeKind, string> = {
	group: "canvas.layer.kind.group",
	frame: "canvas.layer.kind.frame",
	rect: "canvas.layer.kind.rect",
	ellipse: "canvas.layer.kind.ellipse",
	line: "canvas.layer.kind.line",
	path: "canvas.layer.kind.path",
	text: "canvas.layer.kind.text",
	image: "canvas.layer.kind.image",
	"ai-placeholder": "canvas.layer.kind.aiPlaceholder",
};

const KIND_LABEL_FALLBACKS: Record<CanvasNodeKind, string> = {
	group: "Group",
	frame: "Frame",
	rect: "Rectangle",
	ellipse: "Ellipse",
	line: "Line",
	path: "Path",
	text: "Text",
	image: "Image",
	"ai-placeholder": "AI placeholder",
};

function nodeLabel(
	node: CanvasNode,
	t: CanvasT,
	kindInspectors?: Readonly<Record<string, { label?: string }>>,
): string {
	if (node.name && node.name.length > 0) return node.name;
	const kind = node.type as string;
	const key = (KIND_LABEL_KEYS as Record<string, string>)[kind];
	if (key) {
		return t(key, (KIND_LABEL_FALLBACKS as Record<string, string>)[kind]);
	}
	// Custom (extension) kind: registered inspector label, else the raw kind.
	return kindInspectors?.[kind]?.label ?? kind;
}

export interface LayerPanelProps {
	/** Optional id attribute for layout anchoring. */
	id?: string;
}

export function LayerPanel({ id }: LayerPanelProps): React.JSX.Element | null {
	const ctx = useCanvasStudio();
	const t = useCanvasT();
	const selectedIds = useSyncExternalStore(
		ctx.selectionStore.subscribe,
		() => ctx.selectionStore.getState().selectedIds,
		() => ctx.selectionStore.getState().selectedIds,
	);
	const activePage: CanvasPage | undefined = ctx.ir.pages.find(
		(p) => p.id === ctx.activePageId,
	);
	const rows = useMemo(
		() => (activePage ? flattenChildren(activePage.root) : []),
		[activePage],
	);
	const selectedSet = useMemo(() => new Set(selectedIds), [selectedIds]);
	const canGroup = useMemo(
		() => canGroupSelection(ctx.ir, selectedIds),
		[ctx.ir, selectedIds],
	);
	const canUngroup = useMemo(
		() => canUngroupSelection(ctx.ir, selectedIds),
		[ctx.ir, selectedIds],
	);

	const handleSelect = useCallback(
		(nodeId: string, event: React.MouseEvent) => {
			const sel = ctx.selectionStore.getState();
			if (event.shiftKey) {
				sel.toggleSelection(nodeId);
			} else {
				sel.setSelection([nodeId]);
			}
		},
		[ctx.selectionStore],
	);

	const handleToggleVisibility = useCallback(
		(node: CanvasNode) => {
			const cmd = {
				type: "node.update",
				nodeId: node.id,
				kind: node.type,
				patch: { visible: node.visible === false },
			} as CanvasAnyNodeUpdateCommand;
			ctx.commit(cmd);
		},
		[ctx],
	);

	const handleToggleLock = useCallback(
		(node: CanvasNode) => {
			const cmd = {
				type: "node.update",
				nodeId: node.id,
				kind: node.type,
				patch: { locked: !node.locked },
			} as CanvasAnyNodeUpdateCommand;
			ctx.commit(cmd);
		},
		[ctx],
	);

	const handleKeyDown = useCallback(
		(event: React.KeyboardEvent) => {
			if (event.metaKey || event.ctrlKey) {
				if (event.key === "g" || event.key === "G") {
					event.preventDefault();
					if (event.shiftKey) {
						ungroupSelection(ctx);
					} else {
						groupSelection(ctx);
					}
					return;
				}
			}
			if (rows.length === 0) return;
			const currentIndex = selectedIds[0]
				? rows.findIndex((r) => r.node.id === selectedIds[0])
				: -1;
			if (event.key === "ArrowDown") {
				event.preventDefault();
				const next = rows[Math.min(currentIndex + 1, rows.length - 1)];
				if (next) ctx.selectionStore.getState().setSelection([next.node.id]);
			} else if (event.key === "ArrowUp") {
				event.preventDefault();
				const prev = rows[Math.max(currentIndex - 1, 0)];
				if (prev) ctx.selectionStore.getState().setSelection([prev.node.id]);
			} else if (event.key === "Delete" || event.key === "Backspace") {
				event.preventDefault();
				for (const targetId of selectedIds) {
					ctx.commit({ type: "node.delete", nodeId: targetId });
				}
				ctx.selectionStore.getState().clearSelection();
			}
		},
		[ctx, rows, selectedIds],
	);

	// Stable row renderer for `Windowed` (W5). Identity changes on selection so
	// rows reflect `data-selected`; below the virtualization threshold this is the
	// same DOM the old inline `.map()` produced (keyed Fragments add no nodes).
	const renderRow = useCallback(
		({ node, depth }: FlatRow): React.JSX.Element => {
			const isSelected = selectedSet.has(node.id);
			const visible = node.visible !== false;
			const locked = node.locked === true;
			return (
				<div
					key={node.id}
					data-testid={`layer-row-${node.id}`}
					data-selected={isSelected ? "true" : "false"}
					className={cn(
						"flex h-7 items-center gap-1 rounded-md pr-1 text-[13px]",
						"cursor-pointer hover:bg-muted",
						isSelected
							? "bg-accent text-accent-foreground hover:bg-accent"
							: "text-foreground",
					)}
					style={{ paddingLeft: ROW_PAD_X + depth * INDENT_PX }}
					onClick={(e) => handleSelect(node.id, e)}
					onKeyDown={(e) => {
						if (e.key === "Enter" || e.key === " ") {
							e.preventDefault();
							handleSelect(node.id, e as unknown as React.MouseEvent);
						}
					}}
					role="treeitem"
					aria-selected={isSelected}
					tabIndex={-1}
				>
					<span className="flex-1 truncate">
						{nodeLabel(node, t, ctx.kindInspectors)}
					</span>
					<Button
						type="button"
						variant="ghost"
						size="icon-xs"
						className={cn(
							"size-6",
							visible ? "text-muted-foreground" : "text-muted-foreground/40",
						)}
						data-testid={`layer-row-${node.id}-visibility`}
						aria-label={
							visible
								? t("canvas.layer.hide", "Hide layer")
								: t("canvas.layer.show", "Show layer")
						}
						title={
							visible
								? t("canvas.layer.hideShort", "Hide")
								: t("canvas.layer.showShort", "Show")
						}
						onClick={(e) => {
							e.stopPropagation();
							handleToggleVisibility(node);
						}}
					>
						{visible ? <Eye aria-hidden /> : <EyeOff aria-hidden />}
					</Button>
					<Button
						type="button"
						variant="ghost"
						size="icon-xs"
						className={cn(
							"size-6",
							locked ? "text-foreground" : "text-muted-foreground/40",
						)}
						data-testid={`layer-row-${node.id}-lock`}
						aria-label={
							locked
								? t("canvas.layer.unlock", "Unlock layer")
								: t("canvas.layer.lock", "Lock layer")
						}
						title={
							locked
								? t("canvas.layer.unlockShort", "Unlock")
								: t("canvas.layer.lockShort", "Lock")
						}
						onClick={(e) => {
							e.stopPropagation();
							handleToggleLock(node);
						}}
					>
						{locked ? <Lock aria-hidden /> : <LockOpen aria-hidden />}
					</Button>
				</div>
			);
		},
		[selectedSet, t, handleSelect, handleToggleVisibility, handleToggleLock],
	);

	return (
		<div
			data-testid="layer-panel"
			className="flex h-full min-w-[220px] max-w-[320px] flex-col bg-card text-sm text-foreground select-none focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:ring-inset"
			tabIndex={0}
			onKeyDown={handleKeyDown}
			{...(id !== undefined ? { id } : {})}
		>
			<div className="flex h-9 items-center gap-1 border-b border-border px-3">
				<span className="flex-1 text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">
					{t("canvas.layer.title", "Layers")}
				</span>
				<Button
					type="button"
					variant="ghost"
					size="icon-xs"
					data-testid="layer-group-btn"
					aria-label={t("canvas.layer.groupSelection", "Group selection")}
					title={t("canvas.layer.groupSelectionTitle", "Group selection (⌘G)")}
					disabled={!canGroup}
					onClick={() => groupSelection(ctx)}
				>
					<GroupIcon aria-hidden />
				</Button>
				<Button
					type="button"
					variant="ghost"
					size="icon-xs"
					data-testid="layer-ungroup-btn"
					aria-label={t("canvas.layer.ungroup", "Ungroup")}
					title={t("canvas.layer.ungroupTitle", "Ungroup (⌘⇧G)")}
					disabled={!canUngroup}
					onClick={() => ungroupSelection(ctx)}
				>
					<Ungroup aria-hidden />
				</Button>
			</div>
			<div
				className="flex-1 overflow-y-auto p-1.5"
				role="tree"
				aria-label={t("canvas.layer.title", "Layers")}
			>
				{rows.length === 0 ? (
					<div
						className="px-2 py-1.5 text-xs text-muted-foreground italic"
						data-testid="layer-panel-empty"
					>
						{t("canvas.layer.empty", "No layers on this page yet.")}
					</div>
				) : (
					// Virtualized (W5): below 50 layers this is identical DOM to the old
					// inline map (keyed Fragments add no nodes); above it only the
					// visible window mounts, so a 1000-layer page stops rendering 1000
					// rows. The outer `role="tree"` container stays the scroll owner.
					<Windowed
						items={rows}
						renderItem={renderRow}
						itemKey={(row) => row.node.id}
						estimateSize={28}
						maxHeight={600}
						data-testid="layer-rows"
					/>
				)}
			</div>
		</div>
	);
}
