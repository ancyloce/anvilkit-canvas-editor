"use client";

import {
	type CanvasAnyNodeUpdateCommand,
	type CanvasCommand,
	type CanvasGroupNode,
	type CanvasNode,
	type CanvasNodeKind,
	type CanvasPage,
	findNode,
	isContainerNode,
	parentOf,
} from "@anvilkit/canvas-core";
import { Button } from "@anvilkit/ui/button";
import { Input } from "@anvilkit/ui/input";
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
import {
	useCallback,
	useEffect,
	useMemo,
	useRef,
	useState,
	useSyncExternalStore,
} from "react";
import { useCanvasActions } from "../actions/editor-actions.js";
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
import {
	EMPTY_LAYER_FILTER,
	findLayers,
	isEmptyLayerFilter,
	type LayerFilter,
	matchesLayerFilter,
	revealLayer,
} from "./layer-filter.js";

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
	polygon: "canvas.layer.kind.polygon",
	star: "canvas.layer.kind.star",
	line: "canvas.layer.kind.line",
	path: "canvas.layer.kind.path",
	text: "canvas.layer.kind.text",
	"rich-text": "canvas.layer.kind.richText",
	image: "canvas.layer.kind.image",
	svg: "canvas.layer.kind.svg",
	"ai-placeholder": "canvas.layer.kind.aiPlaceholder",
	video: "canvas.layer.kind.video",
	audio: "canvas.layer.kind.audio",
};

const KIND_LABEL_FALLBACKS: Record<CanvasNodeKind, string> = {
	group: "Group",
	frame: "Frame",
	rect: "Rectangle",
	ellipse: "Ellipse",
	polygon: "Polygon",
	star: "Star",
	line: "Line",
	path: "Path",
	text: "Text",
	"rich-text": "Rich text",
	image: "Image",
	svg: "SVG",
	"ai-placeholder": "AI placeholder",
	video: "Video",
	audio: "Audio",
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

/** Where a drag is hovering relative to a row (A-08 FR-052). */
type DropZone = "before" | "after" | "inside";

interface DropState {
	targetId: string;
	zone: DropZone;
	valid: boolean;
}

/**
 * Visual→structural translation: the panel renders TOPMOST first, while
 * `children` stores bottom-first. Dropping visually ABOVE a row means a
 * HIGHER stacking index. Indices are computed on the target's children with
 * the dragged ids removed, matching `node.reparent`'s remove-then-insert.
 */
function insertionIndex(
	parentChildren: readonly CanvasNode[],
	targetId: string,
	zone: "before" | "after",
	draggedIds: ReadonlySet<string>,
): number {
	const remaining = parentChildren.filter((c) => !draggedIds.has(c.id));
	const idx = remaining.findIndex((c) => c.id === targetId);
	if (idx < 0) return remaining.length;
	return zone === "before" ? idx + 1 : idx;
}

export interface LayerPanelProps {
	/** Optional id attribute for layout anchoring. */
	id?: string;
}

export function LayerPanel({ id }: LayerPanelProps): React.JSX.Element | null {
	const ctx = useCanvasStudio();
	const actions = useCanvasActions();
	const t = useCanvasT();
	const selectedIds = useSyncExternalStore(
		ctx.selectionStore.subscribe,
		() => ctx.selectionStore.getState().selectedIds,
		() => ctx.selectionStore.getState().selectedIds,
	);
	const activePage: CanvasPage | undefined = ctx.ir.pages.find(
		(p) => p.id === ctx.activePageId,
	);
	const allRows = useMemo(
		() => (activePage ? flattenChildren(activePage.root) : []),
		[activePage],
	);

	// FR-053 layer search (C-08): pure, non-mutating row filter. While a
	// filter is active, drag-and-drop is disabled — reordering against an
	// incomplete view invites accidental structure changes.
	const [filter, setFilter] = useState<LayerFilter>(EMPTY_LAYER_FILTER);
	const [searchScope, setSearchScope] = useState<"page" | "document">("page");
	const filterActive = !isEmptyLayerFilter(filter);
	const rows = useMemo(
		() =>
			filterActive
				? allRows.filter((row) => matchesLayerFilter(row.node, filter))
				: allRows,
		[allRows, filterActive, filter],
	);
	// FR-191 find layer: document-scoped results across every page.
	const findResults = useMemo(
		() =>
			searchScope === "document" && filterActive
				? findLayers(ctx.ir, filter)
				: null,
		[searchScope, filterActive, ctx.ir, filter],
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

	// FR-051 selection model: click = replace, Ctrl/Cmd = toggle, Shift =
	// range from the last plain-clicked anchor within the flattened rows.
	const anchorRef = useRef<string | null>(null);
	const [renamingId, setRenamingId] = useState<string | null>(null);
	const [dropState, setDropState] = useState<DropState | null>(null);
	const draggedIdsRef = useRef<readonly string[]>([]);

	const handleSelect = useCallback(
		(nodeId: string, event: React.MouseEvent) => {
			const sel = ctx.selectionStore.getState();
			if (event.metaKey || event.ctrlKey) {
				sel.toggleSelection(nodeId);
				anchorRef.current = nodeId;
				return;
			}
			// Shift-range anchors on the last plain-clicked row, falling back to
			// the current selection head (e.g. a canvas-made selection).
			const anchorId = anchorRef.current ?? selectedIds[0] ?? null;
			if (event.shiftKey && anchorId) {
				const a = rows.findIndex((r) => r.node.id === anchorId);
				const b = rows.findIndex((r) => r.node.id === nodeId);
				if (a >= 0 && b >= 0) {
					const [lo, hi] = a <= b ? [a, b] : [b, a];
					sel.setSelection(rows.slice(lo, hi + 1).map((r) => r.node.id));
					return;
				}
			}
			sel.setSelection([nodeId]);
			anchorRef.current = nodeId;
		},
		[ctx.selectionStore, rows, selectedIds],
	);

	// FR-051 auto-reveal: bring the first selected row into view when the
	// selection changes from elsewhere (canvas click). Virtualized rows that
	// aren't mounted (and jsdom, which lacks scrollIntoView) are skipped.
	const firstSelectedId = selectedIds[0];
	useEffect(() => {
		if (!firstSelectedId) return;
		const el = document.querySelector(
			`[data-testid="layer-row-${firstSelectedId}"]`,
		);
		if (el && typeof (el as HTMLElement).scrollIntoView === "function") {
			(el as HTMLElement).scrollIntoView({ block: "nearest" });
		}
	}, [firstSelectedId]);

	// FR-031 "Rename layer" from the node context menu: consume a rename
	// request posted by the menu, reveal the row, and enter inline rename.
	const layerRenameStore = ctx.layerRenameStore;
	useEffect(() => {
		if (!layerRenameStore) return;
		return layerRenameStore.subscribe(() => {
			const id = layerRenameStore.getState().consume();
			if (!id) return;
			setRenamingId(id);
			const el = document.querySelector(`[data-testid="layer-row-${id}"]`);
			if (el && typeof (el as HTMLElement).scrollIntoView === "function") {
				(el as HTMLElement).scrollIntoView({ block: "nearest" });
			}
		});
	}, [layerRenameStore]);

	const commitRename = useCallback(
		(node: CanvasNode, name: string) => {
			setRenamingId(null);
			const trimmed = name.trim();
			if (trimmed === (node.name ?? "")) return;
			ctx.commit({
				type: "node.update",
				nodeId: node.id,
				kind: node.type,
				patch: { name: trimmed },
			} as CanvasAnyNodeUpdateCommand);
		},
		[ctx],
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

	// ── FR-052 drag and drop ──────────────────────────────────────────────────

	const isValidDrop = useCallback(
		(targetId: string, zone: DropZone): boolean => {
			const ir = ctx.getIR();
			const dragged = draggedIdsRef.current;
			if (dragged.length === 0) return false;
			if (dragged.includes(targetId)) return false;
			// Descendant guard: the target (or, for before/after, its parent
			// chain) must not sit inside any dragged subtree.
			let cursor: string | null = targetId;
			while (cursor) {
				if (dragged.includes(cursor)) return false;
				const parentResult = parentOf(ir, cursor);
				cursor = parentResult ? parentResult.parent.id : null;
			}
			if (zone === "inside") {
				const target = findNode(ir, targetId);
				return !!target && isContainerNode(target.node);
			}
			return true;
		},
		[ctx],
	);

	const handleDragStart = useCallback(
		(node: CanvasNode, e: React.DragEvent) => {
			// Locked nodes never move (FR-052); dragging a selected row drags the
			// whole selection minus locked members.
			const ir = ctx.getIR();
			const base = selectedSet.has(node.id) ? selectedIds : [node.id];
			const dragged = base.filter(
				(dragId) => findNode(ir, dragId)?.node.locked !== true,
			);
			draggedIdsRef.current = dragged;
			if (dragged.length === 0) {
				e.preventDefault();
				return;
			}
			e.dataTransfer?.setData("text/plain", dragged.join(","));
		},
		[ctx, selectedIds, selectedSet],
	);

	const handleDragOver = useCallback(
		(node: CanvasNode, e: React.DragEvent) => {
			if (draggedIdsRef.current.length === 0) return;
			e.preventDefault(); // required to allow dropping
			const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
			const container = isContainerNode(node);
			let zone: DropZone;
			if (rect.height <= 0) {
				// jsdom / unmeasured rows: containers accept "inside", leaves "before".
				zone = container ? "inside" : "before";
			} else {
				const y = e.clientY - rect.top;
				if (container && y > rect.height / 4 && y < (rect.height * 3) / 4) {
					zone = "inside";
				} else {
					zone = y < rect.height / 2 ? "before" : "after";
				}
			}
			const valid = isValidDrop(node.id, zone);
			setDropState((prev) =>
				prev?.targetId === node.id && prev.zone === zone && prev.valid === valid
					? prev
					: { targetId: node.id, zone, valid },
			);
		},
		[isValidDrop],
	);

	const handleDrop = useCallback(
		(node: CanvasNode, e: React.DragEvent) => {
			e.preventDefault();
			const dragged = draggedIdsRef.current;
			const state = dropState;
			draggedIdsRef.current = [];
			setDropState(null);
			if (!state || state.targetId !== node.id || !state.valid) return;
			const ir = ctx.getIR();
			const draggedSet = new Set(dragged);
			const cmds: CanvasCommand[] = [];
			if (state.zone === "inside") {
				const target = findNode(ir, node.id);
				if (!target || !isContainerNode(target.node)) return;
				// Drop "inside" lands on TOP of the container's stack.
				let index = target.node.children.filter(
					(c) => !draggedSet.has(c.id),
				).length;
				for (const dragId of dragged) {
					cmds.push({
						type: "node.reparent",
						nodeId: dragId,
						toParentId: node.id,
						toIndex: index,
					});
					index += 1;
				}
			} else {
				const parentResult = parentOf(ir, node.id);
				if (!parentResult) return;
				let index = insertionIndex(
					parentResult.parent.children,
					node.id,
					state.zone,
					draggedSet,
				);
				for (const dragId of dragged) {
					cmds.push({
						type: "node.reparent",
						nodeId: dragId,
						toParentId: parentResult.parent.id,
						toIndex: index,
					});
					index += 1;
				}
			}
			if (cmds.length === 0) return;
			const first = cmds[0];
			if (cmds.length === 1 && first) ctx.commit(first);
			else ctx.commitBatch(cmds, "Move layers");
			ctx.selectionStore.getState().setSelection([...dragged]);
		},
		[ctx, dropState],
	);

	const handleDragEnd = useCallback(() => {
		draggedIdsRef.current = [];
		setDropState(null);
	}, []);

	const handleKeyDown = useCallback(
		(event: React.KeyboardEvent) => {
			if (renamingId) return; // the rename input owns the keyboard
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
				// FR-024/AC-005: route through the action layer so a multi-selection
				// deletes as ONE undo entry, locked nodes are protected (with a
				// toast), and ancestor+descendant selections are de-duplicated —
				// the raw per-node commit loop did none of these.
				actions.deleteSelection();
			}
		},
		[actions, rows, selectedIds, renamingId, ctx],
	);

	// Stable row renderer for `Windowed` (W5). Identity changes on selection so
	// rows reflect `data-selected`; below the virtualization threshold this is the
	// same DOM the old inline `.map()` produced (keyed Fragments add no nodes).
	const renderRow = useCallback(
		({ node, depth }: FlatRow): React.JSX.Element => {
			const isSelected = selectedSet.has(node.id);
			const visible = node.visible !== false;
			const locked = node.locked === true;
			const isRenaming = renamingId === node.id;
			const drop = dropState?.targetId === node.id ? dropState : null;
			return (
				<div
					key={node.id}
					data-testid={`layer-row-${node.id}`}
					data-selected={isSelected ? "true" : "false"}
					{...(drop
						? {
								"data-drop-zone": drop.zone,
								"data-drop-valid": drop.valid ? "true" : "false",
							}
						: {})}
					className={cn(
						"flex h-7 items-center gap-1 rounded-md pr-1 text-[13px]",
						"cursor-pointer hover:bg-muted",
						isSelected
							? "bg-accent text-accent-foreground hover:bg-accent"
							: "text-foreground",
						// FR-052 insertion preview / invalid-drop feedback.
						drop &&
							drop.valid &&
							drop.zone === "before" &&
							"shadow-[inset_0_2px_0_0_var(--color-primary)]",
						drop &&
							drop.valid &&
							drop.zone === "after" &&
							"shadow-[inset_0_-2px_0_0_var(--color-primary)]",
						drop &&
							drop.valid &&
							drop.zone === "inside" &&
							"ring-1 ring-primary ring-inset",
						drop && !drop.valid && "opacity-50",
					)}
					style={{ paddingLeft: ROW_PAD_X + depth * INDENT_PX }}
					draggable={!locked && !isRenaming && !filterActive}
					onDragStart={(e) => handleDragStart(node, e)}
					onDragOver={(e) => handleDragOver(node, e)}
					onDrop={(e) => handleDrop(node, e)}
					onDragEnd={handleDragEnd}
					onClick={(e) => handleSelect(node.id, e)}
					onDoubleClick={(e) => {
						e.stopPropagation();
						setRenamingId(node.id);
					}}
					onKeyDown={(e) => {
						if (!isRenaming && (e.key === "Enter" || e.key === " ")) {
							e.preventDefault();
							handleSelect(node.id, e as unknown as React.MouseEvent);
						}
					}}
					role="treeitem"
					aria-selected={isSelected}
					tabIndex={-1}
				>
					{isRenaming ? (
						<Input
							autoFocus
							defaultValue={node.name ?? ""}
							data-testid={`layer-rename-${node.id}`}
							aria-label={t("canvas.layer.rename", "Rename layer")}
							className="h-5 flex-1 px-1 text-[13px]"
							onClick={(e) => e.stopPropagation()}
							onDoubleClick={(e) => e.stopPropagation()}
							onBlur={(e) => commitRename(node, e.currentTarget.value)}
							onKeyDown={(e) => {
								e.stopPropagation();
								if (e.key === "Enter") {
									commitRename(node, e.currentTarget.value);
								} else if (e.key === "Escape") {
									setRenamingId(null);
								}
							}}
						/>
					) : (
						<span className="flex-1 truncate">
							{nodeLabel(node, t, ctx.kindInspectors)}
						</span>
					)}
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
		[
			selectedSet,
			t,
			handleSelect,
			handleToggleVisibility,
			handleToggleLock,
			ctx.kindInspectors,
			renamingId,
			dropState,
			commitRename,
			handleDragStart,
			handleDragOver,
			handleDrop,
			handleDragEnd,
			filterActive,
		],
	);

	return (
		<div
			data-testid="layer-panel"
			className="flex h-full min-w-[220px] max-w-[320px] flex-col bg-card text-sm text-foreground select-none focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:ring-inset"
			role="group"
			aria-label={t("canvas.layer.title", "Layers")}
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
			<div className="flex flex-col gap-1 border-b border-border p-1.5">
				<Input
					data-testid="layer-search"
					placeholder={t("canvas.layer.searchPlaceholder", "Search layers…")}
					value={filter.query}
					onChange={(e) =>
						setFilter((prev) => ({ ...prev, query: e.currentTarget.value }))
					}
					className="h-7 text-xs"
				/>
				{filterActive ? (
					<div className="flex gap-1">
						<Button
							type="button"
							variant={filter.visibility === "all" ? "ghost" : "secondary"}
							size="sm"
							className="h-6 flex-1 px-1 text-[11px]"
							data-testid="layer-filter-visibility"
							onClick={() =>
								setFilter((prev) => ({
									...prev,
									visibility:
										prev.visibility === "all"
											? "visible"
											: prev.visibility === "visible"
												? "hidden"
												: "all",
								}))
							}
						>
							{filter.visibility === "visible"
								? t("canvas.layer.filterVisible", "Visible")
								: filter.visibility === "hidden"
									? t("canvas.layer.filterHidden", "Hidden")
									: t("canvas.layer.filterVisibilityAll", "Any visibility")}
						</Button>
						<Button
							type="button"
							variant={filter.lock === "all" ? "ghost" : "secondary"}
							size="sm"
							className="h-6 flex-1 px-1 text-[11px]"
							data-testid="layer-filter-lock"
							onClick={() =>
								setFilter((prev) => ({
									...prev,
									lock:
										prev.lock === "all"
											? "locked"
											: prev.lock === "locked"
												? "unlocked"
												: "all",
								}))
							}
						>
							{filter.lock === "locked"
								? t("canvas.layer.filterLocked", "Locked")
								: filter.lock === "unlocked"
									? t("canvas.layer.filterUnlocked", "Unlocked")
									: t("canvas.layer.filterLockAll", "Any lock state")}
						</Button>
						<Button
							type="button"
							variant={searchScope === "document" ? "secondary" : "ghost"}
							size="sm"
							className="h-6 flex-1 px-1 text-[11px]"
							data-testid="layer-search-scope"
							onClick={() =>
								setSearchScope((prev) =>
									prev === "page" ? "document" : "page",
								)
							}
						>
							{searchScope === "document"
								? t("canvas.layer.scopeDocument", "All pages")
								: t("canvas.layer.scopePage", "This page")}
						</Button>
					</div>
				) : null}
			</div>
			{findResults ? (
				// FR-191 find layer: flat cross-page results; picking one switches
				// page, selects, zooms, and reveals the row.
				<div
					className="flex-1 overflow-y-auto p-1.5"
					data-testid="layer-find-results"
				>
					{findResults.length === 0 ? (
						<div
							className="px-2 py-1.5 text-xs text-muted-foreground italic"
							data-testid="layer-find-no-results"
						>
							{t("canvas.layer.noMatches", "No layers match.")}
						</div>
					) : (
						findResults.map((result) => (
							<button
								type="button"
								key={`${result.pageId}-${result.node.id}`}
								data-testid={`layer-find-result-${result.node.id}`}
								className="flex h-7 w-full items-center gap-2 rounded-md px-2 text-left text-[13px] hover:bg-muted"
								onClick={() => revealLayer(ctx, result)}
							>
								<span className="flex-1 truncate">
									{nodeLabel(result.node, t, ctx.kindInspectors)}
								</span>
								<span className="text-[11px] text-muted-foreground">
									{result.pageName ??
										t("canvas.layer.pageN", "Page {n}").replace(
											"{n}",
											String(result.pageIndex + 1),
										)}
								</span>
							</button>
						))
					)}
				</div>
			) : (
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
							{filterActive
								? t("canvas.layer.noMatches", "No layers match.")
								: t("canvas.layer.empty", "No layers on this page yet.")}
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
			)}
		</div>
	);
}
