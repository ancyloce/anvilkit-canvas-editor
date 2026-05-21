import {
	type CanvasPageCreateCommand,
	type CanvasPageDeleteCommand,
	type CanvasPageSize,
	createPage,
} from "@anvilkit/canvas-core";
import type { CanvasStudioContextValue } from "../context/canvas-studio-context.js";
import { clonePage } from "./clone-page.js";

export interface AddPageOptions {
	name?: string;
	size?: CanvasPageSize;
}

/**
 * Append a fresh blank page to the IR, commit `page.create`, and activate it.
 * Returns the new page id.
 */
export function addPage(
	ctx: CanvasStudioContextValue,
	opts: AddPageOptions = {},
): string {
	const page = createPage({
		...(opts.name !== undefined ? { name: opts.name } : {}),
		...(opts.size !== undefined ? { size: opts.size } : {}),
	});
	const cmd: CanvasPageCreateCommand = {
		type: "page.create",
		page,
	};
	ctx.commit(cmd);
	ctx.pagesStore.getState().setActivePageId(page.id);
	return page.id;
}

/**
 * Deep-clone the currently active page (including all nodes with fresh ids),
 * insert it directly after the original, and activate the clone. Returns the
 * clone's id, or null if there is no active page in the current IR.
 */
export function duplicateCurrentPage(
	ctx: CanvasStudioContextValue,
): string | null {
	const ir = ctx.getIR();
	const activeId = ctx.pagesStore.getState().activePageId;
	const originalIndex = ir.pages.findIndex((p) => p.id === activeId);
	if (originalIndex < 0) return null;
	const original = ir.pages[originalIndex]!;
	const cloned = clonePage(original);
	const cmd: CanvasPageCreateCommand = {
		type: "page.create",
		page: cloned,
		index: originalIndex + 1,
	};
	ctx.commit(cmd);
	ctx.pagesStore.getState().setActivePageId(cloned.id);
	return cloned.id;
}

/**
 * Delete a page. No-op when only one page remains (last-page guard — empty
 * IR would render the "no active page" fallback in `<CanvasStudio>`).
 * If the deleted page was active, moves active to the page at the same index
 * (or the previous one if the deleted was last).
 */
export function deletePage(
	ctx: CanvasStudioContextValue,
	pageId: string,
): void {
	const ir = ctx.getIR();
	const targetIndex = ir.pages.findIndex((p) => p.id === pageId);
	if (targetIndex < 0) return;
	if (ir.pages.length <= 1) return;
	const wasActive = ctx.pagesStore.getState().activePageId === pageId;
	const cmd: CanvasPageDeleteCommand = {
		type: "page.delete",
		pageId,
	};
	ctx.commit(cmd);
	if (wasActive) {
		const remaining = ir.pages.filter((p) => p.id !== pageId);
		// Prefer page at original index (i.e., the next page slid into the slot)
		// — fall back to the last remaining page when the deleted was last.
		const next = remaining[targetIndex] ?? remaining[remaining.length - 1];
		if (next) ctx.pagesStore.getState().setActivePageId(next.id);
	}
}

/**
 * Switch active page AND clear transient UI state — selection, draft (any
 * in-progress drag), text editor, and smart guides. Without the clears, a
 * stale `selectionStore.selectedIds` would point at node ids that don't
 * exist on the newly active page.
 */
export function switchToPage(
	ctx: CanvasStudioContextValue,
	pageId: string,
): void {
	if (ctx.pagesStore.getState().activePageId === pageId) return;
	ctx.pagesStore.getState().setActivePageId(pageId);
	ctx.selectionStore.getState().clearSelection();
	ctx.draftStore.getState().clearDraft();
	ctx.editingStore.getState().clearEditing();
	ctx.guidesStore.getState().clearGuides();
}
