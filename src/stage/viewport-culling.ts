/**
 * @file K-12 (review 0036): viewport culling for the live stage.
 *
 * Every node in the active page used to be drawn on every layer redraw
 * whether or not it was anywhere near the screen — against a documented
 * ceiling of 10 000 nodes (`core/src/limits.ts`), with the wasted fraction
 * GROWING with zoom. K-1's stage window finally defines "the viewport" in a
 * way the stage can act on, so top-level nodes whose page-space AABB misses
 * the window's world rect are culled: `visible(false)` plus an `akCulled`
 * marker attr, applied by `ViewportCullingController`.
 *
 * The application is IMPERATIVE (a layout effect writing through the K-6
 * node registry), not a `culled` prop threaded into `CanvasNodeRenderer` —
 * the renderer's 17 kind components each spread `commonProps` themselves,
 * so a prop would touch every one of them, and a per-window-step re-render
 * of the whole node list is exactly the churn K-4/K-5 removed. Writing the
 * same attr react-konva also declares (`visible`) is the K-9 hazard class,
 * so the controller holds a strict discipline:
 *
 * - Only nodes whose IR `visible` is true are ever culled; the restore
 *   value is the node's DECLARED visibility at that commit, never a blind
 *   `true` — an IR-hidden node can never be resurrected by an uncull.
 * - The effect re-runs (and re-asserts every still-culled node) on every
 *   IR/window/keep-set change, so a declared-prop re-apply by react-konva
 *   is always followed by the controller's write in the same commit.
 *
 * Raster export stays correct AND synchronous: the built-in exporters
 * serialize the LIVE stage (`exportStageContentDataURL`), and a culled node
 * must not vanish from a PNG. That function already hides chrome and
 * restores it in a `finally`; it now symmetrically UNHIDES `akCulled` nodes
 * for the capture — possible precisely because the marker rides on the
 * Konva node where a synchronous tree walk can see it. The marker is only
 * ever set on nodes whose declared visibility is true, which is what makes
 * the export-side unhide unconditional and safe. The offscreen
 * `rasterizePage` path mounts without a stage window and never culls.
 *
 * Only TOP-LEVEL nodes (direct children of the page root / Source root) are
 * culled. Descending further buys little — a frame's children share its
 * fate for drawing purposes once the frame is invisible — and keeps the
 * keep-alive rules (selection, drag, editing) trivially checkable.
 *
 * Nodes are never culled when geometry is unknown (`aabbOf` undefined: no
 * resolved record, bare test contexts) — drawing too much degrades
 * performance, culling wrongly loses content.
 */

import type { Aabb } from "@anvilkit/canvas-core";
import type { StageWindow } from "./stage-window.js";

/** Page-space (world) rectangle, inclusive extents. */
export interface WorldRect {
	readonly minX: number;
	readonly minY: number;
	readonly maxX: number;
	readonly maxY: number;
}

/**
 * Extra SCREEN-space margin around the stage window that still counts as
 * visible. The window is already padded (`STAGE_WINDOW_PAD`), so this only
 * needs to absorb AABB imprecision at the boundary — it deliberately stays
 * small; the pad is the real pre-render lead.
 */
export const CULL_SCREEN_MARGIN = 64;

/**
 * The world rect the stage window can show: the window's own box mapped
 * through the inverse of the stage transform (`stage.x = pan − window
 * origin`, scale = zoom), grown by {@link CULL_SCREEN_MARGIN}.
 *
 * Returns `null` for a degenerate zoom — with no usable transform there is
 * no "offscreen", and the caller must not cull.
 */
export function stageWindowWorldRect(
	window: StageWindow,
	panX: number,
	panY: number,
	zoom: number,
	marginScreen: number = CULL_SCREEN_MARGIN,
): WorldRect | null {
	if (!Number.isFinite(zoom) || zoom <= 0) return null;
	if (!Number.isFinite(panX) || !Number.isFinite(panY)) return null;
	const stageX = panX - window.x;
	const stageY = panY - window.y;
	return {
		minX: (-marginScreen - stageX) / zoom,
		minY: (-marginScreen - stageY) / zoom,
		maxX: (window.width + marginScreen - stageX) / zoom,
		maxY: (window.height + marginScreen - stageY) / zoom,
	};
}

function outside(aabb: Aabb, rect: WorldRect): boolean {
	return (
		aabb.maxX < rect.minX ||
		aabb.minX > rect.maxX ||
		aabb.maxY < rect.minY ||
		aabb.minY > rect.maxY
	);
}

export interface ComputeCulledIdsInput {
	/** Ids of the stage's top-level nodes, in any order. */
	readonly nodeIds: readonly string[];
	/** Page-space AABB per id; `undefined` = unknown geometry = never cull. */
	readonly aabbOf: (nodeId: string) => Aabb | undefined;
	readonly worldRect: WorldRect;
	/**
	 * Ids that must stay visible regardless of geometry: the current
	 * selection (the Transformer draws their frame), nodes in an active
	 * drag/draft, and the node being text-edited.
	 */
	readonly keepIds?: ReadonlySet<string>;
}

const NO_IDS: ReadonlySet<string> = new Set();

/**
 * The set of top-level ids to cull. Pure; returns {@link NO_IDS} (a shared
 * frozen-empty set) when nothing is culled so callers can cheaply keep
 * reference equality across recomputes.
 */
export function computeCulledIds(
	input: ComputeCulledIdsInput,
): ReadonlySet<string> {
	let culled: Set<string> | null = null;
	for (const id of input.nodeIds) {
		if (input.keepIds?.has(id)) continue;
		const aabb = input.aabbOf(id);
		if (aabb === undefined) continue;
		if (
			!Number.isFinite(aabb.minX) ||
			!Number.isFinite(aabb.minY) ||
			!Number.isFinite(aabb.maxX) ||
			!Number.isFinite(aabb.maxY)
		) {
			continue;
		}
		if (outside(aabb, input.worldRect)) {
			culled ??= new Set();
			culled.add(id);
		}
	}
	return culled ?? NO_IDS;
}

/** Set value-equality, for keeping the previous reference on a no-op. */
export function culledSetsEqual(
	a: ReadonlySet<string>,
	b: ReadonlySet<string>,
): boolean {
	if (a === b) return true;
	if (a.size !== b.size) return false;
	for (const id of a) {
		if (!b.has(id)) return false;
	}
	return true;
}
