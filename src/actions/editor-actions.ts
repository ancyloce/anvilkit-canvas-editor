"use client";

import type {
	AlignEdge,
	CanvasAnyNodeUpdateCommand,
	CanvasIR,
	CanvasNodeDeleteCommand,
} from "@anvilkit/canvas-core";
import { findNode, parentOf } from "@anvilkit/canvas-core";
import { useMemo } from "react";
import {
	type CanvasStudioContextValue,
	useCanvasStores,
} from "../context/canvas-studio-context.js";
import {
	type CanvasToaster,
	NOOP_CANVAS_TOASTER,
	useCanvasToaster,
} from "../context/toast-context.js";
import {
	alignSelection as alignSelectionFn,
	distributeSelection as distributeSelectionFn,
	tidyUpSelection as tidyUpSelectionFn,
} from "../selection/align-actions.js";
import {
	groupSelection as groupSelectionFn,
	ungroupSelection as ungroupSelectionFn,
} from "../selection/group-actions.js";
import type { CanvasGuideAxis } from "../stores/ruler-guide-store.js";
import { type CanvasCancelStep, cancelImpl } from "./cancel-action.js";
import {
	copySelectionImpl,
	cutSelectionImpl,
	duplicateSelectionImpl,
	pasteImpl,
} from "./clipboard-actions.js";
import {
	addGuideImpl,
	clearGuidesImpl,
	moveGuideImpl,
	removeGuideImpl,
} from "./guide-actions.js";
import {
	type CanvasReorderDirection,
	reorderSelectionImpl,
} from "./reorder-actions.js";
import {
	copyStyleImpl,
	hasCopiedStyle,
	pasteStyleImpl,
} from "./style-actions.js";
import {
	resetZoomImpl,
	zoomInImpl,
	zoomOutImpl,
	zoomToFitImpl,
	zoomToSelectionImpl,
} from "./viewport-actions.js";

/** Axis accepted by {@link CanvasEditorActions.distributeSelection}. */
export type CanvasDistributeAxis = "x" | "y";

/**
 * The unified editor action layer (M0-01, PRD 0012 §19). Every UI surface —
 * toolbars, context menus, keyboard handlers, panels, inspectors — routes
 * document operations through ONE of these actions instead of building
 * commands locally, so behavior (locked-node protection, batch boundaries,
 * selection updates, undo granularity) stays identical everywhere.
 *
 * The skeleton wraps the existing selection free functions; later phases add
 * clipboard, zoom, save, and export here. Each action reads live state
 * (selection, IR, active page) at CALL time — holding the object across
 * renders is safe.
 */
export interface CanvasEditorActions {
	/**
	 * Delete every deletable selected node as ONE undo entry (FR-024): locked
	 * nodes and page roots are skipped, descendants of a selected ancestor are
	 * skipped (the ancestor's `node.delete` already removes them — a second
	 * delete inside the batch would fail and roll the transaction back), and
	 * the selection is cleared afterwards. Returns the deleted node ids.
	 */
	deleteSelection(): string[];
	/**
	 * Wrap the multi-selection in a new group and select it. Returns the new
	 * group id, or `null` when the selection cannot be grouped.
	 */
	groupSelection(): string | null;
	/**
	 * Dissolve every selected non-root group (one undo entry when several) and
	 * select the lifted children. Returns the lifted child ids.
	 */
	ungroupSelection(): string[];
	/** Align the multi-selection to an edge, as one undo entry. */
	alignSelection(edge: AlignEdge): void;
	/** Distribute the multi-selection along an axis, as one undo entry. */
	distributeSelection(axis: CanvasDistributeAxis): void;
	/** FR-072 Tidy Up (C-12): grid-arrange the multi-selection, one undo entry. */
	tidyUpSelection(): void;
	/**
	 * Toggle the lock state of the whole selection as ONE undo entry
	 * (FR-040 Lock / FR-054): locks when any selected node is unlocked,
	 * unlocks when all are locked. Locking clears the selection (locked nodes
	 * are un-hittable — see ElementControls); unlocking keeps it. Returns the
	 * new lock state, or null for an empty selection.
	 */
	toggleLockSelection(): boolean | null;
	/**
	 * Toggle the visibility of the whole selection as ONE undo entry
	 * (FR-031 Show/Hide, FR-054): hides when any selected node is visible,
	 * shows when all are hidden. Locked nodes are skipped (a locked hidden
	 * node stays hidden). Returns the new visible state, or null for an empty
	 * selection.
	 */
	toggleVisibilitySelection(): boolean | null;
	/** FR-020 copy — internal clipboard + system clipboard when available. */
	copySelection(): Promise<number>;
	/** FR-022 cut — copy, then a single-undo-entry delete. */
	cutSelection(): Promise<string[]>;
	/** FR-021 paste — system payload preferred, internal fallback; one batch. */
	paste(): Promise<string[]>;
	/** FR-023 duplicate — fresh ids, next to the original, one batch. */
	duplicateSelection(): string[];
	/** FR-031 layer order — move the selection within its parent, one batch. */
	reorderSelection(direction: CanvasReorderDirection): void;
	/**
	 * Rename a single node (layer-panel inline rename, node context menu) —
	 * targets `nodeId` directly rather than the current selection, since the
	 * node being renamed need not be selected. No-op when the id is unknown or
	 * the trimmed name is unchanged (avoids a spurious undo entry).
	 */
	renameNode(nodeId: string, name: string): void;
	/** FR-043 zoom — viewport-store only, never a history entry. */
	zoomIn(): void;
	zoomOut(): void;
	zoomToFit(): void;
	zoomToSelection(): void;
	resetZoom(): void;
	/** FR-040 Escape stack — one press, one step; returns the step that ran. */
	cancel(): CanvasCancelStep;
	/**
	 * FR-111 persistent guides (C-02) — each call is ONE `page.set-layout-aids`
	 * commit (one undo entry) on the active page. Positions are page
	 * coordinates in the page's own unit. `addGuide` returns the new guide's
	 * index on its axis (or -1 with no active page).
	 */
	addGuide(axis: CanvasGuideAxis, position: number): number;
	moveGuide(axis: CanvasGuideAxis, index: number, position: number): void;
	removeGuide(axis: CanvasGuideAxis, index: number): void;
	clearGuides(): void;
	/**
	 * FR-120/121 copy/paste style (C-05). `copyStyle` captures the primary
	 * selected node's portable style; `pasteStyle` applies it to every
	 * selected unlocked node as ONE batch of `node.applyStyle` commands,
	 * reporting ignored/incompatible fields via toast. `hasCopiedStyle`
	 * drives menu enablement.
	 */
	copyStyle(): boolean;
	pasteStyle(): string[];
	hasCopiedStyle(): boolean;
	/**
	 * FR-160 save — delegates to the host `persistenceAdapter` wiring. Resolves
	 * `false` when no adapter is configured (nothing to persist).
	 */
	save(): Promise<boolean>;
	/**
	 * FR-152/§11.2 export — open the export dialog preselected to a page scope
	 * (`"current"` default, `"all"`, or `"selection"`). The export UI (mounted
	 * via `createCanvasExportPlugin`) performs the render + download; this is the
	 * stable host trigger that doesn't require reaching into stores. A no-op when
	 * no export UI is mounted.
	 */
	requestExport(scope?: "current" | "all" | "selection"): void;
}

function hasSelectedAncestor(
	ir: CanvasIR,
	id: string,
	selected: ReadonlySet<string>,
): boolean {
	let cur = parentOf(ir, id);
	while (cur) {
		if (selected.has(cur.parent.id)) return true;
		cur = parentOf(ir, cur.parent.id);
	}
	return false;
}

function deleteSelectionImpl(
	ctx: CanvasStudioContextValue,
	toaster: CanvasToaster = NOOP_CANVAS_TOASTER,
): string[] {
	const ir = ctx.getIR();
	const selectedIds = ctx.selectionStore.getState().selectedIds;
	const selected = new Set(selectedIds);
	const cmds: CanvasNodeDeleteCommand[] = [];
	let lockedSkipped = 0;
	for (const id of selectedIds) {
		const found = findNode(ir, id);
		if (!found) continue;
		// Locked nodes are protected from deletion (FR-024); page roots and
		// unknown ids cannot be deleted at all.
		if (found.node.locked === true) {
			lockedSkipped += 1;
			continue;
		}
		if (parentOf(ir, id) === null) continue;
		if (hasSelectedAncestor(ir, id, selected)) continue;
		cmds.push({ type: "node.delete", nodeId: id });
	}
	if (lockedSkipped > 0) {
		toaster.add({
			type: "warning",
			title: (ctx.t ?? ((_k, f) => f ?? ""))(
				"canvas.toast.lockedNotDeleted",
				"Locked layers weren't deleted",
			),
		});
	}
	if (cmds.length === 0) return [];
	const first = cmds[0];
	if (cmds.length === 1 && first) {
		ctx.commit(first);
	} else {
		ctx.commitBatch(cmds, "Delete");
	}
	ctx.selectionStore.getState().clearSelection();
	return cmds.map((c) => c.nodeId);
}

function toggleLockSelectionImpl(
	ctx: CanvasStudioContextValue,
): boolean | null {
	const ir = ctx.getIR();
	const selectedIds = ctx.selectionStore.getState().selectedIds;
	const nodes = selectedIds
		.map((id) => findNode(ir, id)?.node)
		.filter((n): n is NonNullable<typeof n> => Boolean(n));
	if (nodes.length === 0) return null;
	const nextLocked = !nodes.every((n) => n.locked === true);
	const cmds = nodes.map(
		(n) =>
			({
				type: "node.update",
				nodeId: n.id,
				kind: n.type,
				patch: { locked: nextLocked },
			}) as CanvasAnyNodeUpdateCommand,
	);
	const first = cmds[0];
	if (cmds.length === 1 && first) ctx.commit(first);
	else ctx.commitBatch(cmds, nextLocked ? "Lock" : "Unlock");
	if (nextLocked) ctx.selectionStore.getState().clearSelection();
	return nextLocked;
}

function toggleVisibilitySelectionImpl(
	ctx: CanvasStudioContextValue,
	toaster: CanvasToaster = NOOP_CANVAS_TOASTER,
): boolean | null {
	const ir = ctx.getIR();
	const selectedIds = ctx.selectionStore.getState().selectedIds;
	const nodes = selectedIds
		.map((id) => findNode(ir, id)?.node)
		.filter((n): n is NonNullable<typeof n> => Boolean(n));
	// FR-024 lock enforcement: a locked node cannot be hidden/shown either.
	const editable = nodes.filter((n) => n.locked !== true);
	if (editable.length === 0) {
		if (nodes.length > 0) {
			toaster.add({
				type: "warning",
				title: (ctx.t ?? ((_k, f) => f ?? ""))(
					"canvas.toast.lockedNotEdited",
					"Locked layers weren't changed",
				),
			});
		}
		return null;
	}
	// Hide when any editable node is currently visible; otherwise show.
	const anyVisible = editable.some((n) => n.visible !== false);
	const nextVisible = !anyVisible;
	const cmds = editable.map(
		(n) =>
			({
				type: "node.update",
				nodeId: n.id,
				kind: n.type,
				patch: { visible: nextVisible },
			}) as CanvasAnyNodeUpdateCommand,
	);
	const first = cmds[0];
	if (cmds.length === 1 && first) ctx.commit(first);
	else ctx.commitBatch(cmds, nextVisible ? "Show" : "Hide");
	return nextVisible;
}

function renameNodeImpl(
	ctx: CanvasStudioContextValue,
	nodeId: string,
	name: string,
): void {
	const ir = ctx.getIR();
	const found = findNode(ir, nodeId);
	if (!found) return;
	const trimmed = name.trim();
	if (trimmed === (found.node.name ?? "")) return;
	const cmd: CanvasAnyNodeUpdateCommand = {
		type: "node.update",
		nodeId,
		kind: found.node.type,
		patch: { name: trimmed },
	} as CanvasAnyNodeUpdateCommand;
	ctx.commit(cmd);
}

/**
 * Build a {@link CanvasEditorActions} facade over a studio context. For
 * non-React callers and tests; components should prefer
 * {@link useCanvasActions}. The context's `getIR`/stores are read at call
 * time, so the facade stays correct across edits as long as `ctx` itself is
 * the live context object.
 */
export interface CanvasEditorActionsDeps {
	/** Feedback sink (A-09); defaults to the silent no-op toaster. */
	toaster?: CanvasToaster;
}

export function createCanvasEditorActions(
	ctx: CanvasStudioContextValue,
	deps: CanvasEditorActionsDeps = {},
): CanvasEditorActions {
	const toaster = deps.toaster ?? NOOP_CANVAS_TOASTER;
	return {
		deleteSelection: () => deleteSelectionImpl(ctx, toaster),
		groupSelection: () => groupSelectionFn(ctx),
		ungroupSelection: () => ungroupSelectionFn(ctx),
		alignSelection: (edge) => alignSelectionFn(ctx, edge),
		distributeSelection: (axis) => distributeSelectionFn(ctx, axis),
		tidyUpSelection: () => tidyUpSelectionFn(ctx),
		toggleLockSelection: () => toggleLockSelectionImpl(ctx),
		toggleVisibilitySelection: () =>
			toggleVisibilitySelectionImpl(ctx, toaster),
		copySelection: () => copySelectionImpl(ctx, toaster),
		cutSelection: () =>
			cutSelectionImpl(ctx, () => deleteSelectionImpl(ctx, toaster), toaster),
		paste: () => pasteImpl(ctx, toaster),
		duplicateSelection: () => duplicateSelectionImpl(ctx),
		reorderSelection: (direction) => reorderSelectionImpl(ctx, direction),
		renameNode: (nodeId, name) => renameNodeImpl(ctx, nodeId, name),
		zoomIn: () => zoomInImpl(ctx),
		zoomOut: () => zoomOutImpl(ctx),
		zoomToFit: () => zoomToFitImpl(ctx),
		zoomToSelection: () => zoomToSelectionImpl(ctx),
		resetZoom: () => resetZoomImpl(ctx),
		cancel: () => cancelImpl(ctx),
		addGuide: (axis, position) => addGuideImpl(ctx, axis, position),
		moveGuide: (axis, index, position) =>
			moveGuideImpl(ctx, axis, index, position),
		removeGuide: (axis, index) => removeGuideImpl(ctx, axis, index),
		clearGuides: () => clearGuidesImpl(ctx),
		copyStyle: () => copyStyleImpl(ctx),
		pasteStyle: () => pasteStyleImpl(ctx, toaster),
		hasCopiedStyle: () => hasCopiedStyle(),
		save: () => ctx.save?.() ?? Promise.resolve(false),
		requestExport: (scope = "current") =>
			ctx.exportRequestStore?.getState().request({ scope }),
	};
}

/**
 * The action layer as a hook. Built on {@link useCanvasStores} (the stable
 * context half), so consumers do NOT re-render on every commit and the
 * returned object keeps a stable identity for the lifetime of the editor
 * (PRD 0012 §13.3). Live state (`ir`, `activePageId`) is resolved from the
 * stores at call time.
 */
export function useCanvasActions(): CanvasEditorActions {
	const stores = useCanvasStores();
	const toaster = useCanvasToaster();
	return useMemo(() => {
		const liveCtx = (): CanvasStudioContextValue => ({
			...stores,
			ir: stores.getIR(),
			activePageId: stores.pagesStore.getState().activePageId,
			stage: null,
		});
		return {
			deleteSelection: () => deleteSelectionImpl(liveCtx(), toaster),
			groupSelection: () => groupSelectionFn(liveCtx()),
			ungroupSelection: () => ungroupSelectionFn(liveCtx()),
			alignSelection: (edge) => alignSelectionFn(liveCtx(), edge),
			distributeSelection: (axis) => distributeSelectionFn(liveCtx(), axis),
			tidyUpSelection: () => tidyUpSelectionFn(liveCtx()),
			toggleLockSelection: () => toggleLockSelectionImpl(liveCtx()),
			toggleVisibilitySelection: () =>
				toggleVisibilitySelectionImpl(liveCtx(), toaster),
			copySelection: () => copySelectionImpl(liveCtx(), toaster),
			cutSelection: () => {
				const ctx = liveCtx();
				return cutSelectionImpl(
					ctx,
					() => deleteSelectionImpl(ctx, toaster),
					toaster,
				);
			},
			paste: () => pasteImpl(liveCtx(), toaster),
			duplicateSelection: () => duplicateSelectionImpl(liveCtx()),
			reorderSelection: (direction) =>
				reorderSelectionImpl(liveCtx(), direction),
			renameNode: (nodeId, name) => renameNodeImpl(liveCtx(), nodeId, name),
			zoomIn: () => zoomInImpl(liveCtx()),
			zoomOut: () => zoomOutImpl(liveCtx()),
			zoomToFit: () => zoomToFitImpl(liveCtx()),
			zoomToSelection: () => zoomToSelectionImpl(liveCtx()),
			resetZoom: () => resetZoomImpl(liveCtx()),
			cancel: () => cancelImpl(liveCtx()),
			addGuide: (axis, position) => addGuideImpl(liveCtx(), axis, position),
			moveGuide: (axis, index, position) =>
				moveGuideImpl(liveCtx(), axis, index, position),
			removeGuide: (axis, index) => removeGuideImpl(liveCtx(), axis, index),
			clearGuides: () => clearGuidesImpl(liveCtx()),
			copyStyle: () => copyStyleImpl(liveCtx()),
			pasteStyle: () => pasteStyleImpl(liveCtx(), toaster),
			hasCopiedStyle: () => hasCopiedStyle(),
			save: () => liveCtx().save?.() ?? Promise.resolve(false),
			requestExport: (scope = "current") =>
				liveCtx().exportRequestStore?.getState().request({ scope }),
		};
	}, [stores, toaster]);
}
