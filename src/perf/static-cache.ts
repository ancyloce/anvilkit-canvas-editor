"use client";

import {
	type CanvasIR,
	type CanvasNode,
	isContainerNode,
	isFrameNode,
} from "@anvilkit/canvas-core";
import type Konva from "konva";
import { useEffect, useRef } from "react";
import { findNodeById } from "../stage/find-node-by-id.js";
import type { DraftStoreApi } from "../stores/draft-store.js";
import type { EditingStoreApi } from "../stores/editing-store.js";
import type { SelectionStoreApi } from "../stores/selection-store.js";
import { selectDraggedIds } from "./active-nodes.js";

/**
 * Leaf node types whose render is deterministic and synchronous — safe to
 * rasterize into a Konva cache. `text`/`image`/`ai-placeholder` are excluded
 * because their content arrives asynchronously (web-font load, asset load,
 * loading animation), so caching them risks a stale/blank bitmap. Caching those
 * correctly needs load-aware invalidation — deferred past this pass.
 */
const CACHEABLE_LEAF_TYPES: ReadonlySet<string> = new Set([
	"rect",
	"ellipse",
	"line",
	"path",
]);

/** Collect a node's id plus every descendant id into `into`. */
function collectSubtreeIds(node: CanvasNode, into: Set<string>): void {
	into.add(node.id);
	if (isContainerNode(node)) {
		for (const child of node.children) collectSubtreeIds(child, into);
	}
}

/**
 * True when every leaf in the subtree is a cacheable shape/path type (containers
 * are traversed). Empty containers are not cacheable (nothing to rasterize).
 *
 * A frame carrying a `placeholder` is never cacheable: once that placeholder
 * resolves to an asset its render turns async, so a cached bitmap could go stale
 * — the same reason `image` is absent from {@link CACHEABLE_LEAF_TYPES}.
 */
function isCacheableSubtree(node: CanvasNode): boolean {
	if (isContainerNode(node)) {
		if (isFrameNode(node) && node.placeholder) return false;
		if (node.children.length === 0) return false;
		return node.children.every(isCacheableSubtree);
	}
	return CACHEABLE_LEAF_TYPES.has(node.type);
}

export interface ActiveNodeIds {
	selectedIds: readonly string[];
	editingNodeId: string | null;
	draggedIds: readonly string[];
}

/**
 * Top-level container nodes (group or frame) on the active page that are safe to
 * `node.cache()`: a non-empty, shape/path-only subtree containing NONE of the
 * active ids (selected / editing / dragged). Pure — unit-testable without a
 * Konva stage.
 */
export function selectStaticGroupIds(
	ir: CanvasIR,
	activePageId: string,
	active: ActiveNodeIds,
): string[] {
	const page = ir.pages.find((p) => p.id === activePageId);
	if (!page) return [];
	const activeSet = new Set<string>([
		...active.selectedIds,
		...(active.editingNodeId ? [active.editingNodeId] : []),
		...active.draggedIds,
	]);
	const result: string[] = [];
	for (const node of page.root.children) {
		if (!isContainerNode(node) || !isCacheableSubtree(node)) continue;
		const subtree = new Set<string>();
		collectSubtreeIds(node, subtree);
		let hasActive = false;
		for (const id of subtree) {
			if (activeSet.has(id)) {
				hasActive = true;
				break;
			}
		}
		if (!hasActive) result.push(node.id);
	}
	return result;
}

/**
 * Reconcile the Konva cache state of top-level group nodes against the desired
 * static set, diffing from `prev`: `clearCache()` groups that left the set,
 * `cache()` groups that entered it. Every Konva call is guarded, so this is a
 * safe no-op under the mocked react-konva test env (no real canvas 2D context).
 * Returns the new applied set (feed back as `prev` next time).
 */
export function applyGroupCache(
	stage: Konva.Stage,
	ids: readonly string[],
	prev: ReadonlySet<string>,
): Set<string> {
	const next = new Set(ids);
	for (const id of prev) {
		if (next.has(id)) continue;
		const node = findNodeById(stage, id);
		if (node && typeof node.clearCache === "function") node.clearCache();
	}
	for (const id of next) {
		if (prev.has(id)) continue;
		const node = findNodeById(stage, id);
		if (node && typeof node.cache === "function") node.cache();
	}
	return next;
}

export interface StaticGroupCacheArgs {
	stage: Konva.Stage | null;
	getIR: () => CanvasIR;
	activePageId: string;
	/** Current IR — included so the effect re-applies after every commit. */
	ir: CanvasIR;
	selectionStore: SelectionStoreApi;
	editingStore: EditingStoreApi;
	draftStore: DraftStoreApi;
}

/**
 * I2-5: caches static (shape-only, unselected/unedited/undragged) top-level
 * groups on the active page as bitmaps, so an idle large scene redraws cheaply.
 * Recomputes on IR commit and on selection / editing / draft changes; clears a
 * group's cache the moment it becomes active again. Renders nothing.
 *
 * The actual `cache()`/`clearCache()` effect runs only on a real Konva stage —
 * verify visually via manual QA (the jsdom test env mocks react-konva and has
 * no canvas 2D context, so the calls no-op there).
 */
export function useStaticGroupCache(args: StaticGroupCacheArgs): void {
	const {
		stage,
		getIR,
		activePageId,
		ir,
		selectionStore,
		editingStore,
		draftStore,
	} = args;
	const cachedRef = useRef<Set<string>>(new Set());
	// Per-id top-level node reference as of its last successful cache() call.
	// The immutable-update convention means ANY content change inside a
	// group's subtree (undo, redo, a remote-collab write) produces a NEW
	// object reference all the way up to this top-level node, even while its
	// membership in the static set never changes — `applyGroupCache` only
	// diffs membership, so that case needs a separate check (E-7).
	const fingerprintRef = useRef<Map<string, CanvasNode>>(new Map());

	useEffect(() => {
		if (!stage) {
			cachedRef.current = new Set();
			fingerprintRef.current = new Map();
			return;
		}
		const apply = () => {
			const currentIr = getIR();
			const page = currentIr.pages.find((p) => p.id === activePageId);
			const ids = selectStaticGroupIds(currentIr, activePageId, {
				selectedIds: selectionStore.getState().selectedIds,
				editingNodeId: editingStore.getState().editingNodeId,
				draggedIds: selectDraggedIds(draftStore.getState().draft),
			});
			const prevCachedIds = cachedRef.current;
			cachedRef.current = applyGroupCache(stage, ids, prevCachedIds);
			// Re-cache a group that was ALREADY static last time (so
			// `applyGroupCache` skipped it as unchanged membership) but whose
			// top-level node reference has since changed — an otherwise
			// invisible stale bitmap that would only refresh once the group
			// next becomes active (E-7).
			const nextFingerprints = new Map<string, CanvasNode>();
			for (const id of ids) {
				const node = page?.root.children.find((c) => c.id === id);
				if (!node) continue;
				nextFingerprints.set(id, node);
				if (!prevCachedIds.has(id)) continue; // just entered — already fresh
				if (fingerprintRef.current.get(id) === node) continue; // unchanged
				const knode = findNodeById(stage, id);
				if (knode && typeof knode.cache === "function") knode.cache();
			}
			fingerprintRef.current = nextFingerprints;
		};
		apply();
		const unsubs = [
			selectionStore.subscribe(apply),
			editingStore.subscribe(apply),
			draftStore.subscribe(apply),
		];
		return () => {
			for (const unsub of unsubs) unsub();
		};
	}, [
		stage,
		getIR,
		activePageId,
		ir,
		selectionStore,
		editingStore,
		draftStore,
	]);
}
