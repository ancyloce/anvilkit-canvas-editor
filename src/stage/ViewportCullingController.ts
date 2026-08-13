"use client";

import type { CanvasNode } from "@anvilkit/canvas-core";
import { useLayoutEffect, useMemo, useRef, useSyncExternalStore } from "react";
import {
	useCanvasStudio,
	useResolvedDocument,
} from "../context/canvas-studio-context.js";
import { draggedIdsKey } from "../perf/active-nodes.js";
import { findNodeById } from "./find-node-by-id.js";
import { createResolvedPageSpace } from "./resolved-page-space.js";
import type { StageWindow } from "./stage-window.js";
import {
	computeCulledIds,
	culledSetsEqual,
	stageWindowWorldRect,
} from "./viewport-culling.js";

export interface ViewportCullingControllerProps {
	/** The K-1 stage window; `null` disables culling entirely. */
	readonly stageWindow: StageWindow | null;
	readonly zoom: number;
	readonly panX: number;
	readonly panY: number;
	/** The stage's top-level nodes (page-root or Source-root children). */
	readonly surfaceChildren: readonly CanvasNode[];
}

const EMPTY_SET: ReadonlySet<string> = new Set();

/**
 * K-12: hides top-level Konva nodes whose page-space AABB misses the stage
 * window's world rect. Renders nothing. See `viewport-culling.ts` for the
 * design and the visibility-write discipline this component holds.
 */
export function ViewportCullingController({
	stageWindow,
	zoom,
	panX,
	panY,
	surfaceChildren,
}: ViewportCullingControllerProps): null {
	const ctx = useCanvasStudio();
	const { stage, selectionStore, draftStore, editingStore } = ctx;
	const resolvedDocument = useResolvedDocument();

	// Page-space AABBs. Rebuilt per resolution — createResolvedPageSpace
	// memoizes its own root-inverse work internally.
	const pageSpace = useMemo(
		() => (resolvedDocument ? createResolvedPageSpace(resolvedDocument) : null),
		[resolvedDocument],
	);

	// Keep-visible inputs. Each snapshot is identity-stable across unrelated
	// store ticks: `selectedIds` is replaced only when the selection changes,
	// `draggedIdsKey` is a string that changes only at drag start/end (never
	// per pointermove — the K-4 property), and `editingNodeId` is a scalar.
	const selectedIds = useSyncExternalStore(
		selectionStore.subscribe,
		() => selectionStore.getState().selectedIds,
		() => selectionStore.getState().selectedIds,
	);
	const draggedKey = useSyncExternalStore(
		draftStore.subscribe,
		() => draggedIdsKey(draftStore.getState().draft),
		() => "",
	);
	const editingNodeId = useSyncExternalStore(
		editingStore.subscribe,
		() => editingStore.getState().editingNodeId,
		() => null,
	);

	const keepIds = useMemo(() => {
		const keep = new Set<string>(selectedIds);
		for (const id of draggedKey.split(",")) {
			if (id.length > 0) keep.add(id);
		}
		if (editingNodeId !== null) keep.add(editingNodeId);
		return keep;
	}, [selectedIds, draggedKey, editingNodeId]);

	// The culled set. Reference-stable across recomputes with equal content,
	// so the apply effect below only runs when membership actually changes
	// (or the tree/window identity does).
	const previousRef = useRef<ReadonlySet<string>>(EMPTY_SET);
	const culled = useMemo<ReadonlySet<string>>(() => {
		const worldRect =
			stageWindow === null
				? null
				: stageWindowWorldRect(stageWindow, panX, panY, zoom);
		let next: ReadonlySet<string>;
		if (worldRect === null || pageSpace === null) {
			next = EMPTY_SET;
		} else {
			next = computeCulledIds({
				// IR-hidden nodes are excluded outright: they are already
				// invisible, and keeping them out of the set is what guarantees
				// `akCulled` only ever marks declared-visible nodes (the export
				// unhide relies on that).
				nodeIds: surfaceChildren
					.filter((node) => node.visible !== false)
					.map((node) => node.id),
				aabbOf: (id) => pageSpace.aabbOf(id),
				worldRect,
				keepIds,
			});
		}
		if (culledSetsEqual(previousRef.current, next)) {
			return previousRef.current;
		}
		previousRef.current = next;
		return next;
	}, [stageWindow, panX, panY, zoom, pageSpace, surfaceChildren, keepIds]);

	// Apply. A layout effect so the writes land in the same commit as the
	// render that computed them — after react-konva has applied any changed
	// declared props, which is what makes the controller the last writer.
	const appliedRef = useRef<ReadonlySet<string>>(EMPTY_SET);
	useLayoutEffect(() => {
		if (stage === null) return;
		const declaredVisible = new Map<string, boolean>();
		for (const node of surfaceChildren) {
			declaredVisible.set(node.id, node.visible !== false);
		}
		const applied = new Set<string>();
		let changed = false;
		// Cull (or re-assert) every member of the current set.
		for (const id of culled) {
			const node = findNodeById(stage, id);
			if (!node) continue;
			applied.add(id);
			if (node.visible() || node.getAttr("akCulled") !== true) {
				node.setAttr("akCulled", true);
				node.visible(false);
				changed = true;
			}
		}
		// Uncull everything applied previously that dropped out, restoring the
		// DECLARED visibility (an IR-hidden node stays hidden).
		for (const id of appliedRef.current) {
			if (applied.has(id)) continue;
			const node = findNodeById(stage, id);
			if (!node) continue;
			if (node.getAttr("akCulled") === true) {
				node.setAttr("akCulled", false);
				node.visible(declaredVisible.get(id) ?? true);
				changed = true;
			}
		}
		appliedRef.current = applied;
		if (changed) {
			stage.batchDraw?.();
		}
	}, [stage, culled, surfaceChildren]);

	// Unmount (or stage swap): nothing may stay culled on a stage this
	// controller no longer manages.
	useLayoutEffect(() => {
		if (stage === null) return;
		return () => {
			for (const id of appliedRef.current) {
				const node = findNodeById(stage, id);
				if (node && node.getAttr("akCulled") === true) {
					node.setAttr("akCulled", false);
					node.visible(true);
				}
			}
			appliedRef.current = EMPTY_SET;
			stage.batchDraw?.();
		};
	}, [stage]);

	return null;
}
