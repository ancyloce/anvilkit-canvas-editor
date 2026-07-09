import type { CanvasCommand } from "@anvilkit/canvas-core";
import type { CanvasStudioContextValue } from "../context/canvas-studio-context.js";
import { clonePage } from "../pages/clone-page.js";
import { switchToPage } from "../pages/page-actions.js";
import type { CanvasTemplateEntry } from "../templates/template-entry.js";

/**
 * Replace the current document's pages with a template's pages, as ONE undo
 * entry (canvas-m0-009 / FR-005).
 *
 * Template pages are cloned with regenerated ids (a template can be loaded
 * twice, and its authored ids must never collide with the live document).
 * The batch creates the new pages first, then deletes the previous ones —
 * ordering that never violates the schema's one-page minimum. Undoing the
 * batch restores the prior pages and removes the template's.
 */
export function loadTemplate(
	ctx: CanvasStudioContextValue,
	entry: CanvasTemplateEntry,
): void {
	const multiPage = entry.ir.pages.length > 1;
	const pages = entry.ir.pages.map((page, i) =>
		clonePage(page, {
			name: page.name ?? (multiPage ? `${entry.name} ${i + 1}` : entry.name),
		}),
	);
	const firstPage = pages[0];
	if (!firstPage) return;

	const previousPageIds = ctx.getIR().pages.map((p) => p.id);
	const commands: CanvasCommand[] = [
		...pages.map(
			(page, index): CanvasCommand => ({ type: "page.create", page, index }),
		),
		...previousPageIds.map(
			(pageId): CanvasCommand => ({ type: "page.delete", pageId }),
		),
	];

	ctx.commitBatch(commands, `Load template: ${entry.name}`);
	switchToPage(ctx, firstPage.id);
}
