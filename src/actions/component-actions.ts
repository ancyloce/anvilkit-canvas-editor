"use client";

import type {
	CanvasCommand,
	CanvasComponentDefinition,
	CanvasComponentIdFactories,
	CanvasDocumentLocation,
	CanvasNode,
} from "@anvilkit/canvas-core";
import {
	buildComponentReferenceIndex,
	buildDetachAllAndDeleteCommand,
	buildDetachCommand,
	CanvasCommandError,
	createComponentIdFactories,
	findNode,
} from "@anvilkit/canvas-core";
import type { CanvasStudioContextValue } from "../context/canvas-studio-context.js";
import type {
	CanvasComponentReturnSelection,
	CanvasComponentScopeRejection,
} from "../stores/component-scope-store.js";
import type { AnyCanvasCommand } from "../stores/history-store.js";

/**
 * @file Component document operations for the UI (plan 0023 M5-02/M5-03).
 *
 * Same shape as the other `actions/` modules (`reorder-actions`,
 * `guide-actions`): `*Impl(ctx, …)` free functions that build core commands and
 * commit them through the context, so locked-node protection, batch boundaries,
 * undo granularity and the read-only-document guard all behave identically
 * wherever they are called from.
 *
 * DEV-M5-A — deliberately NOT added to the `CanvasEditorActions` facade. That
 * interface is wired at TWO sites (`createCanvasEditorActions` and
 * `useCanvasActions`) that must be kept in step by hand, and these operations
 * have exactly two callers (the Components panel, rank 3, and the Inspector's
 * component sections) — both of which may import `actions/` (rank 1) directly.
 * Promote them into the facade when a keyboard shortcut or a context menu needs
 * them, not before.
 *
 * Every id is allocated by the CALLER through injected factories, never inside
 * a command handler, which is what keeps create/duplicate replayable.
 */

/** Ids each operation needs, injectable so tests and replays stay deterministic. */
export interface ComponentActionOptions {
	readonly ids?: CanvasComponentIdFactories;
}

function idsOf(options: ComponentActionOptions): CanvasComponentIdFactories {
	return options.ids ?? createComponentIdFactories();
}

/** Commit one command, or several as a single undo entry. */
function commitAll(
	ctx: CanvasStudioContextValue,
	commands: readonly CanvasCommand[],
	label: string,
): boolean {
	const first = commands[0];
	if (!first) return false;
	if (commands.length === 1) ctx.commit(first);
	else ctx.commitBatch(commands, label);
	return true;
}

/**
 * Turn the current selection into a new Component Source plus a first instance
 * in its place (M3-04/M3-05, LC-CREATE-001) — ONE undo entry.
 *
 * Returns the new component id, or `null` when there is nothing to convert.
 * The instance replacing the selection becomes the selection, mirroring the
 * group/paste/duplicate convention.
 */
export function createComponentFromSelectionImpl(
	ctx: CanvasStudioContextValue,
	options: ComponentActionOptions & {
		readonly name?: string;
		readonly rootStrategy?: "reuse-container" | "wrap-in-frame";
	} = {},
): string | null {
	const selectedNodeIds = [...ctx.selectionStore.getState().selectedIds];
	if (selectedNodeIds.length === 0) return null;
	const ir = ctx.getIR();
	// A locked node must not be silently swallowed into a Source: the command
	// layer would reject the batch, so refuse up front with the selection intact.
	if (selectedNodeIds.some((id) => findNode(ir, id)?.node.locked === true)) {
		return null;
	}
	const ids = idsOf(options);
	const componentId = ids.componentId();
	const command: CanvasCommand = {
		type: "component.create",
		mode: "from-selection",
		selectedNodeIds,
		componentId,
		sourceRootId: ids.sourceNodeId(),
		firstInstanceId: ids.sourceNodeId(),
		...(options.name !== undefined ? { name: options.name } : {}),
		...(options.rootStrategy !== undefined
			? { rootStrategy: options.rootStrategy }
			: {}),
	};
	ctx.commit(command);
	// The command allocated `firstInstanceId`; re-read it from the payload rather
	// than guessing, so this stays correct if the handler ever renames the field.
	if (command.mode === "from-selection") {
		ctx.selectionStore.getState().setSelection([command.firstInstanceId]);
	}
	return componentId;
}

/**
 * Insert an instance of `componentId` on the active page (LC-INSTANCE-001).
 *
 * Placed centred on the page at the Source root's own size and selected —
 * the same "insert lands in the middle, selected, one undo step" convention
 * `BrandPanel`'s logo insert uses. Returns the new instance id, or `null` when
 * the component or the page is missing.
 */
export function insertComponentInstanceImpl(
	ctx: CanvasStudioContextValue,
	componentId: string,
	options: ComponentActionOptions & {
		readonly parentId?: string;
		readonly index?: number;
	} = {},
): string | null {
	const ir = ctx.getIR();
	const definition = ir.components?.[componentId];
	if (!definition) return null;
	const page = ir.pages.find((p) => p.id === ctx.activePageId);
	if (!page) return null;
	const bounds = definition.root.bounds;
	const instanceId = idsOf(options).sourceNodeId();
	ctx.commit({
		type: "component-instance.insert",
		componentId,
		instanceId,
		pageId: page.id,
		bounds,
		transform: {
			x: (page.size.width - bounds.width) / 2,
			y: (page.size.height - bounds.height) / 2,
		},
		...(options.parentId !== undefined ? { parentId: options.parentId } : {}),
		...(options.index !== undefined ? { index: options.index } : {}),
	});
	ctx.selectionStore.getState().setSelection([instanceId]);
	return instanceId;
}

/** Rename a Source (M3-06). No-ops on an unchanged or blank name. */
export function renameComponentImpl(
	ctx: CanvasStudioContextValue,
	componentId: string,
	name: string,
): boolean {
	const definition = ctx.getIR().components?.[componentId];
	const next = name.trim();
	if (!definition || next.length === 0 || next === definition.name)
		return false;
	ctx.commit({
		type: "component.rename",
		componentId,
		from: definition.name,
		to: next,
	});
	return true;
}

/**
 * Copy a Source under a fresh id (M3-06). Source node ids are remapped by the
 * command through `regenerateNodeIds`; no instance is created — a duplicate is a
 * new Source, not a new placement.
 */
export function duplicateComponentImpl(
	ctx: CanvasStudioContextValue,
	componentId: string,
	options: ComponentActionOptions & { readonly name?: string } = {},
): string | null {
	if (!ctx.getIR().components?.[componentId]) return null;
	const newComponentId = idsOf(options).componentId();
	ctx.commit({
		type: "component.duplicate",
		componentId,
		newComponentId,
		...(options.name !== undefined ? { name: options.name } : {}),
	});
	return newComponentId;
}

/** How many places still reference a Source, split by reference kind. */
export interface ComponentReferenceCounts {
	readonly pageInstances: number;
	readonly sourceDependencies: number;
	readonly total: number;
}

/**
 * Reference counts for a Source — what the delete dialog needs to decide
 * between a plain delete and "detach all and delete" (M5-06), and what makes
 * that choice explicit to the user instead of implicit in an error.
 */
export function componentReferenceCountsImpl(
	ctx: CanvasStudioContextValue,
	componentId: string,
): ComponentReferenceCounts {
	const index = buildComponentReferenceIndex(ctx.getIR());
	const pageInstances = (index.pageInstancesByComponent.get(componentId) ?? [])
		.length;
	const sourceDependencies = (
		index.sourceDependenciesByComponent.get(componentId) ?? []
	).length;
	return {
		pageInstances,
		sourceDependencies,
		total: pageInstances + sourceDependencies,
	};
}

/**
 * Delete a Source (LC-DELETE).
 *
 * With zero references this is the plain guarded `component.delete`. With
 * references it is `detachAll: true` or nothing: core refuses to delete a
 * referenced definition, and silently detaching would destroy the link the user
 * may not have meant to break. Deleting the last definition drops the
 * `components` key entirely, and one undo restores key, definition and every
 * detached instance (INV-10).
 */
export function deleteComponentImpl(
	ctx: CanvasStudioContextValue,
	componentId: string,
	options: ComponentActionOptions & { readonly detachAll?: boolean } = {},
): boolean {
	const ir = ctx.getIR();
	if (!ir.components?.[componentId]) return false;
	const counts = componentReferenceCountsImpl(ctx, componentId);
	if (counts.total === 0) {
		return commitAll(
			ctx,
			[{ type: "component.delete", componentId }],
			"Delete component",
		);
	}
	if (options.detachAll !== true) return false;
	const ids = idsOf(options);
	// `plan.command` is ALREADY one atomic batch, so it is committed directly
	// rather than wrapped in a second batch: nesting is legal but would add an
	// empty layer to history for nothing.
	const plan = rejectionToNull(() =>
		buildDetachAllAndDeleteCommand(ir, componentId, {
			idFactory: ids.sourceNodeId,
		}),
	);
	if (!plan) return false;
	ctx.commit(plan.command);
	return true;
}

/**
 * Run a core plan builder, mapping its typed rejection to `null`.
 *
 * The `component-ops` builders THROW `CanvasCommandError` when a plan cannot be
 * made safely — a missing Source, a cycle, a degraded resolution, a stale plan.
 * That is the right contract for a command layer (a partially materialized tree
 * would be worse), but an unhandled throw from a panel button reaches the error
 * boundary and takes the editor down. Anything that is NOT a command rejection
 * rethrows: a real bug must stay visible.
 */
function rejectionToNull<T>(build: () => T): T | null {
	try {
		return build();
	} catch (error) {
		if (error instanceof CanvasCommandError) return null;
		throw error;
	}
}

/**
 * Materialize one instance into plain nodes at the same tree position
 * (LC-INSTANCE-005) — ONE undo entry, visual appearance preserved exactly.
 *
 * Returns false when the instance cannot be detached safely (missing Source,
 * cycle, or a degraded resolution): core rejects such a batch atomically rather
 * than emitting a partially-materialized tree, so the UI must not pretend it
 * succeeded.
 */
export function detachComponentInstanceImpl(
	ctx: CanvasStudioContextValue,
	nodeId: string,
	options: ComponentActionOptions = {},
): boolean {
	const ir = ctx.getIR();
	const found = findNode(ir, nodeId);
	if (!found || found.node.type !== "component-instance") return false;
	const plan = rejectionToNull(() =>
		buildDetachCommand(ir, nodeId, {
			idFactory: idsOf(options).sourceNodeId,
		}),
	);
	if (!plan) return false;
	ctx.commit(plan.command);
	// The materialized root keeps the instance's id, so the selection survives
	// detach without being recomputed.
	ctx.selectionStore.getState().setSelection([nodeId]);
	return true;
}

// ---------------------------------------------------------------------------
// Source editing scope (M5-03, LC-CREATE-002). NAVIGATION ONLY — entering or
// leaving a scope is never a document command (PRD §9.11), so none of the
// functions below commit anything.
// ---------------------------------------------------------------------------

/** Where the user is right now, captured so exiting a frame can restore it. */
function currentReturnSelection(
	ctx: CanvasStudioContextValue,
): CanvasComponentReturnSelection {
	const selectedIds = [...ctx.selectionStore.getState().selectedIds];
	const active = ctx.componentScopeStore?.getState().activeFrame() ?? null;
	return active
		? { kind: "component", componentId: active.componentId, selectedIds }
		: { kind: "page", pageId: ctx.activePageId, selectedIds };
}

/**
 * Open a Component Source for editing (LC-CREATE-002).
 *
 * Returns `null` on success, or the reason it was refused: `"already-open"`
 * (the interactive face of the DAG rule — a component cannot contain itself),
 * `"depth-exceeded"`, or `"missing"` when the id is not in the Registry. The
 * caller surfaces the diagnostic; nothing is committed either way.
 */
export function enterComponentSourceImpl(
	ctx: CanvasStudioContextValue,
	componentId: string,
): CanvasComponentScopeRejection | "missing" | null {
	const store = ctx.componentScopeStore;
	if (!store) return "missing";
	if (!ctx.getIR().components?.[componentId]) return "missing";
	const rejection = store.getState().enter({
		componentId,
		returnSelection: currentReturnSelection(ctx),
	});
	if (rejection) return rejection;
	// The Source tree is a different tree: a selection of page nodes means
	// nothing inside it.
	ctx.selectionStore.getState().clearSelection();
	return null;
}

/**
 * Leave the innermost Source, restoring where the user came from.
 *
 * Returns the component id that was left, or `null` when not editing a Source.
 * A return address pointing at a page also switches the active page back, so
 * exiting cannot leave the user on a page they never opened.
 */
export function exitComponentSourceImpl(
	ctx: CanvasStudioContextValue,
): string | null {
	const popped = ctx.componentScopeStore?.getState().exitOne() ?? null;
	if (!popped) return null;
	restoreReturnSelection(ctx, popped.returnSelection);
	return popped.componentId;
}

/** Collapse the whole stack back to the page the outermost frame came from. */
export function exitAllComponentSourcesImpl(
	ctx: CanvasStudioContextValue,
): boolean {
	const outermost = ctx.componentScopeStore?.getState().exitAll() ?? null;
	if (!outermost) return false;
	restoreReturnSelection(ctx, outermost.returnSelection);
	return true;
}

function restoreReturnSelection(
	ctx: CanvasStudioContextValue,
	ret: CanvasComponentReturnSelection,
): void {
	if (ret.kind === "page" && ret.pageId !== ctx.activePageId) {
		ctx.pagesStore.getState().setActivePageId(ret.pageId);
	}
	// Ids that no longer exist are dropped rather than restored blindly: the
	// edit that happened inside the Source may have removed them. NOTE
	// `findNode` returns `null`, not `undefined` — a `!== undefined` test here
	// would pass every id through.
	const ir = ctx.getIR();
	const alive = ret.selectedIds.filter((id) => findNode(ir, id) !== null);
	ctx.selectionStore.getState().setSelection(alive);
}

/**
 * The component definition a command (or any command nested in a batch) edits,
 * or `null` for a page-scoped one.
 *
 * Scoped node commands carry `location: {kind:"component", id}` and so do their
 * inverses (M3-02 threads it through both), which is what makes an undo's target
 * scope knowable BEFORE the inverse is applied.
 */
export function commandComponentLocation(
	command: AnyCanvasCommand | undefined,
): string | null {
	if (!command || typeof command !== "object") return null;
	const location = (command as { location?: CanvasDocumentLocation }).location;
	if (location?.kind === "component") return location.id;
	const nested = (command as { commands?: readonly AnyCanvasCommand[] })
		.commands;
	if (!Array.isArray(nested)) return null;
	for (const sub of nested) {
		const found = commandComponentLocation(sub);
		if (found) return found;
	}
	return null;
}

/**
 * Undo, first navigating to the Source the reverted edit belongs to (M5-03,
 * T-SCOPE-2).
 *
 * A user who edits a Source, leaves it, then presses undo would otherwise watch
 * nothing happen: the document changes inside a tree that is not on screen.
 * Peeking the pending INVERSE's location (never applying it to find out) lets
 * the frame be pushed first, so the revert is visible where it happens.
 *
 * Navigation is not a document command, so the push is not part of the undo
 * entry — redo does not "un-navigate". If the component has since been deleted,
 * this stays put and lets the undo proceed: the entry may be exactly the one
 * that restores it.
 */
export function undoWithScopeImpl(ctx: CanvasStudioContextValue): boolean {
	return applyWithScope(ctx, "undo");
}

/** @see undoWithScopeImpl */
export function redoWithScopeImpl(ctx: CanvasStudioContextValue): boolean {
	return applyWithScope(ctx, "redo");
}

function applyWithScope(
	ctx: CanvasStudioContextValue,
	direction: "undo" | "redo",
): boolean {
	const history = ctx.historyStore.getState();
	const pending =
		direction === "undo" ? history.past.at(-1) : history.future.at(-1);
	if (!pending) return false;
	const componentId = commandComponentLocation(pending);
	const scope = ctx.componentScopeStore;
	if (componentId && scope) {
		const active = scope.getState().activeFrame();
		if (active?.componentId !== componentId) {
			// Already-open means the target is an OUTER frame on the stack; pop back
			// to it instead of rejecting, so the edit is still made visible.
			if (scope.getState().isOpen(componentId)) {
				while (
					scope.getState().activeFrame()?.componentId !== componentId &&
					exitComponentSourceImpl(ctx) !== null
				) {
					// pop until the owning frame is active
				}
			} else {
				enterComponentSourceImpl(ctx, componentId);
			}
		}
	}
	const apply = direction === "undo" ? ctx.undo : ctx.redo;
	if (!apply) return false;
	apply();
	return true;
}

/** Every Source in the document, sorted by name — the panel's read model. */
export function listComponentsImpl(
	ctx: CanvasStudioContextValue,
): readonly CanvasComponentDefinition[] {
	const registry = ctx.getIR().components;
	if (!registry) return [];
	return Object.values(registry).sort(
		(a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id),
	);
}

/** The instance nodes of `componentId` on the active page, in document order. */
export function componentInstancesOnPageImpl(
	ctx: CanvasStudioContextValue,
	componentId: string,
): readonly CanvasNode[] {
	const ir = ctx.getIR();
	const index = buildComponentReferenceIndex(ir);
	const refs = index.pageInstancesByComponent.get(componentId) ?? [];
	const nodes: CanvasNode[] = [];
	for (const ref of refs) {
		if (ref.pageId !== ctx.activePageId) continue;
		const found = findNode(ir, ref.instanceId);
		if (found) nodes.push(found.node);
	}
	return nodes;
}
