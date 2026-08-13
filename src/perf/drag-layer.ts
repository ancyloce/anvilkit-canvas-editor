"use client";

import type Konva from "konva";
import { useEffect } from "react";
import { findNodeById } from "../stage/find-node-by-id.js";
import type { RenderLayerName } from "../stage/RenderLayer.js";
import type { DraftStoreApi } from "../stores/draft-store.js";
import { selectDraggedIds } from "./active-nodes.js";

/** Where a promoted node came from, so demoting can put it back exactly. */
interface PromotedNode {
	readonly node: Konva.Node;
	readonly parent: Konva.Container;
	readonly zIndex: number;
}

const DRAG_LAYER_NAME: RenderLayerName = "drag";

function dragLayerOf(stage: Konva.Stage): Konva.Layer | undefined {
	const getLayers = (stage as { getLayers?: () => ReadonlyArray<Konva.Layer> })
		.getLayers;
	if (typeof getLayers !== "function") return undefined;
	return getLayers
		.call(stage)
		.find((layer) => layer.name() === DRAG_LAYER_NAME);
}

/**
 * Float the actively-dragged nodes onto the `drag` layer for the duration of a
 * move gesture, so a drag redraws only that layer instead of the whole content
 * layer (which carries the page background, the grid and every other node).
 *
 * IMPERATIVE ON PURPOSE (K-4). This used to be expressed in JSX — the `objects`
 * group rendered the un-dragged nodes and the `drag` layer rendered the dragged
 * ones — but a React element that changes position in the tree is an unmount
 * plus a mount, so every promote and demote DESTROYED the Konva node and built
 * a new one. That is the root of a whole family of defects the codebase had
 * grown separate workarounds for:
 *
 *   - the selection `Transformer` held a reference to the destroyed instance,
 *     so a resize immediately after a move silently no-oped. It carried TWO
 *     rebind mechanisms for this (a passive effect that raced the reconciler,
 *     and a draft-store subscription re-pointing it on every pointermove);
 *   - `useImage` rebuilt its `HTMLImageElement` on remount, so every image drag
 *     began with a frame of placeholder chrome;
 *   - any `node.cache()` bitmap on the dragged subtree was thrown away twice
 *     per gesture;
 *   - dragging a frame tore down and rebuilt its entire subtree.
 *
 * Konva's own drag-layer idiom is `node.moveTo(layer)`, which keeps the
 * instance. react-konva tolerates this because its reconciler only touches
 * Konva child order when the REACT child list changes (`appendChild` /
 * `insertBefore` in its host config); a gesture commits nothing, so the list is
 * stable for the whole drag.
 *
 * Z-ORDER is the one thing `moveTo` does not preserve — it appends to the new
 * parent — so each node's original parent and index are captured on promote and
 * restored on demote. Nodes are promoted in ascending z-order and restored in
 * the same order, so a multi-node drag keeps its relative stacking.
 */
export function useDragLayerPromotion(
	stage: Konva.Stage | null,
	draftStore: DraftStoreApi,
): void {
	useEffect(() => {
		if (!stage) return;
		let promoted: PromotedNode[] = [];

		const demote = (): void => {
			if (promoted.length === 0) return;
			for (const entry of promoted) {
				// A node (or its old parent) can be destroyed mid-gesture by an
				// undo or a remote collab write. Konva clears `parent` on destroy,
				// so this is the cheap liveness check; a dead node is simply
				// dropped, because React owns rebuilding it either way.
				if (!entry.node.getParent()) continue;
				if (!entry.parent.getStage()) continue;
				entry.node.moveTo(entry.parent);
				entry.node.setZIndex(entry.zIndex);
			}
			promoted = [];
			stage.batchDraw();
		};

		const promote = (ids: readonly string[]): void => {
			const layer = dragLayerOf(stage);
			if (!layer) return;
			const found: PromotedNode[] = [];
			for (const id of ids) {
				const node = findNodeById(stage, id);
				if (!node) continue;
				const parent = node.getParent();
				if (!parent || parent === layer) continue;
				found.push({ node, parent, zIndex: node.getZIndex() });
			}
			if (found.length === 0) return;
			// Ascending z-order in, ascending z-order out: `moveTo` appends, so
			// this is what keeps a multi-node drag from inverting its stacking.
			found.sort((a, b) => a.zIndex - b.zIndex);
			for (const entry of found) entry.node.moveTo(layer);
			promoted = found;
			stage.batchDraw();
		};

		const sync = (): void => {
			const ids = selectDraggedIds(draftStore.getState().draft);
			if (ids.length === 0) {
				demote();
				return;
			}
			// One promotion per gesture. `selectDraggedIds` returns the same set
			// for every pointermove of a drag, so re-promoting would just churn.
			if (promoted.length > 0) return;
			promote(ids);
		};

		sync();
		const unsubscribe = draftStore.subscribe(sync);
		return () => {
			unsubscribe();
			// Never leave the scene graph rearranged behind us — on unmount the
			// nodes belong back under their real parents.
			demote();
		};
	}, [stage, draftStore]);
}
