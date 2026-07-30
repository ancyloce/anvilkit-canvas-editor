import type {
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
	resolveCanvasDocument,
} from "@anvilkit/canvas-core";
import { createStore, type StoreApi } from "zustand/vanilla";
import { createCanvasLayoutMeasurementProvider } from "../text/canvas-text-measurer.js";
import { subscribeFontManifest } from "../text/font-status.js";
import type {
	FieldPreviewPatch,
	FieldPreviewStoreApi,
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
 * Re-resolution is synchronous inside the source stores' `set` calls, so the
 * scene and its resolution can never be observed out of sync within one
 * React batch. Each pass threads the previous document as the warm-path seed:
 * untouched records stay reference-identical (TD §5.4), which is what lets
 * consumers memoise on record identity.
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
}

/** Shallow-merge preview patches over their nodes, sharing every untouched subtree. */
function withPreviews(
	ir: CanvasIR,
	previews: Readonly<Record<string, FieldPreviewPatch>>,
): CanvasIR {
	if (Object.keys(previews).length === 0) return ir;
	let changed = false;
	const pages = ir.pages.map((page) => {
		const root = patchNode(page.root, previews);
		if (root === page.root) return page;
		changed = true;
		return { ...page, root: root as typeof page.root };
	});
	return changed ? { ...ir, pages } : ir;
}

function patchNode(
	node: CanvasNode,
	previews: Readonly<Record<string, FieldPreviewPatch>>,
): CanvasNode {
	const patch = previews[node.id];
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
	let lastRegistry: CanvasComponentRegistry | undefined;

	const resolve = (
		previous?: CanvasResolvedComponentDocument,
	): ResolvedDocumentState => {
		const effective = withPreviews(
			options.sceneStore.getState().ir,
			options.fieldPreviewStore.getState().previews,
		);
		const registry = effective.components;
		const dirty = changedComponentIds(lastRegistry, registry);
		if (dirty.length > 0) {
			const graph = buildComponentGraph(registry ?? {});
			// Invalidating a component drops its transitive DEPENDENTS too, so an
			// edit to a nested Source releases the hosts that embed it while
			// unrelated components keep their entries (T-PERF-1).
			for (const id of dirty) componentCache.invalidateComponent(id, graph);
		}
		lastRegistry = registry;
		const resolved = resolveCanvasDocument(effective, {
			measurement,
			componentCache,
			...(previous ? { previous } : {}),
		});
		return { resolved, view: createResolvedView(resolved) };
	};

	const store = createStore<ResolvedDocumentState>()(() => resolve());

	const recompute = (): void => {
		store.setState(resolve(store.getState().resolved));
	};

	const connect = (): (() => void) => {
		recompute();
		const unsubscribers = [
			options.sceneStore.subscribe(recompute),
			options.fieldPreviewStore.subscribe(recompute),
			subscribeFontManifest(recompute),
		];
		return () => {
			for (const unsubscribe of unsubscribers) unsubscribe();
		};
	};

	return Object.assign(store, { connect });
}
