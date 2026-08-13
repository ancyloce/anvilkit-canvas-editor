import type Konva from "konva";

/**
 * `CanvasNode.id` → the live Konva nodes currently mounted under that id.
 *
 * A LIST, not a single node, because one IR id can legitimately be mounted
 * more than once at the same moment: `rasterizePage` builds an off-screen
 * stage for thumbnails and exports while the live stage is showing the same
 * page. Keying by id alone would let a live-stage lookup resolve to a node in
 * a detached off-screen stage — a far worse bug than the cost this registry
 * exists to remove — so every lookup still proves the candidate belongs to the
 * container it was asked about.
 */
const registry = new Map<string, Konva.Node[]>();

/**
 * One stable ref callback per id. React detaches and re-attaches a ref whose
 * identity changed, so handing out a fresh closure per render would churn the
 * registry on every commit (and briefly empty it mid-render).
 */
const refCallbacks = new Map<
	string,
	(node: Konva.Node | null) => (() => void) | void
>();

/** Konva tree depth is IR depth (capped at 64) plus stage/layer/chrome groups. */
const MAX_WALK_DEPTH = 128;

function attach(id: string, node: Konva.Node): void {
	const list = registry.get(id);
	if (!list) {
		registry.set(id, [node]);
		return;
	}
	if (!list.includes(node)) list.push(node);
}

function detach(id: string, node: Konva.Node | null): void {
	const list = registry.get(id);
	if (!list) return;
	// `node === null` is the pre-cleanup-callback detach signal, which does not
	// say WHICH instance went away — drop the whole entry and let the fallback
	// below re-resolve. Lookups stay correct either way; this is only about how
	// much work they do.
	if (node === null) {
		registry.delete(id);
		refCallbacks.delete(id);
		return;
	}
	const at = list.indexOf(node);
	if (at >= 0) list.splice(at, 1);
	if (list.length === 0) {
		registry.delete(id);
		refCallbacks.delete(id);
	}
}

/**
 * The `ref` every `commonProps` spread carries, so the id → node index stays
 * current with no per-renderer wiring (K-6).
 *
 * Returns a React 19 ref CLEANUP function, which is what makes the per-node
 * (rather than per-id) detach above possible; the `null` branch in
 * {@link detach} keeps it correct if a renderer ever detaches the old way.
 */
export function canvasNodeRef(
	id: string,
): (node: Konva.Node | null) => (() => void) | void {
	const existing = refCallbacks.get(id);
	if (existing) return existing;
	const cb = (node: Konva.Node | null): (() => void) | void => {
		if (node === null) {
			detach(id, null);
			return;
		}
		attach(id, node);
		return () => detach(id, node);
	};
	refCallbacks.set(id, cb);
	return cb;
}

/** True when `node` is `container` itself or sits somewhere beneath it. */
function isUnder(container: unknown, node: Konva.Node): boolean {
	let cur: Konva.Node | null = node;
	let guard = MAX_WALK_DEPTH;
	while (cur && guard-- > 0) {
		if ((cur as unknown) === container) return true;
		const parentOf: (() => Konva.Node | null) | undefined = (
			cur as { getParent?: () => Konva.Node | null }
		).getParent;
		cur = typeof parentOf === "function" ? parentOf.call(cur) : null;
	}
	return false;
}

/**
 * Look up the live Konva node for a `CanvasNode.id` (`CanvasNodeRenderer`'s
 * `commonProps` sets `id`, `name` AND the registering `ref` to it).
 *
 * Resolves through the {@link registry} first — an O(depth) parent walk to
 * confirm the candidate is really under `container` — and only falls back to
 * a tree scan on a miss. That fallback is what keeps this honest: the
 * registry is an index, never the source of truth, so an unregistered node
 * (a partial test mount, a fake stage, a renderer that forgot the ref) still
 * resolves exactly as it did before, just slower.
 *
 * The scan uses a PREDICATE rather than Konva's string-selector syntax
 * (`findOne('#'+id)`): Konva's matcher strips every space and splits on commas
 * before comparing (`Node.prototype._isMatch`), so a `CanvasNode.id`
 * containing either character — ids are untrusted, looseObject/hostile-peer by
 * design — silently fails to resolve, or resolves against the wrong node
 * (E-13). It is also a full depth-first walk of the container
 * (`Container._generalFind`), which is exactly the per-frame cost the registry
 * removes: `select-tool`'s move loop and the Transformer's re-point both ran
 * one of these per selected node per pointermove.
 */
export function findNodeById(
	container: Pick<Konva.Container, "findOne">,
	id: string,
): Konva.Node | undefined {
	const candidates = registry.get(id);
	if (candidates && candidates.length > 0) {
		for (const candidate of candidates) {
			if (isUnder(container, candidate)) return candidate;
		}
	}
	return container.findOne((node: Konva.Node) => node.id() === id);
}

/** Test seam: drop every registration (no-op in production code paths). */
export function resetCanvasNodeRegistryForTests(): void {
	registry.clear();
	refCallbacks.clear();
}
