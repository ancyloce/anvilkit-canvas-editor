import {
	type CanvasCommand,
	type CanvasIR,
	type CanvasNode,
	type CanvasNodeMoveCommand,
	type CanvasNodeResizeCommand,
	type CanvasNodeRotateCommand,
	isContainerNode,
	parentOf,
} from "@anvilkit/canvas-core";

/**
 * Pure command builders + focus navigation for keyboard canvas operation (a11y).
 * DOM-free and unit-testable; every edit produces the SAME `CanvasCommand` a
 * mouse gesture would, so undo/history/collab are identical.
 */

export type ArrowKeyName = "ArrowLeft" | "ArrowRight" | "ArrowUp" | "ArrowDown";

/**
 * T-M4-08: keyboard flow reorder. When EVERY node is a Flow child of an Auto
 * Layout frame, a primary-axis arrow moves it one slot within its parent —
 * the SAME single `node.reorder` per node the drag path commits (flow order
 * IS `children` order; focus is id-keyed, so it travels with the node).
 * Cross-axis arrows return an empty array: handled, deliberately a no-op
 * (nudging a flow child would only write a stale transform the resolver
 * overrides). Returns `null` when any node is not a flow child — the caller
 * falls through to the plain nudge path.
 */
export function flowReorderCommands(
	ir: CanvasIR,
	nodes: readonly CanvasNode[],
	key: ArrowKeyName,
): CanvasCommand[] | null {
	if (nodes.length === 0) return null;
	const cmds: CanvasCommand[] = [];
	for (const node of nodes) {
		if (node.layoutItem?.positioning === "absolute") return null;
		const parent = parentOf(ir, node.id)?.parent;
		if (!parent || parent.type !== "frame" || !parent.autoLayout) return null;
		const horizontal = parent.autoLayout.direction === "horizontal";
		const delta =
			key === (horizontal ? "ArrowLeft" : "ArrowUp")
				? -1
				: key === (horizontal ? "ArrowRight" : "ArrowDown")
					? 1
					: 0;
		if (delta === 0) continue;
		const idx = parent.children.findIndex((c) => c.id === node.id);
		if (idx < 0) continue;
		const toIndex = Math.min(
			Math.max(idx + delta, 0),
			parent.children.length - 1,
		);
		if (toIndex === idx) continue;
		cmds.push({ type: "node.reorder", nodeId: node.id, toIndex });
	}
	return cmds;
}

/** Move a node by (dx, dy) — a `node.move` command. */
export function nudgeCommand(
	node: CanvasNode,
	dx: number,
	dy: number,
): CanvasNodeMoveCommand {
	return {
		type: "node.move",
		nodeId: node.id,
		from: { x: node.transform.x, y: node.transform.y },
		to: { x: node.transform.x + dx, y: node.transform.y + dy },
	};
}

/** Grow/shrink a node's bounds by (dw, dh), clamped to ≥1 — a `node.resize`. */
export function resizeStepCommand(
	node: CanvasNode,
	dw: number,
	dh: number,
): CanvasNodeResizeCommand {
	const width = Math.max(1, node.bounds.width + dw);
	const height = Math.max(1, node.bounds.height + dh);
	return {
		type: "node.resize",
		nodeId: node.id,
		from: {
			x: node.transform.x,
			y: node.transform.y,
			width: node.bounds.width,
			height: node.bounds.height,
		},
		to: { x: node.transform.x, y: node.transform.y, width, height },
	};
}

/** Rotate a node by `deg` degrees — a `node.rotate` command. */
export function rotateStepCommand(
	node: CanvasNode,
	deg: number,
): CanvasNodeRotateCommand {
	return {
		type: "node.rotate",
		nodeId: node.id,
		from: node.transform.rotation,
		to: node.transform.rotation + deg,
	};
}

export type FocusNavKey =
	| "ArrowDown"
	| "ArrowUp"
	| "ArrowLeft"
	| "ArrowRight"
	| "Enter"
	| "Escape";

function flattenNodes(nodes: readonly CanvasNode[]): CanvasNode[] {
	const out: CanvasNode[] = [];
	const visit = (n: CanvasNode): void => {
		out.push(n);
		if (isContainerNode(n)) {
			for (const child of n.children) visit(child);
		}
	};
	for (const n of nodes) visit(n);
	return out;
}

/**
 * Resolve a focus-navigation keypress to the next focused node id, walking the
 * page's nodes in pre-order (so Down/Right step into container children — group
 * or frame — and Up/Left step back out). Wraps at the ends. `Escape` clears
 * focus; `Enter` keeps the current.
 */
export function nextFocusId(
	page: { root: CanvasNode },
	current: string | null,
	key: FocusNavKey,
): string | null {
	if (key === "Escape") return null;
	const root = page.root;
	const flat = isContainerNode(root) ? flattenNodes(root.children) : [];
	if (flat.length === 0) return null;
	if (key === "Enter") return current;

	const idx = current ? flat.findIndex((n) => n.id === current) : -1;
	if (key === "ArrowDown" || key === "ArrowRight") {
		return (flat[idx + 1] ?? flat[0])?.id ?? null;
	}
	// ArrowUp / ArrowLeft
	return (idx <= 0 ? flat[flat.length - 1] : flat[idx - 1])?.id ?? null;
}
