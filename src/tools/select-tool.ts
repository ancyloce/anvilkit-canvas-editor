import type { CanvasNodeMoveCommand } from "@anvilkit/canvas-core";
import type Konva from "konva";
import { getOtherNodeRects } from "../snap/get-node-rect.js";
import { computeSnap } from "../snap/snap-engine.js";
import { nodeRenderOffset } from "../stage/node-render-offset.js";
import type { Tool, ToolContext, ToolPointerEvent } from "./tool-types.js";

const MIN_MOVE_DISTANCE = 0.5;
const MIN_MARQUEE_SIZE = 2;

function aabbIntersect(
	a: { x: number; y: number; width: number; height: number },
	b: { x: number; y: number; width: number; height: number },
): boolean {
	if (a.x + a.width < b.x) return false;
	if (b.x + b.width < a.x) return false;
	if (a.y + a.height < b.y) return false;
	if (b.y + b.height < a.y) return false;
	return true;
}

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
	const ir = ctx.getIR();
	const page = ir.pages.find((p) => p.id === ctx.activePageId);
	if (!page) return null;
	// Map id → node so we can skip `locked` nodes during hit-test. A locked
	// node is treated as if the click missed it — the marquee/empty-stage path
	// takes over instead. This is the canvas-side enforcement of "locked
	// elements can't be selected"; unlock via the layer panel to re-edit.
	const byId = new Map(page.root.children.map((c) => [c.id, c]));
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
	const page = ir.pages.find((p) => p.id === ctx.activePageId);
	const node = page?.root.children.find((c) => c.id === nodeId);
	if (!node) return { dx, dy, guides: [] };
	const vs = ctx.viewportStore.getState();
	const candidate = {
		x: nodeStart.x + dx,
		y: nodeStart.y + dy,
		width: node.bounds.width,
		height: node.bounds.height,
	};
	const others = getOtherNodeRects(ir, ctx.activePageId, new Set([nodeId]));
	const result = computeSnap({
		candidate,
		others: vs.snapToObjectsEnabled ? others : [],
		gridSize: vs.gridEnabled ? vs.gridSize : 0,
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
			const nodeStarts = page.root.children
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
			const page = ctx.getIR().pages.find((p) => p.id === ctx.activePageId);
			for (const start of draft.nodeStarts) {
				const konvaNode = ctx.stage.findOne(`.${start.id}`);
				if (!konvaNode) continue;
				const node = page?.root.children.find((c) => c.id === start.id);
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
			for (const start of draft.nodeStarts) {
				const cmd: CanvasNodeMoveCommand = {
					type: "node.move",
					nodeId: start.id,
					from: { x: start.x, y: start.y },
					to: { x: start.x + dx, y: start.y + dy },
				};
				ctx.commit(cmd);
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

			const marquee = { x, y, width: w, height: h };
			const page = ctx.getIR().pages.find((p) => p.id === ctx.activePageId);
			if (!page) return;
			const hitIds: string[] = [];
			for (const child of page.root.children) {
				// Locked nodes are skipped by the marquee — they can't be selected
				// via the canvas (unlock via the layer panel to re-edit).
				if (child.locked === true) continue;
				const childRect = {
					x: child.transform.x,
					y: child.transform.y,
					width: child.bounds.width,
					height: child.bounds.height,
				};
				if (aabbIntersect(marquee, childRect)) hitIds.push(child.id);
			}

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
