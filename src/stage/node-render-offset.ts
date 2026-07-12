import type { CanvasNode } from "@anvilkit/canvas-core";

/**
 * Offset (in content units) between a node's Konva `position()` and its IR
 * top-left transform.
 *
 * `Konva.Ellipse`/`Konva.RegularPolygon`/`Konva.Star` are all centered at
 * `(x, y)`, so `CanvasNodeRenderer` draws them at `transform + bounds/2`;
 * every other node renders at its top-left, so their Konva position equals
 * the IR transform.
 *
 * Interaction code that mutates `konvaNode.position()` directly during a drag
 * (the move preview in `select-tool`) MUST add this offset — otherwise a
 * centered node is placed by its center where its top-left should go and drifts
 * by half its bounds while dragging, snapping back only when the committed IR
 * re-renders. Single source of truth for that mapping.
 */
export function nodeRenderOffset(node: CanvasNode): { x: number; y: number } {
	if (
		node.type === "ellipse" ||
		node.type === "polygon" ||
		node.type === "star"
	) {
		return { x: node.bounds.width / 2, y: node.bounds.height / 2 };
	}
	return { x: 0, y: 0 };
}
