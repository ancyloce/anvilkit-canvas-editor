import type { CanvasTemplateDefinition } from "@anvilkit/canvas-core";

/**
 * A starter template supplied by the HOST as plain data (canvas-m0-009,
 * upgraded to the canonical FR-020 contract in canvas-m2-004).
 *
 * Structurally compatible with `@anvilkit/canvas-templates`'s
 * `CanvasTemplateCatalogEntry` so a host can pass that catalog straight
 * through — but the editor deliberately does NOT depend on that package: it
 * is private/unpublished, and this package is publishable. Templates reach
 * the Templates dock panel via `CanvasStudioProps.templates`.
 */
export interface CanvasTemplateEntry extends CanvasTemplateDefinition {
	/** One-line blurb shown under the template's title in the Templates panel. */
	readonly description?: string;
}
