import type {
	CanvasResolvedNodeId,
	CanvasResolvedView,
} from "@anvilkit/canvas-core";
import {
	MAX_COMPONENT_NESTED_DEPTH,
	toResolvedNodeId,
} from "@anvilkit/canvas-core";
import type { CanvasSelectionTarget } from "../stores/selection-store.js";

/**
 * @file Hit → selection mapping for component instances
 * (plan 0023 M4-06, LC-INSTANCE-002, TD §13, AC-007).
 *
 * Two rules the rest of the editor depends on:
 *
 * 1. **A renderer hit id is never a persistent identifier.** A virtual node's id
 *    is codec output that exists only in the resolved tree; it addresses no
 *    document node, so it may never reach `selectedIds`, a command payload, or
 *    anything persisted. This module is the boundary that converts one into a
 *    {@link CanvasSelectionTarget}, and the store's projection is what keeps the
 *    persistent half clean.
 * 2. **Depth is chosen by the gesture, not by the geometry.** A single click
 *    selects the instance ROOT however deep the pointer landed — an instance
 *    reads as one object until the user asks otherwise. Double-click (or Enter
 *    on a focused virtual node) opens Instance Scope on the DEEPEST virtual node
 *    under the pointer, which is inspectable and override-editable but still
 *    takes no persistent-node command.
 *
 * Deliberately Konva-agnostic: it consumes a duck-typed node chain, so the
 * policy is unit-testable without a stage and the tool layer keeps its own
 * (already-tested) traversal idiom.
 */

/** Duck-typed stage node — matches what the tool tests already fake. */
export interface HitNodeLike {
	name?: () => string;
	getParent?: () => HitNodeLike | null;
}

/** Same safety bound the tool's own walkers use. */
const MAX_WALK = 16;

/**
 * The OUTERMOST persistent instance node that owns a resolved record, or `null`
 * for a plain node.
 *
 * Necessary because `CanvasResolvedComponentOrigin.instanceId` is the record's
 * IMMEDIATE owner, which is only a persistent document id at depth 1: inside a
 * NESTED instance it is the nested instance's own VIRTUAL id (the resolver
 * threads the virtual id down as the child expansion's `instanceRecordId`). So
 * a node two levels deep reports an owner like
 * `akv1:6:inst-112:outer-nested` — a codec product that addresses no document
 * node. Following the owner chain to its fixed point is what keeps a virtual id
 * from ever reaching `selectedIds` or a command payload.
 *
 * Bounded by the resolver's own nesting cap plus one, so a hostile or corrupt
 * resolution cannot spin here.
 */
export function persistentInstanceIdFor(
	view: CanvasResolvedView,
	resolvedNodeId: CanvasResolvedNodeId | string,
): string | null {
	const origin = view.getRecord(resolvedNodeId)?.component;
	if (!origin) return null;
	let ownerId = origin.instanceId;
	let safety = MAX_COMPONENT_NESTED_DEPTH + 1;
	while (safety-- > 0) {
		const ownerOrigin = view.getRecord(ownerId)?.component;
		// A top-level instance's root record names ITSELF as its owner: that fixed
		// point is the persistent id we want.
		if (!ownerOrigin || ownerOrigin.instanceId === ownerId) return ownerId;
		ownerId = ownerOrigin.instanceId;
	}
	return ownerId;
}

/**
 * Names on the stage-node chain, DEEPEST FIRST.
 *
 * Anonymous helpers (a frame's background `Rect` carries no name on purpose, so
 * a click on it selects the frame) contribute nothing and are skipped rather
 * than terminating the walk.
 */
export function collectHitNames(
	target: HitNodeLike | null | undefined,
): string[] {
	const names: string[] = [];
	let current: HitNodeLike | null = target ?? null;
	let safety = MAX_WALK;
	while (current && safety-- > 0) {
		const name =
			typeof current.name === "function" ? current.name() : undefined;
		if (name) names.push(name);
		const parent = current.getParent;
		current = typeof parent === "function" ? parent.call(current) : null;
	}
	return names;
}

/**
 * The Instance Scope target for one resolved id, when that id is a virtual node
 * belonging to `instanceId`.
 *
 * Returns `null` for a plain node, for an unknown id, and for a virtual node
 * belonging to a DIFFERENT instance — an instance's scope never reaches into a
 * sibling's expansion.
 */
export function instanceScopeTargetForResolvedId(
	view: CanvasResolvedView,
	resolvedNodeId: CanvasResolvedNodeId | string,
	instanceId: string,
): CanvasSelectionTarget | null {
	const record = view.getRecord(resolvedNodeId);
	const origin = record?.component;
	if (!record || !origin) return null;
	// Compared against the OUTERMOST persistent owner, not the immediate one, so
	// a hit several definitions deep still resolves under the top-level instance
	// the user actually clicked.
	if (persistentInstanceIdFor(view, record.id) !== instanceId) return null;
	return {
		kind: "instance-node",
		instanceId,
		resolvedNodeId: toResolvedNodeId(record.id),
		// The DEFINITION-tree id, which is what a Source-scoped edit and a
		// property binding address — distinct from `record.sourceNodeId`, the
		// record's own addressing field.
		sourceNodeId: origin.definitionNodeId,
	};
}

/**
 * The deepest virtual node of `instanceId` on a stage-hit chain.
 *
 * The chain is walked deepest-first and the first hit that resolves to a record
 * owned by this instance wins, so nested expansions naturally yield their
 * innermost node. Falls back to `null` when the pointer produced no addressable
 * virtual node (a degraded placeholder, or a resolution the caller does not
 * have), which callers treat as "stay on the instance root".
 */
export function instanceScopeTargetAt(
	view: CanvasResolvedView,
	target: HitNodeLike | null | undefined,
	instanceId: string,
): CanvasSelectionTarget | null {
	for (const name of collectHitNames(target)) {
		const scoped = instanceScopeTargetForResolvedId(view, name, instanceId);
		if (scoped) return scoped;
	}
	return null;
}

/**
 * Map any resolved id to the target that should be selected for it.
 *
 * The single-click / keyboard-select rule: a virtual node collapses to its
 * owning instance ROOT, a plain node stays itself. This is what makes an
 * instance read as one object to every existing consumer without those
 * consumers knowing components exist.
 */
export function selectionTargetForResolvedId(
	view: CanvasResolvedView,
	resolvedNodeId: CanvasResolvedNodeId | string,
): CanvasSelectionTarget | null {
	const record = view.getRecord(resolvedNodeId);
	if (!record) return null;
	if (!record.component) return { kind: "node", nodeId: record.sourceNodeId };
	const owner = persistentInstanceIdFor(view, record.id);
	return owner ? { kind: "node", nodeId: owner } : null;
}
