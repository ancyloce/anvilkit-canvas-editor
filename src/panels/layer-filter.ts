import type {
	CanvasIR,
	CanvasNode,
	CanvasNodeKind,
	CanvasPage,
} from "@anvilkit/canvas-core";
import { isContainerNode } from "@anvilkit/canvas-core";
import { zoomToSelectionImpl } from "../actions/viewport-actions.js";
import type { CanvasStudioContextValue } from "../context/canvas-studio-context.js";
import { switchToPage } from "../pages/page-actions.js";

/**
 * Layer search + find layer (C-08, FR-053/FR-191). Pure predicates over the
 * layer tree — filtering NEVER modifies the document — plus the cross-page
 * find/reveal action.
 */

export type LayerVisibilityFilter = "all" | "visible" | "hidden";
export type LayerLockFilter = "all" | "locked" | "unlocked";

export interface LayerFilter {
	/** Case-insensitive substring over the display name, kind, and (FR-191) text content. */
	query: string;
	kind: CanvasNodeKind | "all";
	visibility: LayerVisibilityFilter;
	lock: LayerLockFilter;
}

export const EMPTY_LAYER_FILTER: LayerFilter = {
	query: "",
	kind: "all",
	visibility: "all",
	lock: "all",
};

export function isEmptyLayerFilter(filter: LayerFilter): boolean {
	return (
		filter.query.trim() === "" &&
		filter.kind === "all" &&
		filter.visibility === "all" &&
		filter.lock === "all"
	);
}

/** Text content of a node (FR-191): `text` nodes and rich-text spans. */
export function nodeTextContent(node: CanvasNode): string {
	if (node.type === "text") return node.text;
	if (node.type === "rich-text") {
		return node.paragraphs
			.map((p) => p.spans.map((s) => s.text).join(""))
			.join("\n");
	}
	return "";
}

export function matchesLayerFilter(
	node: CanvasNode,
	filter: LayerFilter,
): boolean {
	if (filter.kind !== "all" && node.type !== filter.kind) return false;
	const visible = node.visible !== false;
	if (filter.visibility === "visible" && !visible) return false;
	if (filter.visibility === "hidden" && visible) return false;
	const locked = node.locked === true;
	if (filter.lock === "locked" && !locked) return false;
	if (filter.lock === "unlocked" && locked) return false;
	const query = filter.query.trim().toLowerCase();
	if (!query) return true;
	const haystack = [node.name ?? "", node.type, nodeTextContent(node)]
		.join(" ")
		.toLowerCase();
	return haystack.includes(query);
}

export interface FindLayerResult {
	pageId: string;
	pageIndex: number;
	pageName: string | undefined;
	node: CanvasNode;
}

function collectMatches(
	page: CanvasPage,
	pageIndex: number,
	filter: LayerFilter,
	out: FindLayerResult[],
	limit: number,
): void {
	const visit = (children: readonly CanvasNode[]): void => {
		for (const child of children) {
			if (out.length >= limit) return;
			if (matchesLayerFilter(child, filter)) {
				out.push({
					pageId: page.id,
					pageIndex,
					pageName: page.name,
					node: child,
				});
			}
			if (isContainerNode(child)) visit(child.children);
		}
	};
	visit(page.root.children);
}

/** FR-191: search every page's tree, document order, capped at `limit`. */
export function findLayers(
	ir: CanvasIR,
	filter: LayerFilter,
	limit = 50,
): FindLayerResult[] {
	const out: FindLayerResult[] = [];
	ir.pages.forEach((page, pageIndex) => {
		if (out.length < limit) collectMatches(page, pageIndex, filter, out, limit);
	});
	return out;
}

/**
 * FR-191 reveal: switch to the result's page, select the node, and zoom to
 * it. The layer panel's FR-051 auto-reveal then scrolls the row into view.
 * Selection/viewport only — never a history entry.
 */
export function revealLayer(
	ctx: CanvasStudioContextValue,
	result: FindLayerResult,
): void {
	if (ctx.pagesStore.getState().activePageId !== result.pageId) {
		switchToPage(ctx, result.pageId);
	}
	ctx.selectionStore.getState().setSelection([result.node.id]);
	zoomToSelectionImpl(ctx);
}
