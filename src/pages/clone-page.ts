import {
	type CanvasNode,
	type CanvasPage,
	regenerateNodeIds,
} from "@anvilkit/canvas-core";

function freshId(): string {
	if (
		typeof crypto !== "undefined" &&
		typeof crypto.randomUUID === "function"
	) {
		return crypto.randomUUID();
	}
	// Deterministic-ish fallback for environments without WebCrypto. Tests
	// should always have crypto.randomUUID via modern jsdom (>=22).
	return `id-${Math.random().toString(36).slice(2)}-${Date.now().toString(36)}`;
}

/**
 * Rewrite every `id` in a node tree with a fresh uuid. Thin wrapper over
 * core's shared `regenerateNodeIds` primitive (M0-05) — kept for the existing
 * `internal.ts` export surface. NOTE: unlike the pre-M0-05 version this does
 * not mutate its input; callers must use the returned copy.
 */
export function regenerateIds<T extends CanvasNode>(node: T): T {
	return regenerateNodeIds(node, { idFactory: freshId }).node;
}

export interface ClonePageOptions {
	/** Override the cloned page's name (default: appends ' copy' to original). */
	name?: string;
}

/**
 * Deep-clone a CanvasPage with a brand-new page id and fresh ids on every
 * descendant node. Uses `structuredClone` — safe because the IR is
 * pure data (per `CanvasNode` types in `@anvilkit/canvas-core`).
 *
 * The original `page` is not mutated. The returned page has:
 *   - new `id`
 *   - `name` set per `opts.name` (or `"<original.name ?? 'Page'> copy"`)
 *   - `root.children[*]` cloned with fresh ids (preserving transforms, bounds)
 */
export function clonePage(
	page: CanvasPage,
	opts: ClonePageOptions = {},
): CanvasPage {
	const cloned = structuredClone(page);
	cloned.id = freshId();
	const baseName = page.name ?? "Page";
	cloned.name = opts.name ?? `${baseName} copy`;
	cloned.root = regenerateIds(cloned.root);
	return cloned;
}
