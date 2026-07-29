import {
	type CanvasIR,
	type CanvasNode,
	isContainerNode,
} from "@anvilkit/canvas-core";

/**
 * @file Pure Auto Layout intent detection (rank-0 leaf). Shared by the
 * clipboard capability stamp (T-M4-12), the pre-save pipeline, and the
 * recovery mirror (T-M5-03) — one definition of "carries layout intent" so
 * the capability writers cannot drift from each other.
 */

/** True when any node in the subtree carries Auto Layout intent. */
export function subtreeHasLayoutIntent(node: CanvasNode): boolean {
	if (node.type === "frame" && node.autoLayout != null) return true;
	if (node.layoutItem != null) return true;
	return isContainerNode(node) && node.children.some(subtreeHasLayoutIntent);
}

/** True when any page of the document carries Auto Layout intent. */
export function irCarriesLayoutIntent(ir: CanvasIR): boolean {
	return ir.pages.some((page) =>
		page.root.children.some(subtreeHasLayoutIntent),
	);
}
