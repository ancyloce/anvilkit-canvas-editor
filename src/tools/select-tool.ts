import {
	type CanvasNode,
	type CanvasNodeMoveCommand,
	marqueeHits,
} from "@anvilkit/canvas-core";
import type Konva from "konva";
import { isolationScopeChildren } from "../selection/isolation.js";
import { getOtherNodeRects } from "../snap/get-node-rect.js";
import { computeSnap } from "../snap/snap-engine.js";
import { nodeRenderOffset } from "../stage/node-render-offset.js";
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
	const candidate = {
		x: nodeStart.x + dx,
		y: nodeStart.y + dy,
		width: node.bounds.width,
		height: node.bounds.height,
	};
	const others = getOtherNodeRects(ir, ctx.activePageId, new Set([nodeId]));
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
			if (
				ctx.isolationStore &&
				lastClick &&
				lastClick.id === hitId &&
				now - lastClick.time <= DOUBLE_CLICK_MS
			) {
				lastClick = null;
				const node = selectionScope(ctx).find((c) => c.id === hitId);
				if (node && (node.type === "group" || node.type === "frame")) {
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
				const konvaNode = ctx.stage.findOne(`.${start.id}`);
				if (!konvaNode) continue;
				const node = scope.find((c) => c.id === start.id);
				const offset = node ? nodeRenderOffset(node) : { x: 0, y: 0 };
				konvaNode.position({
					x: start.x + dx + offset.x,
					y: start.y + dy + offset.y,
				});
			}
			ctx.draftStore.getState().setDraft({
				...draft,
				currentX: e.point.x,
				currentY: e.point.y,
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
			// the canvas (unlock via the layer panel to re-edit). marqueeHits uses
			// each node's rotation-aware world AABB, replacing the earlier
			// rotation-ignoring inline rect + local aabbIntersect. C-09: the
			// candidate set is the isolation scope (FR-055).
			const hitIds = marqueeHits(selectionScope(ctx), marquee, {
				skipLocked: true,
			}).map((n) => n.id);

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
