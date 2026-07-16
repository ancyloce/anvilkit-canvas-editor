"use client";

import { findNode } from "@anvilkit/canvas-core";
import {
	ContextMenu,
	ContextMenuContent,
	ContextMenuItem,
	ContextMenuSeparator,
	ContextMenuTrigger,
} from "@anvilkit/ui/context-menu";
import type Konva from "konva";
import { type ReactNode, useState } from "react";
import { useCanvasActions } from "../../actions/editor-actions.js";
import {
	type CanvasStudioContextValue,
	useCanvasStudio,
	useCanvasT,
} from "../../context/canvas-studio-context.js";
import {
	canGroupSelection,
	canUngroupSelection,
} from "../../selection/group-actions.js";
import {
	enterIsolationImpl,
	progressiveSelectAllImpl,
} from "../../selection/isolation.js";

export interface CanvasAreaContextMenuProps {
	children: ReactNode;
	/**
	 * Resolves the right-clicked node id, or null for empty canvas space.
	 * Defaults to a Konva stage intersection lookup; injectable because jsdom
	 * has no canvas hit graph.
	 */
	resolveContextTarget?: (
		e: React.MouseEvent<HTMLElement>,
		ctx: CanvasStudioContextValue,
	) => string | null;
}

/**
 * Climb from the intersected Konva shape to the first ancestor whose Konva
 * `name` is a real IR node id (renderers name their Konva nodes by node id —
 * the same convention `measureSelection` relies on).
 */
function defaultResolveContextTarget(
	e: React.MouseEvent<HTMLElement>,
	ctx: CanvasStudioContextValue,
): string | null {
	const stage = ctx.stage;
	if (!stage || typeof stage.getIntersection !== "function") return null;
	try {
		stage.setPointersPositions(e.nativeEvent);
		const pos = stage.getPointerPosition();
		if (!pos) return null;
		const shape = stage.getIntersection(pos);
		let current: Konva.Node | null = shape;
		const ir = ctx.getIR();
		while (current) {
			const name = current.name();
			if (name && findNode(ir, name)) return name;
			current = current.getParent();
		}
		return null;
	} catch {
		return null;
	}
}

/**
 * Right-click menus for the canvas area (A-06, FR-030/FR-031): empty space
 * gets the CANVAS menu (paste, select-all, grid toggle), a node gets the NODE
 * menu (clipboard, layer order, group, lock) — every entry dispatches through
 * the unified action layer. Actions unavailable in the current selection
 * state render disabled, never hidden (FR-031); entries whose features ship
 * in a later phase (rulers/guides, copy style, rename, export selection,
 * zoom presets) are absent until those phases land (FR-030 note).
 */
export function CanvasAreaContextMenu({
	children,
	resolveContextTarget,
}: CanvasAreaContextMenuProps): React.JSX.Element {
	const ctx = useCanvasStudio();
	const actions = useCanvasActions();
	const t = useCanvasT();
	const [target, setTarget] = useState<"canvas" | "node">("canvas");

	const selectedIds = ctx.selectionStore.getState().selectedIds;
	const allLocked =
		selectedIds.length > 0 &&
		selectedIds.every((id) => findNode(ctx.ir, id)?.node.locked === true);

	const onContextMenu = (e: React.MouseEvent<HTMLElement>): void => {
		const hit = (resolveContextTarget ?? defaultResolveContextTarget)(e, ctx);
		if (hit) {
			const selection = ctx.selectionStore.getState();
			if (!selection.selectedIds.includes(hit)) {
				selection.setSelection([hit]);
			}
			setTarget("node");
		} else {
			setTarget("canvas");
		}
	};

	// FR-190 progressive select-all (C-09): scope-aware, expands outward when
	// the current scope is already fully selected.
	const selectAll = (): void => progressiveSelectAllImpl(ctx);
	const isolationActive = (ctx.isolationStore?.getState().path.length ?? 0) > 0;
	const primaryIsContainer = (() => {
		const id = selectedIds[0];
		if (!id) return false;
		const found = findNode(ctx.ir, id);
		return (
			found !== null &&
			(found.node.type === "group" || found.node.type === "frame")
		);
	})();

	const gridEnabled = ctx.viewportStore.getState().gridEnabled;
	// Ruler/guide chrome (C-02, FR-030). Values are read at render like
	// `gridEnabled` — the menu re-renders on every open, so this stays fresh.
	const rulerGuides = ctx.rulerGuideStore;
	const activeGuides = ctx.ir.pages.find((p) => p.id === ctx.activePageId)
		?.layoutAids?.guides;
	const hasGuides =
		(activeGuides?.horizontal.length ?? 0) > 0 ||
		(activeGuides?.vertical.length ?? 0) > 0;

	return (
		<ContextMenu>
			<ContextMenuTrigger
				data-testid="canvas-context-surface"
				className="flex min-h-0 min-w-0 flex-1 flex-col"
				onContextMenu={onContextMenu}
			>
				{children}
			</ContextMenuTrigger>
			<ContextMenuContent data-testid="canvas-context-menu">
				{target === "node" ? (
					<>
						<ContextMenuItem
							data-testid="ctx-cut"
							onClick={() => void actions.cutSelection()}
						>
							{t("canvas.menu.cut", "Cut")}
						</ContextMenuItem>
						<ContextMenuItem
							data-testid="ctx-copy"
							onClick={() => void actions.copySelection()}
						>
							{t("canvas.menu.copy", "Copy")}
						</ContextMenuItem>
						<ContextMenuItem
							data-testid="ctx-paste"
							onClick={() => void actions.paste()}
						>
							{t("canvas.menu.paste", "Paste")}
						</ContextMenuItem>
						<ContextMenuItem
							data-testid="ctx-duplicate"
							onClick={() => actions.duplicateSelection()}
						>
							{t("canvas.menu.duplicate", "Duplicate")}
						</ContextMenuItem>
						<ContextMenuItem
							data-testid="ctx-copy-style"
							onClick={() => actions.copyStyle()}
						>
							{t("canvas.menu.copyStyle", "Copy style")}
						</ContextMenuItem>
						<ContextMenuItem
							data-testid="ctx-paste-style"
							disabled={!actions.hasCopiedStyle()}
							onClick={() => actions.pasteStyle()}
						>
							{t("canvas.menu.pasteStyle", "Paste style")}
						</ContextMenuItem>
						<ContextMenuItem
							data-testid="ctx-delete"
							variant="destructive"
							onClick={() => actions.deleteSelection()}
						>
							{t("canvas.menu.delete", "Delete")}
						</ContextMenuItem>
						<ContextMenuSeparator />
						<ContextMenuItem
							data-testid="ctx-bring-forward"
							onClick={() => actions.reorderSelection("forward")}
						>
							{t("canvas.menu.bringForward", "Bring forward")}
						</ContextMenuItem>
						<ContextMenuItem
							data-testid="ctx-bring-front"
							onClick={() => actions.reorderSelection("front")}
						>
							{t("canvas.menu.bringToFront", "Bring to front")}
						</ContextMenuItem>
						<ContextMenuItem
							data-testid="ctx-send-backward"
							onClick={() => actions.reorderSelection("backward")}
						>
							{t("canvas.menu.sendBackward", "Send backward")}
						</ContextMenuItem>
						<ContextMenuItem
							data-testid="ctx-send-back"
							onClick={() => actions.reorderSelection("back")}
						>
							{t("canvas.menu.sendToBack", "Send to back")}
						</ContextMenuItem>
						<ContextMenuSeparator />
						<ContextMenuItem
							data-testid="ctx-group"
							disabled={!canGroupSelection(ctx.ir, selectedIds)}
							onClick={() => actions.groupSelection()}
						>
							{t("canvas.menu.group", "Group")}
						</ContextMenuItem>
						<ContextMenuItem
							data-testid="ctx-ungroup"
							disabled={!canUngroupSelection(ctx.ir, selectedIds)}
							onClick={() => actions.ungroupSelection()}
						>
							{t("canvas.menu.ungroup", "Ungroup")}
						</ContextMenuItem>
						<ContextMenuItem
							data-testid="ctx-lock"
							onClick={() => actions.toggleLockSelection()}
						>
							{allLocked
								? t("canvas.menu.unlock", "Unlock")
								: t("canvas.menu.lock", "Lock")}
						</ContextMenuItem>
						<ContextMenuItem
							data-testid="ctx-isolate"
							disabled={!primaryIsContainer}
							onClick={() => {
								const id = ctx.selectionStore.getState().selectedIds[0];
								if (id) enterIsolationImpl(ctx, id);
							}}
						>
							{t("canvas.menu.isolate", "Edit contents")}
						</ContextMenuItem>
					</>
				) : (
					<>
						<ContextMenuItem
							data-testid="ctx-paste"
							onClick={() => void actions.paste()}
						>
							{t("canvas.menu.paste", "Paste")}
						</ContextMenuItem>
						<ContextMenuItem data-testid="ctx-select-all" onClick={selectAll}>
							{t("canvas.menu.selectAll", "Select all")}
						</ContextMenuItem>
						{isolationActive ? (
							<ContextMenuItem
								data-testid="ctx-exit-isolation"
								onClick={() => ctx.isolationStore?.getState().exitOne()}
							>
								{t("canvas.menu.exitIsolation", "Exit isolation")}
							</ContextMenuItem>
						) : null}
						<ContextMenuSeparator />
						<ContextMenuItem
							data-testid="ctx-toggle-grid"
							onClick={() =>
								ctx.viewportStore.getState().setGridEnabled(!gridEnabled)
							}
						>
							{gridEnabled
								? t("canvas.menu.hideGrid", "Hide grid")
								: t("canvas.menu.showGrid", "Show grid")}
						</ContextMenuItem>
						{rulerGuides ? (
							<>
								<ContextMenuItem
									data-testid="ctx-toggle-rulers"
									onClick={() =>
										rulerGuides
											.getState()
											.setRulersVisible(!rulerGuides.getState().rulersVisible)
									}
								>
									{rulerGuides.getState().rulersVisible
										? t("canvas.menu.hideRulers", "Hide rulers")
										: t("canvas.menu.showRulers", "Show rulers")}
								</ContextMenuItem>
								<ContextMenuSeparator />
								<ContextMenuItem
									data-testid="ctx-add-guide-horizontal"
									onClick={() => {
										const page = ctx
											.getIR()
											.pages.find((p) => p.id === ctx.activePageId);
										if (page)
											actions.addGuide("horizontal", page.size.height / 2);
									}}
								>
									{t("canvas.menu.addHorizontalGuide", "Add horizontal guide")}
								</ContextMenuItem>
								<ContextMenuItem
									data-testid="ctx-add-guide-vertical"
									onClick={() => {
										const page = ctx
											.getIR()
											.pages.find((p) => p.id === ctx.activePageId);
										if (page) actions.addGuide("vertical", page.size.width / 2);
									}}
								>
									{t("canvas.menu.addVerticalGuide", "Add vertical guide")}
								</ContextMenuItem>
								<ContextMenuItem
									data-testid="ctx-toggle-guides"
									disabled={!hasGuides}
									onClick={() =>
										rulerGuides
											.getState()
											.setGuidesVisible(!rulerGuides.getState().guidesVisible)
									}
								>
									{rulerGuides.getState().guidesVisible
										? t("canvas.menu.hideGuides", "Hide guides")
										: t("canvas.menu.showGuides", "Show guides")}
								</ContextMenuItem>
								<ContextMenuItem
									data-testid="ctx-lock-guides"
									disabled={!hasGuides}
									onClick={() =>
										rulerGuides
											.getState()
											.setGuidesLocked(!rulerGuides.getState().guidesLocked)
									}
								>
									{rulerGuides.getState().guidesLocked
										? t("canvas.menu.unlockGuides", "Unlock guides")
										: t("canvas.menu.lockGuides", "Lock guides")}
								</ContextMenuItem>
								<ContextMenuItem
									data-testid="ctx-clear-guides"
									disabled={!hasGuides}
									onClick={() => actions.clearGuides()}
								>
									{t("canvas.menu.clearGuides", "Clear guides")}
								</ContextMenuItem>
							</>
						) : null}
					</>
				)}
			</ContextMenuContent>
		</ContextMenu>
	);
}
