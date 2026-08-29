import type {
	CanvasComponentGraph,
	CanvasComponentRegistry,
	CanvasComponentResolutionCache,
	CanvasIR,
	CanvasLayoutMeasurementProvider,
	CanvasNode,
	CanvasResolvedComponentDocument,
	CanvasResolvedView,
} from "@anvilkit/canvas-core";
import {
	buildComponentGraph,
	createComponentResolutionCache,
	createResolvedView,
	isContainerNode,
	localComponentIdOf,
	resolveCanvasDocument,
} from "@anvilkit/canvas-core";
import { createStore, type StoreApi } from "zustand/vanilla";
import type { CanvasInteractionPerformanceTracker } from "../perf/interaction-performance.js";
import { createCanvasLayoutMeasurementProvider } from "../text/canvas-text-measurer.js";
import { subscribeFontManifest } from "../text/font-status.js";
import type {
	FieldPreviewPatch,
	FieldPreviewStoreApi,
	PagePreviewPatch,
} from "./field-preview-store.js";
import type { SceneStoreApi } from "./scene-store.js";

/**
 * @file T-M3-05 — the ONE resolved document per render context.
 *
 * Derives `resolveCanvasDocument(effective IR)` from the scene store and the
 * field-preview store, where the effective IR is the committed document with
 * any live preview patches shallow-merged over their nodes — the same merge
 * `node.update` applies on commit (§10 field contract), applied to a COPY:
 * previews never write the IR. Every geometry consumer (renderer, hit-test,
 * snap, a11y, thumbnails, export) reads THIS store, which is what guarantees
 * they all see one resolved tree; the editor itself contains no solver.
 *
 * Committed scene writes re-resolve synchronously, so the scene and its
 * resolution can never be observed out of sync within one React batch. Live
 * preview writes are coalesced to one animation-frame pass: pointer events may
 * arrive faster than paint, but only the latest preview value needs resolving.
 * Each pass threads the previous document as the warm-path seed; untouched
 * records stay reference-identical (TD §5.4), which is what lets consumers
 * memoise on record identity.
 *
 * Plan 0023 M4-03: the entry point is the COMPOSED resolver
 * (`resolveCanvasDocument`) — component expansion strictly before Auto Layout —
 * which PRD §9.13 makes the only path a component-bearing document may take.
 * A component-free document short-circuits inside it to the plain solver and
 * comes back byte-identical, so this is not a behavior change for documents
 * without components. There is deliberately no second component-resolution
 * hook: a parallel path is how the Editor, hit testing, a11y and export drift
 * apart, and this store already exists to be the single one.
 */

export interface ResolvedDocumentState {
	/**
	 * Resolution of the committed IR with live preview patches merged in.
	 *
	 * `CanvasResolvedComponentDocument` is an additive subtype of
	 * `CanvasResolvedDocument` — it adds `componentIssues` and nothing else — so
	 * every existing geometry consumer reads it unchanged, while component-aware
	 * surfaces (the missing-Source placeholder, the diagnostics UI) get the
	 * expansion diagnostics from the same object that produced the records.
	 */
	resolved: CanvasResolvedComponentDocument;
	/** Read adapter over {@link resolved} (TD §12.1); replaced per resolution. */
	view: CanvasResolvedView;
}

export interface ResolvedDocumentStoreApi
	extends StoreApi<ResolvedDocumentState> {
	/**
	 * Start deriving from the source stores (and the font manifest) and
	 * recompute once immediately. Returns the disconnect function — the
	 * `useEffect(() => store.connect(), [store])` shape, so a StrictMode
	 * double-mount never leaks a subscription.
	 */
	connect: () => () => void;
}

export interface CreateResolvedDocumentStoreOptions {
	sceneStore: SceneStoreApi;
	fieldPreviewStore: FieldPreviewStoreApi;
	/** Defaults to the editor's own cached Canvas2D provider. */
	measurement?: CanvasLayoutMeasurementProvider;
	interactionPerformance?: CanvasInteractionPerformanceTracker;
	/**
	 * Test/host seam for the preview resolution frame. The default uses
	 * `requestAnimationFrame`, with a timer fallback outside the browser.
	 */
	schedulePreviewResolution?: CanvasPreviewResolutionScheduler;
}

export type CanvasPreviewResolutionScheduler = (
	callback: () => void,
) => () => void;

const scheduleAnimationFrame: CanvasPreviewResolutionScheduler = (callback) => {
	if (typeof globalThis.requestAnimationFrame === "function") {
		const handle = globalThis.requestAnimationFrame(() => callback());
		return () => globalThis.cancelAnimationFrame(handle);
	}
	const handle = globalThis.setTimeout(callback, 0);
	return () => globalThis.clearTimeout(handle);
};

/**
 * Shallow-merge preview patches over their nodes AND their pages, sharing every
 * untouched subtree. Page patches (plan 0024 Phase 2) carry page-level
 * properties — size, background — that no `node.update` can express.
 */
function withPreviews(
	ir: CanvasIR,
	previews: Readonly<Record<string, FieldPreviewPatch>>,
	pagePreviews: Readonly<Record<string, PagePreviewPatch>>,
): CanvasIR {
	if (
		Object.keys(previews).length === 0 &&
		Object.keys(pagePreviews).length === 0
	) {
		return ir;
	}
	let changed = false;
	const pages = ir.pages.map((page) => {
		const root = patchNode(page.root, previews);
		const pagePatch = Object.hasOwn(pagePreviews, page.id)
			? pagePreviews[page.id]
			: undefined;
		if (root === page.root && !pagePatch) return page;
		changed = true;
		// `id`/`root` are excluded from PagePreviewPatch at the TYPE level only —
		// nothing checks at runtime, and a `buildPatch` that returns a widened or
		// spread page object (`{...page, size}`) carries `id` straight through.
		// A previewed page whose id no longer matches `activePageId` makes
		// `useActivePage` return undefined and blanks the background, grid and
		// guide overlays mid-drag, so restore BOTH identity fields after the
		// spread rather than trusting the type to hold.
		return {
			...page,
			...(pagePatch ?? {}),
			id: page.id,
			root: root as typeof page.root,
		};
	});
	return changed ? { ...ir, pages } : ir;
}

function patchNode(
	node: CanvasNode,
	previews: Readonly<Record<string, FieldPreviewPatch>>,
): CanvasNode {
	// `Object.hasOwn`, not a bare lookup: these maps are plain object literals, so
	// an id of `constructor`/`toString` would otherwise resolve to an INHERITED
	// function — truthy, so every resolution would allocate a fresh node and
	// spread a function's properties over it.
	const patch = Object.hasOwn(previews, node.id)
		? previews[node.id]
		: undefined;
	let children: CanvasNode[] | undefined;
	if (isContainerNode(node)) {
		let childChanged = false;
		const next = node.children.map((child) => {
			const patched = patchNode(child, previews);
			if (patched !== child) childChanged = true;
			return patched;
		});
		if (childChanged) children = next;
	}
	if (!patch && !children) return node;
	return {
		...node,
		...(patch ?? {}),
		...(children ? { children } : {}),
	} as CanvasNode;
}

/**
 * Component ids whose definition object changed identity between two Registry
 * snapshots — added, edited, or removed.
 *
 * Correctness never depends on this: the resolver's cache key already folds in
 * `sourceRevision` and the nested dependency-revision hash, so a stale entry
 * can only ever be MISSED, never wrongly hit. What it buys is memory — a long
 * editing session would otherwise accumulate one dead instance-layer entry per
 * Source edit forever (TD §11.3 step 5).
 */
function changedComponentIds(
	before: CanvasComponentRegistry | undefined,
	after: CanvasComponentRegistry | undefined,
): readonly string[] {
	if (before === after) return [];
	const changed: string[] = [];
	for (const [id, definition] of Object.entries(after ?? {})) {
		if (before?.[id] !== definition) changed.push(id);
	}
	for (const id of Object.keys(before ?? {})) {
		if (!(after && id in after)) changed.push(id);
	}
	return changed;
}

interface DirtyResolutionScope {
	readonly pageIds: readonly string[];
	readonly nodeIds: readonly string[];
}

function collectSubtreeNodeIds(node: CanvasNode, target: Set<string>): void {
	target.add(node.id);
	if (!isContainerNode(node)) return;
	for (const child of node.children) collectSubtreeNodeIds(child, target);
}

function isAutoLayoutNode(node: CanvasNode): boolean {
	return node.type === "frame" && node.autoLayout !== undefined;
}

/**
 * Identity-aware tree diff. Immutable commands rebuild only the edited path,
 * so equal object identity prunes an untouched subtree in O(1). Every changed
 * ancestor is included; an Auto Layout ancestor widens the closure to its
 * complete subtree because sibling placement and Fill/Hug constraints depend
 * on one another.
 */
function collectChangedNodeIds(
	before: CanvasNode,
	after: CanvasNode,
	target: Set<string>,
): boolean {
	if (before === after) return false;
	if (before.id !== after.id || before.type !== after.type) {
		collectSubtreeNodeIds(before, target);
		collectSubtreeNodeIds(after, target);
		return true;
	}
	target.add(before.id);
	target.add(after.id);
	if (!isContainerNode(before) || !isContainerNode(after)) return true;

	const beforeById = new Map(before.children.map((child) => [child.id, child]));
	let dependentChildChanged = before.children.length !== after.children.length;
	for (const child of after.children) {
		const previousChild = beforeById.get(child.id);
		if (!previousChild) {
			collectSubtreeNodeIds(child, target);
			dependentChildChanged = true;
			continue;
		}
		beforeById.delete(child.id);
		if (collectChangedNodeIds(previousChild, child, target)) {
			dependentChildChanged = true;
		}
	}
	for (const removed of beforeById.values()) {
		collectSubtreeNodeIds(removed, target);
		dependentChildChanged = true;
	}
	if (
		dependentChildChanged &&
		(isAutoLayoutNode(before) || isAutoLayoutNode(after))
	) {
		collectSubtreeNodeIds(before, target);
		collectSubtreeNodeIds(after, target);
	}
	return true;
}

function dependentComponentIds(
	changed: readonly string[],
	graph: CanvasComponentGraph,
): ReadonlySet<string> {
	const affected = new Set(changed);
	let grew = true;
	while (grew) {
		grew = false;
		for (const [componentId, dependencies] of graph.dependencies) {
			if (
				affected.has(componentId) ||
				!dependencies.some((dependency) => affected.has(dependency))
			) {
				continue;
			}
			affected.add(componentId);
			grew = true;
		}
	}
	return affected;
}

function collectDependentInstanceIds(
	node: CanvasNode,
	affectedComponents: ReadonlySet<string>,
	target: Set<string>,
): boolean {
	const componentId =
		node.type === "component-instance"
			? localComponentIdOf(node.source)
			: undefined;
	let affected =
		componentId !== undefined && affectedComponents.has(componentId);
	if (isContainerNode(node)) {
		for (const child of node.children) {
			if (collectDependentInstanceIds(child, affectedComponents, target)) {
				affected = true;
			}
		}
	}
	if (!affected) return false;
	target.add(node.id);
	if (isAutoLayoutNode(node)) collectSubtreeNodeIds(node, target);
	return true;
}

function dirtyResolutionScope(
	before: CanvasIR | undefined,
	after: CanvasIR,
	changedComponents: readonly string[],
	graph: CanvasComponentGraph | undefined,
): DirtyResolutionScope | undefined {
	if (!before || before.id !== after.id || before.assets !== after.assets) {
		return undefined;
	}
	const pageIds = new Set<string>();
	const nodeIds = new Set<string>();
	const beforePages = new Map(before.pages.map((page) => [page.id, page]));
	for (const page of after.pages) {
		const previousPage = beforePages.get(page.id);
		if (!previousPage) {
			pageIds.add(page.id);
			collectSubtreeNodeIds(page.root, nodeIds);
			continue;
		}
		beforePages.delete(page.id);
		if (previousPage === page) continue;
		pageIds.add(page.id);
		collectChangedNodeIds(previousPage.root, page.root, nodeIds);
	}
	for (const removedPage of beforePages.values()) {
		pageIds.add(removedPage.id);
		collectSubtreeNodeIds(removedPage.root, nodeIds);
	}

	if (changedComponents.length > 0 && graph) {
		const affectedComponents = dependentComponentIds(changedComponents, graph);
		for (const page of after.pages) {
			if (collectDependentInstanceIds(page.root, affectedComponents, nodeIds)) {
				pageIds.add(page.id);
			}
		}
	}

	return {
		pageIds: [...pageIds].sort(),
		nodeIds: [...nodeIds].sort(),
	};
}

export function createResolvedDocumentStore(
	options: CreateResolvedDocumentStoreOptions,
): ResolvedDocumentStoreApi {
	const measurement =
		options.measurement ?? createCanvasLayoutMeasurementProvider();
	// One cache per store, i.e. per editor instance — never a module singleton:
	// two editors, or an editor and an export pass, resolve different documents
	// in one process and must not share resolution state.
	const componentCache: CanvasComponentResolutionCache =
		createComponentResolutionCache();
	const schedulePreviewResolution =
		options.schedulePreviewResolution ?? scheduleAnimationFrame;
	let lastRegistry: CanvasComponentRegistry | undefined;
	let lastEffective: CanvasIR | undefined;

	const resolve = (
		previous?: CanvasResolvedComponentDocument,
		forceFull = false,
	): ResolvedDocumentState => {
		const previewState = options.fieldPreviewStore.getState();
		const effective = withPreviews(
			options.sceneStore.getState().ir,
			previewState.previews,
			previewState.pagePreviews,
		);
		const registry = effective.components;
		const dirty = changedComponentIds(lastRegistry, registry);
		const graph =
			dirty.length > 0 ? buildComponentGraph(registry ?? {}) : undefined;
		if (graph) {
			// Invalidating a component drops its transitive DEPENDENTS too, so an
			// edit to a nested Source releases the hosts that embed it while
			// unrelated components keep their entries (T-PERF-1).
			for (const id of dirty) componentCache.invalidateComponent(id, graph);
		}
		lastRegistry = registry;
		const dirtyScope = forceFull
			? undefined
			: dirtyResolutionScope(lastEffective, effective, dirty, graph);
		const frame = options.interactionPerformance?.current();
		const resolved = resolveCanvasDocument(effective, {
			measurement,
			componentCache,
			...(previous ? { previous } : {}),
			...(dirtyScope
				? {
						dirtyPageIds: dirtyScope.pageIds,
						dirtyNodeIds: dirtyScope.nodeIds,
					}
				: {}),
			...(options.interactionPerformance
				? {
						onPhaseMeasured: ({ phase, durationMs }) => {
							options.interactionPerformance?.recordDuration(
								frame,
								phase,
								durationMs,
							);
						},
					}
				: {}),
		});
		lastEffective = effective;
		return { resolved, view: createResolvedView(resolved) };
	};

	const store = createStore<ResolvedDocumentState>()(() => resolve());

	const recompute = (forceFull = false): void => {
		store.setState(resolve(store.getState().resolved, forceFull));
	};
	let cancelScheduledPreview: (() => void) | undefined;

	const cancelPendingPreview = (): void => {
		const cancel = cancelScheduledPreview;
		cancelScheduledPreview = undefined;
		cancel?.();
	};

	const recomputeSynchronously = (forceFull = false): void => {
		// A committed scene write is the final source of truth. Cancel an older
		// preview frame before resolving it so commit produces exactly one pass and
		// a canceled callback cannot overwrite the final resolved document.
		cancelPendingPreview();
		recompute(forceFull);
	};

	const schedulePreviewRecompute = (): void => {
		if (cancelScheduledPreview) return;
		let completedSynchronously = false;
		const cancel = schedulePreviewResolution(() => {
			completedSynchronously = true;
			cancelScheduledPreview = undefined;
			recompute();
		});
		// A synchronous scheduler is useful in focused tests. Do not retain its
		// already-completed cancellation handle as though a frame were pending.
		if (!completedSynchronously) cancelScheduledPreview = cancel;
	};

	const connect = (): (() => void) => {
		recomputeSynchronously();
		const unsubscribers = [
			options.sceneStore.subscribe(() => recomputeSynchronously()),
			options.fieldPreviewStore.subscribe(schedulePreviewRecompute),
			subscribeFontManifest(() => recomputeSynchronously(true)),
		];
		return () => {
			cancelPendingPreview();
			for (const unsubscribe of unsubscribers) unsubscribe();
		};
	};

	return Object.assign(store, { connect });
}
