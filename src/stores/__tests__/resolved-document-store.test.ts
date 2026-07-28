import type { CanvasIR, CanvasNode } from "@anvilkit/canvas-core";
import {
	createCanvasIR,
	createFrame,
	createPage,
	createRect,
	insertNode,
	updateNode,
} from "@anvilkit/canvas-core";
import { afterEach, describe, expect, it } from "vitest";
import { createFieldPreviewStore } from "../field-preview-store.js";
import { createResolvedDocumentStore } from "../resolved-document-store.js";
import { createSceneStore } from "../scene-store.js";

/**
 * @file T-M3-05 (TS-41) — one resolved document per render context, derived
 * from scene + previews, warm-path threaded, preview-overlaid without ever
 * writing the IR.
 */

/** Horizontal auto-layout frame, gap 10, two 40×20 children stored stale at x=0. */
function layoutDoc(): CanvasIR {
	const frame: CanvasNode = {
		...createFrame({ id: "f1", bounds: { width: 200, height: 100 } }),
		autoLayout: {
			version: 1,
			direction: "horizontal",
			padding: { top: 0, right: 0, bottom: 0, left: 0 },
			gap: 10,
			primaryAlign: "start",
			crossAlign: "start",
		},
		children: [
			createRect({ id: "r1", bounds: { width: 40, height: 20 } }),
			createRect({ id: "r2", bounds: { width: 40, height: 20 } }),
		],
	} as CanvasNode;
	const page = createPage({ id: "p1" });
	let ir = createCanvasIR({ id: "doc", title: "t", pages: [page] });
	ir = insertNode(ir, { parentId: page.root.id, node: frame });
	// A sibling subtree the layout edits never touch — the structural-sharing witness.
	ir = insertNode(ir, {
		parentId: page.root.id,
		node: createRect({
			id: "bystander",
			transform: { x: 500, y: 500 },
			bounds: { width: 10, height: 10 },
		}),
	});
	return ir;
}

function makeStores() {
	const sceneStore = createSceneStore({ initialIR: layoutDoc() });
	const fieldPreviewStore = createFieldPreviewStore();
	const store = createResolvedDocumentStore({ sceneStore, fieldPreviewStore });
	const disconnect = store.connect();
	return { sceneStore, fieldPreviewStore, store, disconnect };
}

let cleanup: (() => void) | undefined;
afterEach(() => {
	cleanup?.();
	cleanup = undefined;
});

describe("createResolvedDocumentStore", () => {
	it("resolves the initial document, flowing r2 to x=50", () => {
		const { store, disconnect } = makeStores();
		cleanup = disconnect;
		const record = store.getState().view.getRecord("r2");
		expect(record?.geometry.localTransform.x).toBe(50);
	});

	it("re-resolves synchronously inside a commit, sharing untouched records", () => {
		const { sceneStore, store, disconnect } = makeStores();
		cleanup = disconnect;
		const before = store.getState().resolved;
		const bystanderBefore = store.getState().view.getRecord("bystander");

		let observedDuringSet: unknown;
		const unsubscribe = sceneStore.subscribe(() => {
			observedDuringSet = store.getState().resolved;
		});
		sceneStore.getState().setIR(
			updateNode(sceneStore.getState().ir, {
				id: "r1",
				patch: { bounds: { width: 60, height: 20 } },
			}),
		);
		unsubscribe();

		const after = store.getState().resolved;
		expect(after).not.toBe(before);
		// Synchronous: by the time any scene subscriber ran, resolution was done.
		// (Zustand notifies in subscription order; the resolved store subscribed
		// first, in connect().)
		expect(observedDuringSet).toBe(after);
		// The widened r1 pushed r2 to x = 60 + 10.
		expect(
			store.getState().view.getRecord("r2")?.geometry.localTransform.x,
		).toBe(70);
		// Untouched sibling record is reference-identical — the warm path ran.
		expect(store.getState().view.getRecord("bystander")).toBe(bystanderBefore);
	});

	it("overlays preview patches without writing the IR", () => {
		const { sceneStore, fieldPreviewStore, store, disconnect } = makeStores();
		cleanup = disconnect;
		const committedIR = sceneStore.getState().ir;

		fieldPreviewStore
			.getState()
			.setPreviews({ r1: { bounds: { width: 100, height: 20 } } });
		expect(
			store.getState().view.getRecord("r2")?.geometry.localTransform.x,
		).toBe(110);
		// The committed document was never touched — previews resolve a copy.
		expect(sceneStore.getState().ir).toBe(committedIR);

		fieldPreviewStore.getState().clearPreviews();
		expect(
			store.getState().view.getRecord("r2")?.geometry.localTransform.x,
		).toBe(50);
	});

	it("exposes the view adapter over records, children, and page roots", () => {
		const { store, disconnect } = makeStores();
		cleanup = disconnect;
		const { view } = store.getState();
		const roots = view.getPageRoots("p1");
		expect(roots.length).toBeGreaterThan(0);
		const frame = view.getRecord("f1");
		expect(frame).toBeDefined();
		expect(view.getChildren("f1").map((r) => r.sourceNodeId)).toEqual([
			"r1",
			"r2",
		]);
	});

	it("stops recomputing after disconnect", () => {
		const { sceneStore, store, disconnect } = makeStores();
		const before = store.getState().resolved;
		disconnect();
		sceneStore.getState().setIR(
			updateNode(sceneStore.getState().ir, {
				id: "r1",
				patch: { bounds: { width: 99, height: 20 } },
			}),
		);
		expect(store.getState().resolved).toBe(before);
	});
});
