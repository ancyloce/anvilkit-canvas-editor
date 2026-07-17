import type {
	CanvasContainerNode,
	CanvasIR,
	CanvasNode,
	CanvasPage,
} from "@anvilkit/canvas-core";
import { findNode, isContainerNode } from "@anvilkit/canvas-core";
import type { CanvasStudioContextValue } from "../context/canvas-studio-context.js";

/**
 * Container isolation helpers (C-09, FR-055) + progressive select-all
 * (FR-190). Pure over the IR except the two ctx-taking actions at the
 * bottom. Everything resolves through the VALIDATED path so a container
 * deleted or reparented mid-isolation degrades gracefully instead of
 * wedging selection scope.
 */

const EMPTY_NODES: readonly CanvasNode[] = [];

/**
 * Trim a stored isolation path to its longest valid prefix: each entry must
 * be a container that is a descendant-chain child of the previous entry
 * (first entry: reachable from the page root).
 */
export function validateIsolationPath(
	page: CanvasPage,
	path: readonly string[],
): readonly string[] {
	const valid: string[] = [];
	let scope: readonly CanvasNode[] = page.root.children;
	for (const id of path) {
		const container = findInSubtree(scope, id);
		if (!container || !isContainerNode(container)) break;
		valid.push(id);
		scope = container.children;
	}
	return valid.length === path.length ? [...path] : valid;
}

function findInSubtree(
	children: readonly CanvasNode[],
	id: string,
): CanvasNode | undefined {
	for (const child of children) {
		if (child.id === id) return child;
		if (isContainerNode(child)) {
			const hit = findInSubtree(child.children, id);
			if (hit) return hit;
		}
	}
	return undefined;
}

/** The innermost isolated container, after validation. Null when not isolated. */
export function activeIsolationContainer(
	page: CanvasPage,
	path: readonly string[],
): CanvasContainerNode | null {
	const valid = validateIsolationPath(page, path);
	const innermost = valid.at(-1);
	if (!innermost) return null;
	const node = findInSubtree(page.root.children, innermost);
	return node && isContainerNode(node) ? node : null;
}

/**
 * The children selection/marquee/select-all operate over (FR-055): the
 * innermost isolated container's children, or the page's top-level children
 * with no isolation.
 */
export function isolationScopeChildren(
	page: CanvasPage | undefined,
	path: readonly string[],
): readonly CanvasNode[] {
	if (!page) return EMPTY_NODES;
	const container = activeIsolationContainer(page, path);
	return container ? container.children : page.root.children;
}

/**
 * Ids that render dimmed and non-hit-testable while isolated: at every level
 * of the (validated) path, the siblings that are NOT the next path entry.
 * The innermost container's own content stays fully live. Empty set = no
 * isolation.
 */
export function computeDimmedIds(
	page: CanvasPage,
	path: readonly string[],
): ReadonlySet<string> {
	const valid = validateIsolationPath(page, path);
	const dimmed = new Set<string>();
	let scope: readonly CanvasNode[] = page.root.children;
	for (const id of valid) {
		for (const sibling of scope) {
			if (sibling.id !== id) dimmed.add(sibling.id);
		}
		const container = findInSubtree(scope, id);
		if (!container || !isContainerNode(container)) break;
		scope = container.children;
	}
	return dimmed;
}

/**
 * Double-click / menu entry (FR-055): enter isolation for `nodeId` when it
 * is a group or frame inside the current scope. Returns true when entered.
 */
export function enterIsolationImpl(
	ctx: CanvasStudioContextValue,
	nodeId: string,
): boolean {
	const store = ctx.isolationStore;
	if (!store) return false;
	const found = findNode(ctx.getIR(), nodeId);
	if (!found || !isContainerNode(found.node)) return false;
	store.getState().enter(nodeId);
	// Entering a container scopes the selection to it; the container itself
	// is no longer selectable, so drop it from the selection.
	ctx.selectionStore
		.getState()
		.setSelection(
			ctx.selectionStore.getState().selectedIds.filter((id) => id !== nodeId),
		);
	return true;
}

/**
 * FR-190 progressive select-all: select every unlocked node in the current
 * scope; when the scope is already fully selected AND isolation is active,
 * exit one level and select everything there (container → page on repeat).
 */
export function progressiveSelectAllImpl(ctx: CanvasStudioContextValue): void {
	const ir: CanvasIR = ctx.getIR();
	const pageId = ctx.pagesStore.getState().activePageId;
	const page = ir.pages.find((p) => p.id === pageId);
	if (!page) return;
	const store = ctx.isolationStore;
	const path = store?.getState().path ?? [];
	const selectable = (children: readonly CanvasNode[]): string[] =>
		children.flatMap((node) => (node.locked === true ? [] : [node.id]));
	let ids = selectable(isolationScopeChildren(page, path));
	const selected = new Set(ctx.selectionStore.getState().selectedIds);
	const fullySelected = ids.length > 0 && ids.every((id) => selected.has(id));
	if (fullySelected && store && path.length > 0) {
		store.getState().exitOne();
		ids = selectable(isolationScopeChildren(page, store.getState().path));
	}
	ctx.selectionStore.getState().setSelection(ids);
}
