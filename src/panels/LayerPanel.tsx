"use client";

import {
	type CanvasAnyNodeUpdateCommand,
	type CanvasGroupNode,
	type CanvasNode,
	type CanvasNodeKind,
	type CanvasPage,
	isGroupNode,
} from "@anvilkit/canvas-core";
import { Button } from "@anvilkit/ui/button";
import { cn } from "@anvilkit/ui/lib/utils";
import {
	Eye,
	EyeOff,
	Group as GroupIcon,
	Lock,
	LockOpen,
	Ungroup,
} from "lucide-react";
import { useCallback, useMemo, useSyncExternalStore } from "react";
import { useCanvasStudio } from "../context/canvas-studio-context.js";
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
			if (isGroupNode(child)) {
				walk(child.children, depth + 1);
			}
		}
	};
	walk(group.children, 0);
	return rows;
}

function nodeLabel(node: CanvasNode): string {
	if (node.name && node.name.length > 0) return node.name;
	const kindLabels: Record<CanvasNodeKind, string> = {
		group: "Group",
		rect: "Rectangle",
		ellipse: "Ellipse",
		line: "Line",
		path: "Path",
		text: "Text",
		image: "Image",
		"ai-placeholder": "AI placeholder",
	};
	return kindLabels[node.type];
}

export interface LayerPanelProps {
	/** Optional id attribute for layout anchoring. */
	id?: string;
}

export function LayerPanel({ id }: LayerPanelProps): React.JSX.Element | null {
	const ctx = useCanvasStudio();
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
					Layers
				</span>
				<Button
					type="button"
					variant="ghost"
					size="icon-xs"
					data-testid="layer-group-btn"
					aria-label="Group selection"
					title="Group selection (⌘G)"
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
					aria-label="Ungroup"
					title="Ungroup (⌘⇧G)"
					disabled={!canUngroup}
					onClick={() => ungroupSelection(ctx)}
				>
					<Ungroup aria-hidden />
				</Button>
			</div>
			<div
				className="flex-1 overflow-y-auto p-1.5"
				role="tree"
				aria-label="Layers"
			>
				{rows.length === 0 ? (
					<div
						className="px-2 py-1.5 text-xs text-muted-foreground italic"
						data-testid="layer-panel-empty"
					>
						No layers on this page yet.
					</div>
				) : (
					rows.map(({ node, depth }) => {
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
								<span className="flex-1 truncate">{nodeLabel(node)}</span>
								<Button
									type="button"
									variant="ghost"
									size="icon-xs"
									className={cn(
										"size-6",
										visible
											? "text-muted-foreground"
											: "text-muted-foreground/40",
									)}
									data-testid={`layer-row-${node.id}-visibility`}
									aria-label={visible ? "Hide layer" : "Show layer"}
									title={visible ? "Hide" : "Show"}
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
									aria-label={locked ? "Unlock layer" : "Lock layer"}
									title={locked ? "Unlock" : "Lock"}
									onClick={(e) => {
										e.stopPropagation();
										handleToggleLock(node);
									}}
								>
									{locked ? <Lock aria-hidden /> : <LockOpen aria-hidden />}
								</Button>
							</div>
						);
					})
				)}
			</div>
		</div>
	);
}
