import {
	type CanvasIR,
	type CanvasNode,
	findNode,
} from "@anvilkit/canvas-core";

export type InspectorSelectionMode = "none" | "single" | "multi";

/**
 * What the inspector knows about the current selection (M0-07). Introduced
 * ahead of multi-selection editing (PRD 0012 FR-070 / B-12): today the
 * inspector renders {@link primary} only — the first selected node, the
 * pre-refactor behavior — but the summary already computes the multi-selection
 * facts (resolved nodes, kind set, shared kind) that the shared-property and
 * mixed-value UI will consume, so B-12 changes rendering, not plumbing.
 */
export interface InspectorSelectionSummary {
	mode: InspectorSelectionMode;
	/** The node the inspector edits today: the FIRST selected node, or null. */
	primary: CanvasNode | null;
	/** Every selected id that resolves to a node, in selection order. */
	nodes: readonly CanvasNode[];
	/** Distinct node kinds across the resolved selection. */
	kinds: ReadonlySet<string>;
	/** The one shared kind, or null when the selection mixes kinds (or is empty). */
	sharedKind: string | null;
}

export function summarizeSelection(
	ir: CanvasIR,
	selectedIds: readonly string[],
): InspectorSelectionSummary {
	const nodes: CanvasNode[] = [];
	for (const id of selectedIds) {
		const found = findNode(ir, id);
		if (found) nodes.push(found.node);
	}
	const kinds = new Set(nodes.map((n) => n.type));
	const first = nodes[0] ?? null;
	return {
		mode: nodes.length === 0 ? "none" : nodes.length === 1 ? "single" : "multi",
		primary: first,
		nodes,
		kinds,
		sharedKind: kinds.size === 1 ? (first?.type ?? null) : null,
	};
}
