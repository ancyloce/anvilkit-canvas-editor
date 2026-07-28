import type {
	Aabb,
	AffineMatrix,
	CanvasBounds,
	CanvasNode,
	CanvasResolvedDocument,
	CanvasResolvedNodeRecord,
	ResolvedHitTarget,
} from "@anvilkit/canvas-core";
import {
	applyMatrix,
	invertMatrix,
	matrixBoundsExtent,
	multiplyMatrix,
	pointInResolvedNode,
	toResolvedNodeId,
} from "@anvilkit/canvas-core";
import type { ResolvedDocumentStoreApi } from "../stores/resolved-document-store.js";

/**
 * @file T-M3-07 — the editor's PAGE-SPACE view over resolved records.
 *
 * The resolver's world space includes the page ROOT's own transform (the root
 * record is emitted against the identity), while the editor's stage, overlay,
 * marquee, and snap convention is page space, which EXCLUDES it — the stage
 * mounts the root's CHILDREN, and `resolveNodeWorldPosition` documents (and
 * the M0 coordinate suite pins) that composing the root in would double-count
 * it. For the identity root every built document has, the two spaces
 * coincide and these helpers pass resolver geometry through untouched; the
 * compensation path exists so a document whose root transform was edited
 * programmatically still lands hit-tests and overlays where the stage draws.
 *
 * One adapter, shared by every migrated consumer, so the compensation math
 * exists exactly once.
 */

export interface ResolvedPageSpace {
	recordOf(nodeId: string): CanvasResolvedNodeRecord | undefined;
	/** Page-space (root-excluded) world matrix. */
	matrixOf(nodeId: string): AffineMatrix | undefined;
	/** Page-space world AABB. */
	aabbOf(nodeId: string): Aabb | undefined;
	/** Resolved local box size. */
	boundsOf(nodeId: string): CanvasBounds | undefined;
	/** Page-space position of the node's local origin. */
	originOf(nodeId: string): { x: number; y: number } | undefined;
	/** Containment test against the node's page-space box. */
	pointIn(nodeId: string, point: { x: number; y: number }): boolean | undefined;
	/**
	 * A core-compatible hit target carrying page-space geometry, for
	 * `hitTestResolved`/`marqueeHitsResolved`. Undefined when the node has no
	 * record in this resolution.
	 */
	targetOf(node: CanvasNode): ResolvedHitTarget | undefined;
}

function isIdentity(m: AffineMatrix): boolean {
	return (
		m[0] === 1 &&
		m[1] === 0 &&
		m[2] === 0 &&
		m[3] === 1 &&
		m[4] === 0 &&
		m[5] === 0
	);
}

/** Build the page-space adapter over one resolution. */
export function createResolvedPageSpace(
	resolved: CanvasResolvedDocument,
): ResolvedPageSpace {
	// Root inverse per root record id; null = identity (or degenerate) → pass
	// resolver geometry through untouched.
	const rootInverses = new Map<string, AffineMatrix | null>();

	const recordOf = (nodeId: string): CanvasResolvedNodeRecord | undefined =>
		resolved.records.get(toResolvedNodeId(nodeId));

	const rootInverseFor = (
		record: CanvasResolvedNodeRecord,
	): AffineMatrix | null => {
		let root = record;
		while (root.parentId) {
			const parent = resolved.records.get(root.parentId);
			if (!parent) break;
			root = parent;
		}
		const cached = rootInverses.get(root.id);
		if (cached !== undefined) return cached;
		let inverse: AffineMatrix | null = null;
		const rootWorld = root.geometry.worldTransform;
		if (!isIdentity(rootWorld)) {
			try {
				inverse = invertMatrix(rootWorld);
			} catch {
				// Degenerate root — fall back to resolver space rather than lose
				// every descendant.
				inverse = null;
			}
		}
		rootInverses.set(root.id, inverse);
		return inverse;
	};

	const matrixFor = (record: CanvasResolvedNodeRecord): AffineMatrix => {
		const rootInv = rootInverseFor(record);
		return rootInv
			? multiplyMatrix(rootInv, record.geometry.worldTransform)
			: record.geometry.worldTransform;
	};

	const aabbFor = (record: CanvasResolvedNodeRecord): Aabb => {
		const rootInv = rootInverseFor(record);
		if (!rootInv) return record.geometry.worldAabb;
		return matrixBoundsExtent(
			matrixFor(record),
			record.geometry.bounds.width,
			record.geometry.bounds.height,
		);
	};

	const targetFor = (
		node: CanvasNode,
		record: CanvasResolvedNodeRecord,
	): ResolvedHitTarget => {
		const rootInv = rootInverseFor(record);
		if (!rootInv) return record;
		return {
			node,
			geometry: {
				worldTransform: matrixFor(record),
				bounds: record.geometry.bounds,
				worldAabb: aabbFor(record),
			},
		};
	};

	return {
		recordOf,
		matrixOf: (nodeId) => {
			const record = recordOf(nodeId);
			return record ? matrixFor(record) : undefined;
		},
		aabbOf: (nodeId) => {
			const record = recordOf(nodeId);
			return record ? aabbFor(record) : undefined;
		},
		boundsOf: (nodeId) => recordOf(nodeId)?.geometry.bounds,
		originOf: (nodeId) => {
			const record = recordOf(nodeId);
			if (!record) return undefined;
			const [x, y] = applyMatrix(matrixFor(record), 0, 0);
			return { x, y };
		},
		pointIn: (nodeId, point) => {
			const record = recordOf(nodeId);
			if (!record) return undefined;
			return pointInResolvedNode(targetFor(record.node, record), point);
		},
		targetOf: (node) => {
			const record = recordOf(node.id);
			return record ? targetFor(node, record) : undefined;
		},
	};
}

/**
 * The page-space adapter over a store's CURRENT resolution, or null when the
 * store is absent (lightweight tool tests, partial contexts) — callers fall
 * back to raw stored-geometry helpers, which agree for documents without
 * layout intent.
 */
export function resolvedPageSpace(
	store: ResolvedDocumentStoreApi | undefined | null,
): ResolvedPageSpace | null {
	if (!store) return null;
	return createResolvedPageSpace(store.getState().resolved);
}

/**
 * Resolved-tree variant of `resolveNodeWorldPosition` (T-M3-07): the
 * page-space position of a node's local origin, from its resolved record —
 * so an overlay anchored to an Auto Layout child follows the FLOW position,
 * not the stale stored transform. Same page-root exclusion as the raw
 * function; null when the node has no record.
 */
export function resolvedNodeWorldPosition(
	resolved: CanvasResolvedDocument,
	nodeId: string,
): { x: number; y: number } | null {
	return createResolvedPageSpace(resolved).originOf(nodeId) ?? null;
}
