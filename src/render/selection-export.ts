import {
	type Aabb,
	type AffineMatrix,
	type CanvasNode,
	type CanvasPage,
	isContainerNode,
	multiplyMatrix,
	nodeWorldAabb,
	toAffineMatrix,
} from "@anvilkit/canvas-core";

/**
 * FR-031 "Export selection": derive a synthetic page containing ONLY the
 * selected subtrees, framed to their combined world-space AABB.
 *
 * The original tree structure is preserved (selected nodes keep their whole
 * subtree; unselected containers survive only as pass-throughs when they hold
 * a selected descendant), so nested transforms stay correct without any
 * matrix re-composition — only the page-root-level children shift by the
 * AABB origin. Returns null when nothing selected resolves on the page.
 */
export function buildSelectionExportPage(
	page: CanvasPage,
	selectedIds: readonly string[],
): CanvasPage | null {
	const selected = new Set(selectedIds);
	if (selected.size === 0) return null;

	// Union AABB over the OUTERMOST selected nodes (a node inside a selected
	// ancestor is already covered by that ancestor's box).
	const bounds: Aabb = {
		minX: Number.POSITIVE_INFINITY,
		minY: Number.POSITIVE_INFINITY,
		maxX: Number.NEGATIVE_INFINITY,
		maxY: Number.NEGATIVE_INFINITY,
	};
	let found = false;
	const measure = (node: CanvasNode, parent: AffineMatrix): void => {
		if (selected.has(node.id)) {
			const aabb = nodeWorldAabb(node, parent);
			bounds.minX = Math.min(bounds.minX, aabb.minX);
			bounds.minY = Math.min(bounds.minY, aabb.minY);
			bounds.maxX = Math.max(bounds.maxX, aabb.maxX);
			bounds.maxY = Math.max(bounds.maxY, aabb.maxY);
			found = true;
			return;
		}
		if (isContainerNode(node)) {
			const m = multiplyMatrix(parent, toAffineMatrix(node.transform));
			for (const child of node.children) measure(child, m);
		}
	};
	measure(
		page.root,
		toAffineMatrix({ x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1 }),
	);
	if (!found) return null;

	// Keep a node when it is selected (whole subtree) or holds a selected
	// descendant (container survives as a pass-through with filtered children).
	const filter = (node: CanvasNode): CanvasNode | null => {
		if (selected.has(node.id)) return node;
		if (!isContainerNode(node)) return null;
		const children = node.children
			.map(filter)
			.filter((c): c is CanvasNode => c !== null);
		if (children.length === 0) return null;
		return { ...node, children };
	};
	const keptChildren = page.root.children
		.map(filter)
		.filter((c): c is CanvasNode => c !== null);
	if (keptChildren.length === 0) return null;

	const width = Math.max(1, Math.ceil(bounds.maxX - bounds.minX));
	const height = Math.max(1, Math.ceil(bounds.maxY - bounds.minY));

	// Only page-root-level children need shifting: everything deeper stays
	// relative to its (kept) parent. The page root itself keeps its own
	// (untransformed) identity, so the synthetic page stays a valid
	// `CanvasGroupNode` root.
	const shifted = keptChildren.map((child) => ({
		...child,
		transform: {
			...child.transform,
			x: child.transform.x - bounds.minX,
			y: child.transform.y - bounds.minY,
		},
	}));

	return {
		...page,
		id: `${page.id}-selection`,
		size: { ...page.size, width, height },
		root: { ...page.root, children: shifted },
	};
}
