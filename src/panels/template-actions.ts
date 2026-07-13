import type {
	CanvasBatchCommand,
	CanvasCommand,
	CanvasIR,
	InstantiateTemplateWarning,
} from "@anvilkit/canvas-core";
import { instantiateTemplate } from "@anvilkit/canvas-core";
import type { CanvasStudioContextValue } from "../context/canvas-studio-context.js";
import { switchToPage } from "../pages/page-actions.js";
import type { CanvasTemplateEntry } from "../templates/template-entry.js";

/**
 * Result of a template action. `ok: false` carries a structured, user-facing
 * message (canvas-m2-004 / FR-023) — e.g. an invalid template schema — rather
 * than throwing; `ok: true` carries any non-fatal `instantiateTemplate`
 * warnings (missing required variables, unsupported slot/node combinations)
 * so the panel can surface them without parsing strings.
 */
export type TemplateActionResult =
	| { ok: true; warnings: readonly InstantiateTemplateWarning[] }
	| { ok: false; message: string };

interface Instantiated {
	document: CanvasIR;
	command: CanvasBatchCommand;
	warnings: readonly InstantiateTemplateWarning[];
}

function runInstantiation(
	entry: CanvasTemplateEntry,
): Instantiated | { message: string } {
	try {
		return instantiateTemplate(entry);
	} catch (error) {
		return {
			message: error instanceof Error ? error.message : String(error),
		};
	}
}

/**
 * Replace the current document's pages with a template's pages, as ONE undo
 * entry (canvas-m0-009 / FR-005, upgraded to `instantiateTemplate` in
 * canvas-m2-004). The batch creates the new pages first, then deletes the
 * previous ones — ordering that never violates the schema's one-page minimum.
 * Undoing the batch restores the prior pages and removes the template's.
 */
export function loadTemplate(
	ctx: CanvasStudioContextValue,
	entry: CanvasTemplateEntry,
): TemplateActionResult {
	const result = runInstantiation(entry);
	if ("message" in result) return { ok: false, message: result.message };

	const previousPageIds = ctx.getIR().pages.map((p) => p.id);
	const commands: CanvasCommand[] = [
		...result.command.commands,
		...previousPageIds.map(
			(pageId): CanvasCommand => ({ type: "page.delete", pageId }),
		),
	];
	ctx.commitBatch(commands, `Load template: ${entry.title}`);

	const firstPage = result.document.pages[0];
	if (firstPage) switchToPage(ctx, firstPage.id);
	return { ok: true, warnings: result.warnings };
}

/**
 * Insert a template's pages as NEW pages alongside the current document's
 * existing pages, as ONE undo entry — the "create new" counterpart to
 * {@link loadTemplate}'s "replace" (FR-023, UX-001). `<CanvasStudio>` owns one
 * live multi-page scene rather than a document tab set, so "create a new
 * document" is expressed here as appending a fresh, non-destructive set of
 * pages rather than discarding the current ones.
 */
export function insertTemplateAsNewPages(
	ctx: CanvasStudioContextValue,
	entry: CanvasTemplateEntry,
): TemplateActionResult {
	const result = runInstantiation(entry);
	if ("message" in result) return { ok: false, message: result.message };

	ctx.commit(result.command);

	const firstPage = result.document.pages[0];
	if (firstPage) switchToPage(ctx, firstPage.id);
	return { ok: true, warnings: result.warnings };
}
