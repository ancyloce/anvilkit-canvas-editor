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
import type { ViewportStoreApi } from "../stores/viewport-store.js";
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
 * Device pixels a single cached bitmap may occupy (RGBA, so ×4 for bytes).
 *
 * A cap, not a target: it only binds when the crisp ratio would exceed it.
 * Chosen so the common static group — a logo lockup, an icon cluster — gets
 * full crispness at maximum zoom, while a full-page group is held at roughly
 * the memory it already used. On the largest shipped preset (1080×1920) at
 * zoom 4 / DPR 2 the crisp ratio would be 8, i.e. 132 Mpx ≈ 530 MB for ONE
 * group; this pins that back to today's ratio instead.
 */
const MAX_CACHE_PIXELS = 4_000_000;

/**
 * Relative ratio change worth re-rasterising for. Zoom steps are chunky
 * (1.25× per notch, rounded to 2dp by `clampZoom`), so this only filters out
 * churn, never a real zoom.
 */
const RECACHE_RATIO_THRESHOLD = 0.1;

/** `window.devicePixelRatio`, or 1 where there is no window (jsdom/SSR). */
function currentDevicePixelRatio(): number {
	const dpr =
		typeof window !== "undefined" ? window.devicePixelRatio : undefined;
	return typeof dpr === "number" && Number.isFinite(dpr) && dpr > 0 ? dpr : 1;
}

/** The viewport inputs a cache ratio depends on. */
export interface CacheViewport {
	readonly zoom: number;
	readonly devicePixelRatio: number;
}

/**
 * Pixel ratio to rasterise a cached group at (K-7 item 1).
 *
 * `node.cache()` with no config rasterises at `devicePixelRatio` and Konva
 * then blits that bitmap through the node's absolute transform — which
 * includes the stage's `scaleX/Y = zoom`. So a group cached at DPR 2 and
 * viewed at zoom 4 is an 8× upscale of a 2× bitmap: visibly soft, exactly
 * where the user has zoomed in to inspect detail.
 *
 * `zoom × devicePixelRatio` is the ratio that lands one bitmap pixel per
 * device pixel. Bounded two ways:
 *
 *  - by {@link MAX_CACHE_PIXELS}, so a large group cannot allocate an absurd
 *    bitmap (memory that is already under pressure while K-1 keeps the stage
 *    itself sized to `page × zoom`);
 *  - from below by the DPR baseline, so this can never come out WORSE than
 *    the argument-less `cache()` it replaces. At zoom < 1 the target is
 *    legitimately below DPR, and that floor follows it down rather than
 *    over-allocating for a zoomed-out view.
 *
 * `area` is `null` when the node cannot be measured (test fakes), which just
 * skips the budget clamp.
 */
export function cachePixelRatio(
	area: number | null,
	viewport: CacheViewport,
): number {
	const dpr = viewport.devicePixelRatio;
	const target = viewport.zoom * dpr;
	if (!Number.isFinite(target) || target <= 0) return dpr;
	if (area === null || !Number.isFinite(area) || area <= 0) return target;
	const affordable = Math.sqrt(MAX_CACHE_PIXELS / area);
	const baseline = Math.min(dpr, target);
	return Math.min(target, Math.max(baseline, affordable));
}

/** Local-space area of a node, or `null` when it cannot be measured. */
function nodeArea(node: Konva.Node): number | null {
	const getClientRect = (
		node as {
			getClientRect?: (config?: unknown) => { width: number; height: number };
		}
	).getClientRect;
	if (typeof getClientRect !== "function") return null;
	try {
		// The same measurement `Node.cache()` makes for itself.
		const rect = getClientRect.call(node, { skipTransform: true });
		const area = rect.width * rect.height;
		return Number.isFinite(area) ? area : null;
	} catch {
		return null;
	}
}

/** Rasterise `node` for the current viewport; returns the ratio used. */
function cacheNodeAt(node: Konva.Node, viewport: CacheViewport): number | null {
	if (typeof node.cache !== "function") return null;
	const ratio = cachePixelRatio(nodeArea(node), viewport);
	node.cache({ pixelRatio: ratio });
	return ratio;
}

/**
 * Reconcile the Konva cache state of top-level group nodes against the desired
 * static set, diffing from `prev`: `clearCache()` groups that left the set,
 * `cache()` groups that entered it. Every Konva call is guarded, so this is a
 * safe no-op under the mocked react-konva test env (no real canvas 2D context).
 *
 * `prev` maps id → the pixel ratio that id is currently cached AT, not just
 * membership, because a group that stays static still has to be re-rasterised
 * when the zoom moves far enough for its bitmap to be the wrong resolution
 * (K-7 item 2). Feed the return value back as `prev` next time.
 */
export function applyGroupCache(
	stage: Konva.Stage,
	ids: readonly string[],
	prev: ReadonlyMap<string, number>,
	viewport: CacheViewport,
): Map<string, number> {
	const wanted = new Set(ids);
	const next = new Map<string, number>();
	for (const [id] of prev) {
		if (wanted.has(id)) continue;
		const node = findNodeById(stage, id);
		if (node && typeof node.clearCache === "function") node.clearCache();
	}
	for (const id of wanted) {
		const node = findNodeById(stage, id);
		if (!node) continue;
		const applied = prev.get(id);
		if (applied !== undefined) {
			// Already cached: re-rasterise only if the resolution is now
			// materially wrong for the zoom.
			const desired = cachePixelRatio(nodeArea(node), viewport);
			if (Math.abs(desired / applied - 1) <= RECACHE_RATIO_THRESHOLD) {
				next.set(id, applied);
				continue;
			}
		}
		const ratio = cacheNodeAt(node, viewport);
		if (ratio !== null) next.set(id, ratio);
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
	/** Drives the cache RESOLUTION (K-7): zoom decides the pixel ratio. */
	viewportStore: ViewportStoreApi;
}

/**
 * How long the zoom must settle before cached groups are re-rasterised.
 *
 * Re-caching is not cheap, and a wheel zoom emits a burst of intermediate
 * values; rasterising each one would be far worse than the momentary blur it
 * is fixing. Only the zoom path is debounced — selection, editing and draft
 * changes still apply immediately, because those change WHAT is cached rather
 * than at what resolution.
 */
const ZOOM_RECACHE_DEBOUNCE_MS = 200;

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
		viewportStore,
	} = args;
	/** id → the pixel ratio that id's bitmap is currently rasterised at. */
	const cachedRef = useRef<Map<string, number>>(new Map());
	// Per-id top-level node reference as of its last successful cache() call.
	// The immutable-update convention means ANY content change inside a
	// group's subtree (undo, redo, a remote-collab write) produces a NEW
	// object reference all the way up to this top-level node, even while its
	// membership in the static set never changes — `applyGroupCache` only
	// diffs membership, so that case needs a separate check (E-7).
	const fingerprintRef = useRef<Map<string, CanvasNode>>(new Map());

	useEffect(() => {
		if (!stage) {
			cachedRef.current = new Map();
			fingerprintRef.current = new Map();
			return;
		}
		const viewport = (): CacheViewport => ({
			zoom: viewportStore.getState().zoom,
			devicePixelRatio: currentDevicePixelRatio(),
		});
		const apply = () => {
			const currentIr = getIR();
			const page = currentIr.pages.find((p) => p.id === activePageId);
			const ids = selectStaticGroupIds(currentIr, activePageId, {
				selectedIds: selectionStore.getState().selectedIds,
				editingNodeId: editingStore.getState().editingNodeId,
				draggedIds: selectDraggedIds(draftStore.getState().draft),
			});
			const prevCachedIds = cachedRef.current;
			const view = viewport();
			cachedRef.current = applyGroupCache(stage, ids, prevCachedIds, view);
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
				if (!knode) continue;
				const ratio = cacheNodeAt(knode, view);
				if (ratio !== null) cachedRef.current.set(id, ratio);
			}
			fingerprintRef.current = nextFingerprints;
		};
		apply();

		// K-7 item 2: a cached bitmap is the wrong resolution the moment the
		// zoom moves, and nothing used to re-rasterise it — the group stayed
		// soft for the rest of the session, or until it happened to become
		// active again. Watch zoom ONLY: `viewportStore` also carries pan,
		// which changes on every frame of a hand-drag and has no effect on
		// cache resolution.
		let lastZoom = viewportStore.getState().zoom;
		let recacheTimer: ReturnType<typeof setTimeout> | undefined;
		const onViewportChange = () => {
			const { zoom } = viewportStore.getState();
			if (zoom === lastZoom) return;
			lastZoom = zoom;
			if (recacheTimer !== undefined) clearTimeout(recacheTimer);
			recacheTimer = setTimeout(() => {
				recacheTimer = undefined;
				apply();
			}, ZOOM_RECACHE_DEBOUNCE_MS);
		};

		const unsubs = [
			selectionStore.subscribe(apply),
			editingStore.subscribe(apply),
			draftStore.subscribe(apply),
			viewportStore.subscribe(onViewportChange),
		];
		return () => {
			if (recacheTimer !== undefined) clearTimeout(recacheTimer);
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
		viewportStore,
	]);
}
