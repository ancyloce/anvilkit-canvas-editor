import {
	type AlignEdge,
	alignRects,
	type CanvasNodeMoveCommand,
	distributeRects,
	findNode,
	type SnapRect,
	tidyUpRects,
} from "@anvilkit/canvas-core";
import type { CanvasStudioContextValue } from "../context/canvas-studio-context.js";

interface SelItem {
	id: string;
	x: number;
	y: number;
	rect: SnapRect;
}

function selectedItems(ctx: CanvasStudioContextValue): SelItem[] {
	const ir = ctx.getIR();
	const out: SelItem[] = [];
	for (const id of ctx.selectionStore.getState().selectedIds) {
		const found = findNode(ir, id);
		if (!found || found.page.id !== ctx.activePageId || found.node.locked) {
			continue;
		}
		const { x, y } = found.node.transform;
		out.push({
			id,
			x,
			y,
			rect: {
				x,
				y,
				width: found.node.bounds.width,
				height: found.node.bounds.height,
			},
		});
	}
	return out;
}

function moveCmds(
	items: readonly SelItem[],
	deltas: readonly number[],
	axis: "x" | "y",
): CanvasNodeMoveCommand[] {
	return items.map((it, i) => {
		const d = deltas[i] ?? 0;
		return {
			type: "node.move",
			nodeId: it.id,
			from: { x: it.x, y: it.y },
			to: axis === "x" ? { x: it.x + d, y: it.y } : { x: it.x, y: it.y + d },
		};
	});
}

const X_EDGES: ReadonlySet<AlignEdge> = new Set(["left", "right", "hcenter"]);

/**
 * Align the current multi-selection to an edge of its bounding box, as one undo
 * entry. No-op for fewer than 2 nodes. Operates on each node's transform rect.
 */
export function alignSelection(
	ctx: CanvasStudioContextValue,
	edge: AlignEdge,
): void {
	const items = selectedItems(ctx);
	if (items.length < 2) return;
	const deltas = alignRects(
		items.map((it) => it.rect),
		edge,
	);
	ctx.commitBatch(
		moveCmds(items, deltas, X_EDGES.has(edge) ? "x" : "y"),
		"Align",
	);
}

/**
 * Evenly distribute the current multi-selection along an axis (equal gaps, ends
 * fixed), as one undo entry. No-op for fewer than 3 nodes.
 */
export function distributeSelection(
	ctx: CanvasStudioContextValue,
	axis: "x" | "y",
): void {
	const items = selectedItems(ctx);
	if (items.length < 3) return;
	const deltas = distributeRects(
		items.map((it) => it.rect),
		axis,
	);
	ctx.commitBatch(moveCmds(items, deltas, axis), "Distribute");
}

/**
 * FR-072 Tidy Up (C-12): arrange the multi-selection into a clean grid via
 * core's `tidyUpRects`, as one undo entry. No-op for fewer than 2 nodes or
 * when everything is already tidy.
 */
export function tidyUpSelection(ctx: CanvasStudioContextValue): void {
	const items = selectedItems(ctx);
	if (items.length < 2) return;
	const deltas = tidyUpRects(items.map((it) => it.rect));
	const cmds: CanvasNodeMoveCommand[] = [];
	for (const [i, it] of items.entries()) {
		const d = deltas[i];
		if (!d || (d.dx === 0 && d.dy === 0)) continue;
		cmds.push({
			type: "node.move",
			nodeId: it.id,
			from: { x: it.x, y: it.y },
			to: { x: it.x + d.dx, y: it.y + d.dy },
		});
	}
	if (cmds.length === 0) return;
	ctx.commitBatch(cmds, "Tidy up");
}
