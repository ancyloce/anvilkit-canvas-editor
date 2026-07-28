import type {
	CanvasIR,
	CanvasLayoutMeasurementProvider,
	CanvasNode,
	CanvasResolvedDocument,
	CanvasResolvedView,
} from "@anvilkit/canvas-core";
import {
	createResolvedView,
	isContainerNode,
	resolveCanvasLayout,
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
 * Derives `resolveCanvasLayout(effective IR)` from the scene store and the
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
 */

export interface ResolvedDocumentState {
	/** Resolution of the committed IR with live preview patches merged in. */
	resolved: CanvasResolvedDocument;
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

export function createResolvedDocumentStore(
	options: CreateResolvedDocumentStoreOptions,
): ResolvedDocumentStoreApi {
	const measurement =
		options.measurement ?? createCanvasLayoutMeasurementProvider();

	const resolve = (
		previous?: CanvasResolvedDocument,
	): ResolvedDocumentState => {
		const effective = withPreviews(
			options.sceneStore.getState().ir,
			options.fieldPreviewStore.getState().previews,
		);
		const resolved = resolveCanvasLayout(effective, {
			measurement,
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
