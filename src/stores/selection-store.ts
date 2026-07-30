import type { CanvasResolvedNodeId } from "@anvilkit/canvas-core";
import { createStore, type StoreApi } from "zustand/vanilla";

/**
 * What the user has selected, richly enough to describe a node INSIDE a
 * component instance (plan 0023 M4-04, LC-INSTANCE-002, TD §13.1).
 *
 * `"node"` is an ordinary persistent document node — the only kind that
 * existed before components, and still the only kind any persistent-node
 * command may address.
 *
 * `"instance-node"` is a VIRTUAL node produced by expanding an instance. It
 * carries three ids because each answers a different question:
 * - `instanceId` — the persistent node that owns it, i.e. what the transformer
 *   moves, what a `node.*` command may target, and what
 *   {@link projectSelectionTargets} reports;
 * - `resolvedNodeId` — its identity in the resolved tree, for hit testing,
 *   focus, and reading its record;
 * - `sourceNodeId` — its identity inside the DEFINITION tree, which is what a
 *   Source-scoped edit or a property binding addresses.
 */
export type CanvasSelectionTarget =
	| { readonly kind: "node"; readonly nodeId: string }
	| {
			readonly kind: "instance-node";
			readonly instanceId: string;
			readonly resolvedNodeId: CanvasResolvedNodeId;
			readonly sourceNodeId: string;
	  };

/** The persistent node id a target resolves to for command/transform purposes. */
export function selectionTargetNodeId(target: CanvasSelectionTarget): string {
	return target.kind === "node" ? target.nodeId : target.instanceId;
}

/**
 * The PERSISTENT-NODE projection of a target list — the `selectedIds` contract
 * every pre-component consumer reads (TD §13.1).
 *
 * Deduplicated: two virtual nodes selected inside ONE instance project to the
 * same persistent id, and `selectedIds` has always been a unique list.
 */
export function projectSelectionTargets(
	targets: readonly CanvasSelectionTarget[],
): string[] {
	return unique(targets.map(selectionTargetNodeId));
}

export interface SelectionState {
	/**
	 * Persistent-node selection. DELIBERATELY UNCHANGED in shape and meaning:
	 * the transformer, align/group/crop/path-edit actions, Inspector sections,
	 * layer panel, a11y tree, and export-by-selection all read this, and M4-04's
	 * contract is that none of them had to change. It is always exactly
	 * {@link projectSelectionTargets} of {@link targets} — an invariant pinned by
	 * test, because two sources of truth that can drift is the whole risk here.
	 */
	selectedIds: string[];
	/**
	 * The richer selection (plan 0023 M4-04). Only component-aware surfaces read
	 * it; everything else keeps using {@link selectedIds}. For a selection with
	 * no virtual nodes this is just the plain-node mirror of it.
	 */
	targets: readonly CanvasSelectionTarget[];
	setSelection: (ids: readonly string[]) => void;
	/**
	 * Select an explicit target list — the component-aware entry point (e.g. the
	 * hit-test policy resolving a click inside an instance). `selectedIds` is
	 * re-derived, never set independently.
	 */
	setTargets: (targets: readonly CanvasSelectionTarget[]) => void;
	addToSelection: (id: string) => void;
	removeFromSelection: (id: string) => void;
	toggleSelection: (id: string) => void;
	clearSelection: () => void;
	isSelected: (id: string) => boolean;
}

export type SelectionStoreApi = StoreApi<SelectionState>;

function unique(ids: readonly string[]): string[] {
	return Array.from(new Set(ids));
}

const asNodeTargets = (ids: readonly string[]): CanvasSelectionTarget[] =>
	ids.map((nodeId) => ({ kind: "node", nodeId }) as const);

/** Both fields from one target list, so they can never be set out of step. */
function fromTargets(targets: readonly CanvasSelectionTarget[]): {
	selectedIds: string[];
	targets: readonly CanvasSelectionTarget[];
} {
	return { selectedIds: projectSelectionTargets(targets), targets };
}

export function createSelectionStore(): SelectionStoreApi {
	return createStore<SelectionState>()((set, get) => ({
		selectedIds: [],
		targets: [],
		setSelection(ids) {
			set(fromTargets(asNodeTargets(unique(ids))));
		},
		setTargets(targets) {
			set(fromTargets(targets));
		},
		addToSelection(id) {
			set((s) =>
				s.selectedIds.includes(id)
					? s
					: fromTargets([...s.targets, { kind: "node", nodeId: id }]),
			);
		},
		removeFromSelection(id) {
			set((s) =>
				fromTargets(
					s.targets.filter((t) => selectionTargetNodeId(t) !== id),
					// Dropping a persistent id drops EVERY target under it, including
					// virtual nodes inside that instance — the instance is gone from the
					// selection, so a target pointing into it would be orphaned.
				),
			);
		},
		toggleSelection(id) {
			set((s) =>
				s.selectedIds.includes(id)
					? fromTargets(
							s.targets.filter((t) => selectionTargetNodeId(t) !== id),
						)
					: fromTargets([...s.targets, { kind: "node", nodeId: id }]),
			);
		},
		clearSelection() {
			set({ selectedIds: [], targets: [] });
		},
		isSelected(id) {
			return get().selectedIds.includes(id);
		},
	}));
}
