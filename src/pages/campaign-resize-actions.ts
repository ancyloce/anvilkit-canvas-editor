import type { CanvasSizePreset } from "@anvilkit/canvas-core";
import { resizeToVariants } from "@anvilkit/canvas-core";
import type { CanvasStudioContextValue } from "../context/canvas-studio-context.js";
import { switchToPage } from "./page-actions.js";

/**
 * Result of {@link resizeActivePageToVariants}. `ok: false` carries a
 * user-facing message rather than throwing — mirrors `TemplateActionResult`
 * (`template-actions.ts`).
 */
export type CampaignResizeResult =
	| { ok: true; pageIds: readonly string[] }
	| { ok: false; message: string };

/**
 * Generates one new page per preset from `sourcePageId`'s content, commits
 * the whole batch as one undo step, and switches to the first generated
 * variant (FR-061, canvas-m3-007). Presentational callers (e.g. a "Create
 * variants" button) should disable themselves while `presets` is empty
 * rather than calling this with none.
 */
export function resizeActivePageToVariants(
	ctx: CanvasStudioContextValue,
	sourcePageId: string,
	presets: readonly CanvasSizePreset[],
): CampaignResizeResult {
	try {
		const result = resizeToVariants(ctx.getIR(), sourcePageId, presets);
		ctx.commit(result.command);
		const firstVariant = result.pages[0];
		if (firstVariant) switchToPage(ctx, firstVariant.id);
		return { ok: true, pageIds: result.pages.map((page) => page.id) };
	} catch (error) {
		return {
			ok: false,
			message: error instanceof Error ? error.message : String(error),
		};
	}
}
