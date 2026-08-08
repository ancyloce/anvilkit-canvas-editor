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
export interface CanvasTemplateEntry
	extends Omit<CanvasTemplateDefinition, "tags"> {
	/** One-line blurb shown under the template's title in the Templates panel. */
	readonly description?: string;
	/**
	 * Free-form discovery tags — matched by the panel's free-text search and by
	 * the tag facet (cp3-006). Case-insensitive; compare normalised.
	 *
	 * OPTIONAL here, though `CanvasTemplateDefinition.tags` is required. This is
	 * the one field where the editor deliberately accepts LESS than the
	 * canonical contract, because this type sits at a host boundary: a catalog
	 * arriving over the wire, or from an untyped JS host, routinely omits it,
	 * and the panel must render such an entry rather than throw spreading
	 * `undefined`. Widening an input type is backwards-compatible in the
	 * direction that matters — every catalog that satisfied the old required
	 * shape still satisfies this one. Code that READS `entry.tags` must handle
	 * `undefined`; `@anvilkit/canvas-templates` still declares tags required, so
	 * the first-party catalog is always tagged.
	 *
	 * Mirrors `CanvasComponentCatalogEntry.tags`, which made the same call at
	 * the same boundary — one shape for host-supplied tags across both panels.
	 */
	readonly tags?: readonly string[];
}
