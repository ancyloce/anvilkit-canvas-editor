import {
	applyMatrix,
	type CanvasAnyNodeUpdateCommand,
	type CanvasCommand,
	type CanvasNode,
	type CanvasNodeMoveCommand,
	findNode,
	invertMatrix,
	marqueeHits,
	marqueeHitsResolved,
	parentOf,
	type ResolvedHitTarget,
} from "@anvilkit/canvas-core";
import type Konva from "konva";
import {
	computeInsertionIndex,
	computeInsertionIndicator,
	type FlowChildRect,
	reorderCommandsTo,
} from "../auto-layout/reorder.js";
import { instanceScopeTargetAt } from "../selection/component-selection-policy.js";
import { isolationScopeChildren } from "../selection/isolation.js";
import { getOtherNodeRects } from "../snap/get-node-rect.js";
import { computeSnap } from "../snap/snap-engine.js";
import { findNodeById } from "../stage/find-node-by-id.js";
import { nodeRenderOffset } from "../stage/node-render-offset.js";
import { resolvedPageSpace } from "../stage/resolved-page-space.js";
import type { LayoutDropPreview, NodeStart } from "../stores/draft-store.js";
import { findFrameHitAtPoint } from "./frame-target.js";
import type { Tool, ToolContext, ToolPointerEvent } from "./tool-types.js";

/**
 * The children the select tool operates over (C-09, FR-055): the isolated
 * container's children while isolation is active, else the page top level.
 */
function selectionScope(ctx: ToolContext): readonly CanvasNode[] {
	const page = ctx.getIR().pages.find((p) => p.id === ctx.activePageId);
	return isolationScopeChildren(
		page,
		ctx.isolationStore?.getState().path ?? [],
	);
}

const MIN_MOVE_DISTANCE = 0.5;
const MIN_MARQUEE_SIZE = 2;

/** Same-node repeat-click window for isolation entry (C-09). */
const DOUBLE_CLICK_MS = 400;
/** Last primary click, for the double-click detector. Module-level: the select tool is a singleton. */
let lastClick: { id: string; time: number } | null = null;

/**
 * Walk up the Konva tree from the hit target until we find an ancestor whose
 * `name()` matches a current top-level IR node id on the active page. Returns
 * null when the click landed on stage/layer background or on a non-IR helper
 * (marquee/transformer/guide). Single-page descent is sufficient for MVP —
 * future iterations could recurse into groups.
 */
/**
 * True when a pointer interaction originates on the selection `Transformer`
 * (its resize/rotate anchors, the rotater handle, or its border) rather than on
 * canvas content. The Transformer is a sibling overlay on the selection layer
 * and owns its own drag gesture; if the select tool *also* treats that gesture
 * as a marquee/move, the two fight over one pointer stream — the phantom
 * marquee's pointerup re-runs `setSelection()` over the swept area and
 * intermittently clears/replaces the selection the moment a rotate or resize
 * commits. Walks the Konva parent chain (anchors are children of the
 * Transformer node) looking for `getClassName() === "Transformer"`. Guarded so
 * it is a safe no-op against the plain fake nodes used in tool tests.
 */
function isTransformerTarget(target: Konva.Node | undefined | null): boolean {
	let cur: Konva.Node | null = target ?? null;
	let safety = 16;
	while (cur && safety-- > 0) {
		const getClassName = (cur as { getClassName?: () => string }).getClassName;
		if (
			typeof getClassName === "function" &&
			getClassName.call(cur) === "Transformer"
		) {
			return true;
		}
		const parent = (cur as { getParent?: () => Konva.Node | null }).getParent;
		cur = typeof parent === "function" ? parent.call(cur) : null;
	}
	return false;
}

function findHitNodeId(
	target: Konva.Node | undefined | null,
	ctx: ToolContext,
): string | null {
	// Map id → node so we can skip `locked` nodes during hit-test. A locked
	// node is treated as if the click missed it — the marquee/empty-stage path
	// takes over instead. This is the canvas-side enforcement of "locked
	// elements can't be selected"; unlock via the layer panel to re-edit.
	// C-09: inside isolation the candidates are the isolated container's
	// children, not the page's top level (FR-055).
	const byId = new Map(selectionScope(ctx).map((c) => [c.id, c]));
	let cur: Konva.Node | null = target ?? null;
	let safety = 16;
	while (cur && safety-- > 0) {
		const name =
			typeof (cur as { name?: () => string }).name === "function"
				? (cur as { name: () => string }).name()
				: undefined;
		const match = name ? byId.get(name) : undefined;
		if (match && match.locked !== true) return name ?? null;
		const parent = (cur as { getParent?: () => Konva.Node | null }).getParent;
		cur = typeof parent === "function" ? parent.call(cur) : null;
	}
	return null;
}

function snapMoveDelta(
	ctx: ToolContext,
	nodeId: string,
	nodeStart: { x: number; y: number },
	dx: number,
	dy: number,
): {
	dx: number;
	dy: number;
	guides: ReturnType<typeof computeSnap>["guides"];
} {
	const ir = ctx.getIR();
	const node = selectionScope(ctx).find((c) => c.id === nodeId);
	if (!node) return { dx, dy, guides: [] };
	const vs = ctx.viewportStore.getState();
	// T-M3-07: snap against RESOLVED geometry when the store is present — an
	// Auto Layout sibling snaps at its flow position, not its stale stored one.
	const space = resolvedPageSpace(ctx.resolvedDocumentStore);
	const bounds = space?.boundsOf(nodeId) ?? node.bounds;
	const candidate = {
		x: nodeStart.x + dx,
		y: nodeStart.y + dy,
		width: bounds.width,
		height: bounds.height,
	};
	const others = getOtherNodeRects(
		ir,
		ctx.activePageId,
		new Set([nodeId]),
		space,
	);
	// FR-112: grid snap is gated on the EXPLICIT snapToGridEnabled toggle, not
	// on grid visibility (gridEnabled) — hiding the grid keeps snapping on.
	const result = computeSnap({
		candidate,
		others: vs.snapToObjectsEnabled ? others : [],
		gridSize: vs.snapToGridEnabled ? vs.gridSize : 0,
		threshold: vs.snapThreshold,
	});
	return {
		dx: dx + result.dx,
		dy: dy + result.dy,
		guides: result.guides,
	};
}

/**
 * T-M4-06: the flow-insertion preview for a move gesture. Finds the Auto
 * Layout frame under the pointer (resolved geometry), maps the pointer into
 * frame-local space, and derives the insertion slot + page-space indicator
 * from the remaining flow children's resolved footprints. Pure computation —
 * never touches the IR; `null` when there is no eligible target (no resolved
 * store, no frame under the pointer, frame has no layout, or the target sits
 * inside the dragged subtree).
 */
function computeLayoutDrop(
	e: ToolPointerEvent,
	ctx: ToolContext,
	draggedIds: ReadonlySet<string>,
): LayoutDropPreview | null {
	const store = ctx.resolvedDocumentStore;
	const space = resolvedPageSpace(store);
	if (!store || !space) return null;
	const page = ctx.getIR().pages.find((p) => p.id === ctx.activePageId);
	if (!page) return null;
	const hit = findFrameHitAtPoint(
		page.root.children,
		e.point,
		undefined,
		space,
	);
	const layout = hit?.frame.autoLayout;
	if (!hit || !layout) return null;
	if (draggedIds.has(hit.frame.id)) return null;
	const view = store.getState().view;
	// Never target a frame inside the dragged subtree.
	let cursor = view.getRecord(hit.frame.id);
	while (cursor?.parentId) {
		const parent = view.getRecord(cursor.parentId);
		if (!parent) break;
		if (draggedIds.has(parent.sourceNodeId)) return null;
		cursor = parent;
	}
	const [localX, localY] = applyMatrix(
		invertMatrix(hit.worldMatrix),
		e.point.x,
		e.point.y,
	);
	const flowChildren: FlowChildRect[] = [];
	for (const childRecord of view.getChildren(hit.frame.id)) {
		if (draggedIds.has(childRecord.sourceNodeId)) continue;
		if (childRecord.node.layoutItem?.positioning === "absolute") continue;
		flowChildren.push({
			id: childRecord.sourceNodeId,
			footprint: childRecord.geometry.layoutFootprint,
		});
	}
	const index = computeInsertionIndex(flowChildren, layout.direction, {
		x: localX,
		y: localY,
	});
	const frameBounds =
		view.getRecord(hit.frame.id)?.geometry.bounds ?? hit.frame.bounds;
	const indicator = computeInsertionIndicator(
		flowChildren,
		layout.direction,
		index,
		{ minX: 0, minY: 0, maxX: frameBounds.width, maxY: frameBounds.height },
	);
	const [ix1, iy1] = applyMatrix(hit.worldMatrix, indicator.x1, indicator.y1);
	const [ix2, iy2] = applyMatrix(hit.worldMatrix, indicator.x2, indicator.y2);
	const absolute = "altKey" in e.evt ? e.evt.altKey === true : false;
	return {
		frameId: hit.frame.id,
		index,
		indicator: { x1: ix1, y1: iy1, x2: ix2, y2: iy2 },
		absolute,
	};
}

/**
 * Commit a previewed layout drop (T-M4-06 steps 5–6). Flow drops compute the
 * target frame's final child order ONCE and emit `node.reparent` (foreign
 * members, with a frame-local transform correction) plus `node.reorder`
 * commands mirrored against a working copy, so sequential remove-then-insert
 * application reaches exactly that order (review 0022 P1-1). Absolute drops
 * (Alt held) write the Absolute intent per node instead — no flow reorder.
 * ONE history entry. Returns `true` when the drop was handled (even as a
 * no-op), so the caller skips the plain `node.move` path.
 */
function commitLayoutDrop(
	ctx: ToolContext,
	nodeStarts: readonly NodeStart[],
	drop: LayoutDropPreview,
	dx: number,
	dy: number,
): boolean {
	const ir = ctx.getIR();
	const draggedIds = nodeStarts.map((s) => s.id);
	const parents = draggedIds.map((id) => parentOf(ir, id)?.parent ?? null);
	if (parents.some((p) => p === null)) return false;
	const frame = findNode(ir, drop.frameId)?.node;
	if (!frame || frame.type !== "frame") return false;
	const space = resolvedPageSpace(ctx.resolvedDocumentStore);
	const cmds: CanvasCommand[] = [];
	const localDropPoint = (id: string) => {
		const pageOrigin = space?.originOf(id);
		const frameMatrix = space?.matrixOf(drop.frameId);
		return pageOrigin && frameMatrix
			? applyMatrix(
					invertMatrix(frameMatrix),
					pageOrigin.x + dx,
					pageOrigin.y + dy,
				)
			: null;
	};

	if (!drop.absolute) {
		// The final order: current children minus the dragged block, dragged
		// ids spliced at the drop slot. Foreign members reparent into their
		// mirrored slot; members already in the frame are handled by the
		// reorder pass alone, like any same-parent drop. An unchanged order
		// yields zero commands — the no-op case.
		const before = frame.children.map((c) => c.id);
		const remaining = before.filter((id) => !draggedIds.includes(id));
		const target = [...remaining];
		target.splice(drop.index, 0, ...draggedIds);
		const work = [...before];
		for (const [k, start] of nodeStarts.entries()) {
			const found = findNode(ir, start.id);
			const parent = parents[k];
			if (!found || !parent || parent.id === drop.frameId) continue;
			const at = Math.min(target.indexOf(start.id), work.length);
			work.splice(at, 0, start.id);
			cmds.push({
				type: "node.reparent",
				nodeId: start.id,
				toParentId: drop.frameId,
				toIndex: at,
			});
			const local = localDropPoint(start.id);
			if (local) {
				cmds.push({
					type: "node.update",
					nodeId: start.id,
					kind: found.node.type,
					patch: {
						transform: { ...found.node.transform, x: local[0], y: local[1] },
					},
				} as CanvasAnyNodeUpdateCommand);
			}
		}
		cmds.push(...reorderCommandsTo(work, target));
	} else {
		// Absolute members are out of flow, so there is no reorder pass; the
		// `inserted` counter (NOT the raw member index) keeps the reparent
		// slot arithmetic correct when some members already live in the
		// target frame (review 0022 P1-1, mixed-parent edge).
		let inserted = 0;
		for (const [k, start] of nodeStarts.entries()) {
			const found = findNode(ir, start.id);
			const parent = parents[k];
			if (!found || !parent) continue;
			const node = found.node;
			const local = localDropPoint(start.id);
			if (parent.id !== drop.frameId) {
				cmds.push({
					type: "node.reparent",
					nodeId: start.id,
					toParentId: drop.frameId,
					toIndex: drop.index + inserted,
				});
				inserted += 1;
			}
			const patch: Record<string, unknown> = {
				layoutItem: { ...node.layoutItem, positioning: "absolute" },
			};
			if (local) {
				patch.transform = { ...node.transform, x: local[0], y: local[1] };
			}
			cmds.push({
				type: "node.update",
				nodeId: start.id,
				kind: node.type,
				patch,
			} as CanvasAnyNodeUpdateCommand);
		}
	}

	const first = cmds[0];
	if (!first) return true;
	if (cmds.length > 1 && ctx.commitBatch) {
		ctx.commitBatch(cmds, "Move");
	} else if (cmds.length === 1) {
		ctx.commit(first);
	} else {
		for (const cmd of cmds) ctx.commit(cmd);
	}
	return true;
}

export const selectTool: Tool = {
	id: "select",
	cursor: "default",

	onPointerDown(e, ctx) {
		// Let the selection Transformer own gestures that start on its own
		// handles. Starting a marquee/move draft here would run a phantom
		// selection alongside the resize/rotate and clobber the selection on
		// pointerup (rotation desync + lost selection state). The Transformer
		// mutates the live node directly and commits via its own `transformend`.
		if (isTransformerTarget(e.target)) return;
		const hitId = findHitNodeId(e.target, ctx);
		const sel = ctx.selectionStore.getState();
		if (hitId) {
			// C-09 (FR-055): double-clicking a group/frame enters isolation for
			// it. Uses the event timestamp so tests can drive it deterministically.
			const now =
				typeof e.evt?.timeStamp === "number" && e.evt.timeStamp > 0
					? e.evt.timeStamp
					: Date.now();
			// Detected independently of `isolationStore` (plan 0023 M4-06): a
			// component instance opens INSTANCE SCOPE on double-click, which is not
			// isolation and must work in a context without that store.
			const repeatClick =
				lastClick !== null &&
				lastClick.id === hitId &&
				now - lastClick.time <= DOUBLE_CLICK_MS;
			if (repeatClick) {
				lastClick = null;
				const node = selectionScope(ctx).find((c) => c.id === hitId);
				// M4-06 / AC-007: double-click INTO an instance targets the deepest
				// virtual node under the pointer. Never isolation — an instance is not
				// a container in the page tree (it has no `children` at all), so
				// `validateIsolationPath` would discard the entry on its next pass.
				if (node?.type === "component-instance") {
					const view = ctx.resolvedDocumentStore?.getState().view;
					const scoped = view
						? instanceScopeTargetAt(view, e.target, hitId)
						: null;
					if (scoped) {
						sel.setTargets([scoped]);
						ctx.draftStore.getState().clearDraft();
						return;
					}
					// No addressable virtual node (degraded placeholder, or no
					// resolution in this context): fall through and treat it as an
					// ordinary click on the instance root.
				}
				if (
					ctx.isolationStore &&
					node &&
					(node.type === "group" || node.type === "frame")
				) {
					ctx.isolationStore.getState().enter(hitId);
					sel.clearSelection();
					ctx.draftStore.getState().clearDraft();
					return;
				}
			} else {
				lastClick = { id: hitId, time: now };
			}
			if (e.shiftKey) {
				sel.toggleSelection(hitId);
			} else if (!sel.isSelected(hitId)) {
				sel.setSelection([hitId]);
			}
			// Start a move draft on the (possibly updated) selection.
			const currentSelection = ctx.selectionStore.getState().selectedIds;
			const ir = ctx.getIR();
			const page = ir.pages.find((p) => p.id === ctx.activePageId);
			if (!page) return;
			// Locked nodes are excluded from the move draft — they don't move
			// even when caught in a multi-selection from the layer panel.
			const nodeStarts = selectionScope(ctx)
				.filter((c) => currentSelection.includes(c.id) && c.locked !== true)
				.map((c) => ({ id: c.id, x: c.transform.x, y: c.transform.y }));
			if (nodeStarts.length === 0) return;
			ctx.draftStore.getState().setDraft({
				type: "move",
				startX: e.point.x,
				startY: e.point.y,
				currentX: e.point.x,
				currentY: e.point.y,
				nodeStarts,
			});
		} else {
			// Empty stage — start a marquee draft. Don't clear selection until
			// pointerup, so a degenerate click (no drag) can still distinguish
			// "click-to-deselect" from "drag-to-marquee-select".
			ctx.draftStore.getState().setDraft({
				type: "marquee",
				startX: e.point.x,
				startY: e.point.y,
				currentX: e.point.x,
				currentY: e.point.y,
			});
		}
	},

	onPointerMove(e, ctx) {
		const draft = ctx.draftStore.getState().draft;
		if (!draft) return;
		if (draft.type === "move") {
			let dx = e.point.x - draft.startX;
			let dy = e.point.y - draft.startY;
			if (draft.nodeStarts.length === 1) {
				const start = draft.nodeStarts[0]!;
				const snapped = snapMoveDelta(ctx, start.id, start, dx, dy);
				dx = snapped.dx;
				dy = snapped.dy;
				ctx.guidesStore.getState().setGuides(snapped.guides);
			}
			// Direct Konva mutation during interaction (PRD FR-011) — no commits.
			// Apply each node's render offset so centered shapes (Konva.Ellipse,
			// whose `position()` is its center, not its top-left) track the cursor
			// instead of drifting by half their bounds. See `nodeRenderOffset`.
			const scope = selectionScope(ctx);
			for (const start of draft.nodeStarts) {
				const konvaNode = findNodeById(ctx.stage, start.id);
				if (!konvaNode) continue;
				const node = scope.find((c) => c.id === start.id);
				const offset = node ? nodeRenderOffset(node) : { x: 0, y: 0 };
				konvaNode.position({
					x: start.x + dx + offset.x,
					y: start.y + dy + offset.y,
				});
			}
			// T-M4-06: refresh the flow-insertion preview. Preview state only —
			// the IR is NEVER reordered during pointer movement (NFR-PERF-003).
			const layoutDrop = computeLayoutDrop(
				e,
				ctx,
				new Set(draft.nodeStarts.map((s) => s.id)),
			);
			ctx.draftStore.getState().setDraft({
				...draft,
				currentX: e.point.x,
				currentY: e.point.y,
				layoutDrop,
			});
		} else if (draft.type === "marquee") {
			ctx.draftStore.getState().setDraft({
				...draft,
				currentX: e.point.x,
				currentY: e.point.y,
			});
		}
	},

	onPointerUp(e, ctx) {
		const draft = ctx.draftStore.getState().draft;
		if (!draft) return;
		if (draft.type === "move") {
			let dx = e.point.x - draft.startX;
			let dy = e.point.y - draft.startY;
			if (draft.nodeStarts.length === 1) {
				const start = draft.nodeStarts[0]!;
				const snapped = snapMoveDelta(ctx, start.id, start, dx, dy);
				dx = snapped.dx;
				dy = snapped.dy;
			}
			ctx.draftStore.getState().clearDraft();
			ctx.guidesStore.getState().clearGuides();
			if (
				Math.abs(dx) < MIN_MOVE_DISTANCE &&
				Math.abs(dy) < MIN_MOVE_DISTANCE
			) {
				return;
			}
			// T-M4-06: a previewed layout drop commits a reorder/reparent instead
			// of a stale `node.move` (flow positions are resolver-owned).
			if (
				draft.layoutDrop &&
				commitLayoutDrop(
					ctx,
					draft.nodeStarts,
					draft.layoutDrop,
					e.point.x - draft.startX,
					e.point.y - draft.startY,
				)
			) {
				return;
			}
			const moveCmds: CanvasNodeMoveCommand[] = draft.nodeStarts.map(
				(start) => ({
					type: "node.move",
					nodeId: start.id,
					from: { x: start.x, y: start.y },
					to: { x: start.x + dx, y: start.y + dy },
				}),
			);
			// Multi-select drag commits as ONE undo entry; a single node stays a
			// plain commit (MVP-7 single-command contract).
			if (moveCmds.length > 1 && ctx.commitBatch) {
				ctx.commitBatch(moveCmds, "Move");
			} else {
				for (const cmd of moveCmds) ctx.commit(cmd);
			}
		} else if (draft.type === "marquee") {
			const x = Math.min(draft.startX, e.point.x);
			const y = Math.min(draft.startY, e.point.y);
			const w = Math.abs(e.point.x - draft.startX);
			const h = Math.abs(e.point.y - draft.startY);
			ctx.draftStore.getState().clearDraft();

			if (w < MIN_MARQUEE_SIZE && h < MIN_MARQUEE_SIZE) {
				// Degenerate click on empty stage — clear selection (unless shift).
				if (!e.shiftKey) ctx.selectionStore.getState().clearSelection();
				return;
			}

			const marquee = { minX: x, minY: y, maxX: x + w, maxY: y + h };
			// Locked nodes are skipped by the marquee — they can't be selected via
			// the canvas (unlock via the layer panel to re-edit). C-09: the
			// candidate set is the isolation scope (FR-055).
			//
			// T-M3-07: with the resolved store present, hits test each node's
			// RESOLVED page-space AABB — ancestor-composed, so an isolation scope
			// inside a transformed container matches where nodes actually are
			// (the M0 suite pinned the old local-box behaviour as a KNOWN
			// LIMITATION of the raw fallback, which lightweight tool tests still
			// exercise). All-or-nothing: one missing record falls back wholesale
			// rather than silently dropping candidates.
			const scope = selectionScope(ctx);
			const space = resolvedPageSpace(ctx.resolvedDocumentStore);
			let targets: ResolvedHitTarget[] | null = null;
			if (space) {
				targets = [];
				for (const candidate of scope) {
					const target = space.targetOf(candidate);
					if (!target) {
						targets = null;
						break;
					}
					targets.push(target);
				}
			}
			const hitIds = targets
				? marqueeHitsResolved(targets, marquee, { skipLocked: true }).map(
						(t) => t.node.id,
					)
				: marqueeHits(scope, marquee, { skipLocked: true }).map((n) => n.id);

			if (e.shiftKey) {
				for (const id of hitIds) {
					ctx.selectionStore.getState().addToSelection(id);
				}
			} else {
				ctx.selectionStore.getState().setSelection(hitIds);
			}
		}
	},

	onDeactivate(ctx) {
		ctx.draftStore.getState().clearDraft();
		ctx.guidesStore.getState().clearGuides();
	},
};

// Re-export internals for tests.
export const _internal = { findHitNodeId };
