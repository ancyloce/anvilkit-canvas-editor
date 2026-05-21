import type {
	CanvasGroupNode,
	CanvasNode,
	CanvasPage,
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
 * Walk a structurally-cloned (JSON-roundtripped) node tree and rewrite every
 * `id` field with a fresh uuid. Recurses into `group.children`. Exported
 * separately so tests can verify id regeneration in isolation.
 */
export function regenerateIds(node: CanvasNode): CanvasNode {
	node.id = freshId();
	if (node.type === "group") {
		for (const child of node.children) {
			regenerateIds(child);
		}
	}
	return node;
}

export interface ClonePageOptions {
	/** Override the cloned page's name (default: appends ' copy' to original). */
	name?: string;
}

/**
 * Deep-clone a CanvasPage with a brand-new page id and fresh ids on every
 * descendant node. Uses structured JSON cloning — safe because the IR is
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
	const cloned = JSON.parse(JSON.stringify(page)) as CanvasPage;
	cloned.id = freshId();
	const baseName = page.name ?? "Page";
	cloned.name = opts.name ?? `${baseName} copy`;
	cloned.root = regenerateIds(cloned.root) as CanvasGroupNode;
	return cloned;
}
