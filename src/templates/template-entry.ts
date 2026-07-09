import type { CanvasIR } from "@anvilkit/canvas-core";

/**
 * A starter template supplied by the HOST as plain data (canvas-m0-009).
 *
 * Structurally compatible with `@anvilkit/canvas-templates`' `CanvasTemplate`
 * so a host can pass that catalog straight through — but the editor
 * deliberately does NOT depend on that package: it is private/unpublished,
 * and this package is publishable. Templates reach the Templates dock panel
 * via `CanvasStudioProps.templates`.
 */
export interface CanvasTemplateEntry {
	/** Stable identifier (list key + testids). */
	readonly slug: string;
	/** Display name shown in the Templates panel. */
	readonly name: string;
	/** One-line blurb shown under the name. */
	readonly description?: string;
	/** The design to load. Never mutated — pages are cloned with fresh ids. */
	readonly ir: CanvasIR;
}
