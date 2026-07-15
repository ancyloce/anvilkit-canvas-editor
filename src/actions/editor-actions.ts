"use client";

import type {
	AlignEdge,
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
	alignSelection as alignSelectionFn,
	distributeSelection as distributeSelectionFn,
} from "../selection/align-actions.js";
import {
	groupSelection as groupSelectionFn,
	ungroupSelection as ungroupSelectionFn,
} from "../selection/group-actions.js";

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

function deleteSelectionImpl(ctx: CanvasStudioContextValue): string[] {
	const ir = ctx.getIR();
	const selectedIds = ctx.selectionStore.getState().selectedIds;
	const selected = new Set(selectedIds);
	const cmds: CanvasNodeDeleteCommand[] = [];
	for (const id of selectedIds) {
		const found = findNode(ir, id);
		// Locked nodes are protected from deletion (FR-024); page roots and
		// unknown ids cannot be deleted at all.
		if (!found || found.node.locked === true) continue;
		if (parentOf(ir, id) === null) continue;
		if (hasSelectedAncestor(ir, id, selected)) continue;
		cmds.push({ type: "node.delete", nodeId: id });
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

/**
 * Build a {@link CanvasEditorActions} facade over a studio context. For
 * non-React callers and tests; components should prefer
 * {@link useCanvasActions}. The context's `getIR`/stores are read at call
 * time, so the facade stays correct across edits as long as `ctx` itself is
 * the live context object.
 */
export function createCanvasEditorActions(
	ctx: CanvasStudioContextValue,
): CanvasEditorActions {
	return {
		deleteSelection: () => deleteSelectionImpl(ctx),
		groupSelection: () => groupSelectionFn(ctx),
		ungroupSelection: () => ungroupSelectionFn(ctx),
		alignSelection: (edge) => alignSelectionFn(ctx, edge),
		distributeSelection: (axis) => distributeSelectionFn(ctx, axis),
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
	return useMemo(() => {
		const liveCtx = (): CanvasStudioContextValue => ({
			...stores,
			ir: stores.getIR(),
			activePageId: stores.pagesStore.getState().activePageId,
			stage: null,
		});
		return {
			deleteSelection: () => deleteSelectionImpl(liveCtx()),
			groupSelection: () => groupSelectionFn(liveCtx()),
			ungroupSelection: () => ungroupSelectionFn(liveCtx()),
			alignSelection: (edge) => alignSelectionFn(liveCtx(), edge),
			distributeSelection: (axis) => distributeSelectionFn(liveCtx(), axis),
		};
	}, [stores]);
}
