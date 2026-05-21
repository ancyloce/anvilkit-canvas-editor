"use client";

import {
	type CanvasAnyNodeUpdateCommand,
	type CanvasGroupNode,
	type CanvasNode,
	type CanvasNodeKind,
	type CanvasPage,
	isGroupNode,
} from "@anvilkit/canvas-core";
import { useCallback, useMemo, useSyncExternalStore } from "react";
import { useCanvasStudio } from "../context/canvas-studio-context.js";

const ROW_HEIGHT = 28;
const INDENT_PX = 14;
const PADDING_X = 8;

const styles = {
	root: {
		display: "flex",
		flexDirection: "column",
		minWidth: 220,
		maxWidth: 320,
		height: "100%",
		borderRight: "1px solid #e5e7eb",
		background: "#ffffff",
		fontFamily:
			"ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
		fontSize: 12,
		userSelect: "none",
		outline: "none",
	} as const,
	header: {
		display: "flex",
		alignItems: "center",
		height: ROW_HEIGHT,
		padding: `0 ${PADDING_X}px`,
		borderBottom: "1px solid #e5e7eb",
		background: "#f9fafb",
		fontWeight: 600,
		color: "#374151",
	} as const,
	list: {
		flex: 1,
		overflowY: "auto",
		paddingBottom: 4,
	} as const,
	row: {
		display: "flex",
		alignItems: "center",
		height: ROW_HEIGHT,
		padding: `0 ${PADDING_X}px`,
		cursor: "pointer",
		color: "#374151",
		gap: 4,
	} as const,
	rowSelected: {
		background: "#dbeafe",
		color: "#1e3a8a",
	} as const,
	rowLabel: {
		flex: 1,
		whiteSpace: "nowrap",
		overflow: "hidden",
		textOverflow: "ellipsis",
	} as const,
	iconButton: {
		display: "inline-flex",
		alignItems: "center",
		justifyContent: "center",
		width: 20,
		height: 20,
		border: "none",
		background: "transparent",
		color: "#6b7280",
		cursor: "pointer",
		borderRadius: 3,
		padding: 0,
		font: "inherit",
		lineHeight: 1,
	} as const,
	iconButtonDim: {
		color: "#cbd5e1",
	} as const,
	empty: {
		padding: PADDING_X,
		color: "#9ca3af",
		fontStyle: "italic",
	} as const,
} as const;

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
			style={styles.root}
			tabIndex={0}
			onKeyDown={handleKeyDown}
			{...(id !== undefined ? { id } : {})}
		>
			<div style={styles.header}>Layers</div>
			<div style={styles.list}>
				{rows.length === 0 ? (
					<div style={styles.empty} data-testid="layer-panel-empty">
						No layers on this page yet.
					</div>
				) : (
					rows.map(({ node, depth }) => {
						const isSelected = selectedSet.has(node.id);
						const rowStyle = isSelected
							? { ...styles.row, ...styles.rowSelected }
							: styles.row;
						const visible = node.visible !== false;
						const locked = node.locked === true;
						return (
							<div
								key={node.id}
								data-testid={`layer-row-${node.id}`}
								data-selected={isSelected ? "true" : "false"}
								style={{
									...rowStyle,
									paddingLeft: PADDING_X + depth * INDENT_PX,
								}}
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
								<span style={styles.rowLabel}>{nodeLabel(node)}</span>
								<button
									type="button"
									style={{
										...styles.iconButton,
										...(visible ? {} : styles.iconButtonDim),
									}}
									data-testid={`layer-row-${node.id}-visibility`}
									aria-label={visible ? "Hide layer" : "Show layer"}
									title={visible ? "Hide" : "Show"}
									onClick={(e) => {
										e.stopPropagation();
										handleToggleVisibility(node);
									}}
								>
									{visible ? "○" : "✕"}
								</button>
								<button
									type="button"
									style={{
										...styles.iconButton,
										...(locked ? {} : styles.iconButtonDim),
									}}
									data-testid={`layer-row-${node.id}-lock`}
									aria-label={locked ? "Unlock layer" : "Lock layer"}
									title={locked ? "Unlock" : "Lock"}
									onClick={(e) => {
										e.stopPropagation();
										handleToggleLock(node);
									}}
								>
									{locked ? "■" : "□"}
								</button>
							</div>
						);
					})
				)}
			</div>
		</div>
	);
}
