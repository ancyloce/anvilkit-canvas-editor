import {
	type CanvasIR,
	createCanvasIR,
	createGroup,
	createPage,
	createRect,
} from "@anvilkit/canvas-core";
import { describe, expect, it, vi } from "vitest";
import { applyUpdate, Doc as YDoc } from "yjs";
import { createAiJobStore } from "@/stores/ai-job-store.js";
import { createCropStore } from "@/stores/crop-store.js";
import { createDraftStore } from "@/stores/draft-store.js";
import { createEditingStore } from "@/stores/editing-store.js";
import { createFocusStore } from "@/stores/focus-store.js";
import { createGuidesStore } from "@/stores/guides-store.js";
import { createHistoryStore } from "@/stores/history-store.js";
import { createPagesStore } from "@/stores/pages-store.js";
import { createPathEditStore } from "@/stores/path-edit-store.js";
import { createPenStore } from "@/stores/pen-store.js";
import type { DocumentStores } from "@/stores/replace-document.js";
import { createSceneStore } from "@/stores/scene-store.js";
import { createSelectionStore } from "@/stores/selection-store.js";
import { createCanvasYjsBinding } from "../binding.js";
import { CANVAS_IR_KEY, DEFAULT_CANVAS_MAP_NAME } from "../keys.js";

function fullStoreBundle(initialIR: CanvasIR): DocumentStores {
	return {
		sceneStore: createSceneStore({ initialIR }),
		historyStore: createHistoryStore(),
		pagesStore: createPagesStore({
			initialActivePageId: initialIR.pages[0]?.id ?? "",
		}),
		selectionStore: createSelectionStore(),
		focusStore: createFocusStore(),
		draftStore: createDraftStore(),
		editingStore: createEditingStore(),
		cropStore: createCropStore(),
		penStore: createPenStore(),
		pathEditStore: createPathEditStore(),
		guidesStore: createGuidesStore(),
		aiJobStore: createAiJobStore(),
	};
}

/** Wire two docs as a synchronous two-client session: each doc's local
 *  updates are applied to the other with a sentinel origin so they don't
 *  bounce back. Mirrors plugin-collab-yjs/src/__tests__/adapter.test.ts. */
function linkDocs(a: YDoc, b: YDoc): void {
	a.on("update", (u, o) => {
		if (o !== "replicate") applyUpdate(b, u, "replicate");
	});
	b.on("update", (u, o) => {
		if (o !== "replicate") applyUpdate(a, u, "replicate");
	});
}

describe("createCanvasYjsBinding", () => {
	it("converges a 2-client session with no UI", () => {
		const docA = new YDoc();
		const docB = new YDoc();
		linkDocs(docA, docB);

		const storeA = createSceneStore({ initialIR: createCanvasIR({ id: "a" }) });
		const storeB = createSceneStore({ initialIR: createCanvasIR({ id: "b" }) });

		const bindingA = createCanvasYjsBinding({
			doc: docA,
			sceneStore: storeA,
			peer: { id: "alice" },
		});
		// B joins after A seeded the shared doc → B converges to A's scene.
		const bindingB = createCanvasYjsBinding({
			doc: docB,
			sceneStore: storeB,
			peer: { id: "bob" },
		});
		expect(storeB.getState().ir.id).toBe("a");

		const received: Array<{ ir: CanvasIR; peer?: { id: string } }> = [];
		bindingB.subscribe((ir, peer) => received.push({ ir, peer }));

		const next = createCanvasIR({ id: "shared", title: "Edited on A" });
		storeA.getState().setIR(next);

		// B's store converged, and its subscriber saw alice's authored update.
		expect(storeB.getState().ir).toEqual(next);
		expect(received).toHaveLength(1);
		expect(received[0]?.peer).toEqual({ id: "alice" });
		expect(bindingB.current()).toEqual(next);

		bindingA.destroy();
		bindingB.destroy();
	});

	it("does not echo a remote update back to its author", () => {
		const docA = new YDoc();
		const docB = new YDoc();
		linkDocs(docA, docB);
		const storeA = createSceneStore({ initialIR: createCanvasIR({ id: "a" }) });
		const storeB = createSceneStore({ initialIR: createCanvasIR({ id: "b" }) });
		const bindingA = createCanvasYjsBinding({
			doc: docA,
			sceneStore: storeA,
			peer: { id: "alice" },
		});
		const bindingB = createCanvasYjsBinding({
			doc: docB,
			sceneStore: storeB,
			peer: { id: "bob" },
		});

		const aRemote = vi.fn();
		bindingA.subscribe(aRemote);

		// A initiates: B applies it but must NOT re-push, so A never hears back.
		storeA.getState().setIR(createCanvasIR({ id: "x" }));
		expect(aRemote).not.toHaveBeenCalled();

		bindingA.destroy();
		bindingB.destroy();
	});

	it("converges deterministically under interleaved local edits (LWW)", () => {
		const docA = new YDoc();
		const docB = new YDoc();
		linkDocs(docA, docB);
		const storeA = createSceneStore({ initialIR: createCanvasIR({ id: "a" }) });
		const storeB = createSceneStore({ initialIR: createCanvasIR({ id: "b" }) });
		const bindingA = createCanvasYjsBinding({
			doc: docA,
			sceneStore: storeA,
			peer: { id: "alice" },
		});
		const bindingB = createCanvasYjsBinding({
			doc: docB,
			sceneStore: storeB,
			peer: { id: "bob" },
		});

		storeA.getState().setIR(createCanvasIR({ id: "from-a" }));
		storeB.getState().setIR(createCanvasIR({ id: "from-b" }));

		// Both replicas agree on a single winner.
		expect(bindingA.current()).toEqual(bindingB.current());
		expect(storeA.getState().ir).toEqual(storeB.getState().ir);

		bindingA.destroy();
		bindingB.destroy();
	});

	it("drops a corrupt remote payload without throwing or mutating", () => {
		const docA = new YDoc();
		const docB = new YDoc();
		linkDocs(docA, docB);
		const storeA = createSceneStore({ initialIR: createCanvasIR({ id: "a" }) });
		const storeB = createSceneStore({ initialIR: createCanvasIR({ id: "b" }) });
		createCanvasYjsBinding({
			doc: docA,
			sceneStore: storeA,
			peer: { id: "alice" },
		});
		const bindingB = createCanvasYjsBinding({
			doc: docB,
			sceneStore: storeB,
			peer: { id: "bob" },
		});

		const before = storeB.getState().ir;
		const bRemote = vi.fn();
		bindingB.subscribe(bRemote);

		// A foreign peer writes garbage directly into the shared key.
		expect(() => {
			docA.transact(() => {
				docA
					.getMap<string>(DEFAULT_CANVAS_MAP_NAME)
					.set(CANVAS_IR_KEY, "{ not json");
			}, "intruder");
		}).not.toThrow();

		expect(bRemote).not.toHaveBeenCalled();
		expect(storeB.getState().ir).toBe(before);
	});

	it("destroy() stops applying updates and is idempotent", () => {
		const docA = new YDoc();
		const docB = new YDoc();
		linkDocs(docA, docB);
		const storeA = createSceneStore({ initialIR: createCanvasIR({ id: "a" }) });
		const storeB = createSceneStore({ initialIR: createCanvasIR({ id: "b" }) });
		const bindingA = createCanvasYjsBinding({
			doc: docA,
			sceneStore: storeA,
			peer: { id: "alice" },
		});
		const bindingB = createCanvasYjsBinding({
			doc: docB,
			sceneStore: storeB,
			peer: { id: "bob" },
		});

		bindingB.destroy();
		expect(() => bindingB.destroy()).not.toThrow();

		const frozen = storeB.getState().ir;
		storeA.getState().setIR(createCanvasIR({ id: "after-destroy" }));
		expect(storeB.getState().ir).toBe(frozen);

		bindingA.destroy();
	});

	/**
	 * P0-9: before this option existed, a remote replacement touched only
	 * `sceneStore.ir` — B's history, selection, and active page all kept
	 * referencing B's PRE-replacement document. This proves the `stores`
	 * option routes remote/joined snapshots through `replaceDocumentSnapshot`.
	 */
	it("with `stores` supplied, a remote update reconciles history/selection/active page", () => {
		const docA = new YDoc();
		const docB = new YDoc();
		linkDocs(docA, docB);

		function bIR(): CanvasIR {
			const rect = createRect({
				id: "b-rect",
				bounds: { width: 5, height: 5 },
			});
			const page1 = createPage({ id: "b-page-1" });
			page1.root = createGroup({
				id: "b-page-1-root",
				bounds: page1.root.bounds,
				children: [rect],
			});
			const page2 = createPage({ id: "b-page-2" });
			return createCanvasIR({ id: "b", pages: [page1, page2] });
		}

		const aIR = createCanvasIR({ id: "a" });
		const storeA = createSceneStore({ initialIR: aIR });
		const bStores = fullStoreBundle(bIR());

		const bindingA = createCanvasYjsBinding({
			doc: docA,
			sceneStore: storeA,
			peer: { id: "alice" },
		});

		// Seed B's stores with state that only makes sense against B's OWN
		// document: a selection + focus + history entry referencing "b-rect",
		// and an active page ("b-page-2") that A's replacement won't have.
		bStores.selectionStore.getState().setSelection(["b-rect"]);
		bStores.focusStore.getState().setFocus("b-rect");
		bStores.pagesStore.getState().setActivePageId("b-page-2");
		bStores.historyStore.getState().commit(bStores.sceneStore.getState().ir, {
			type: "node.move",
			nodeId: "b-rect",
			from: { x: 0, y: 0 },
			to: { x: 1, y: 0 },
		});
		expect(bStores.historyStore.getState().canUndo()).toBe(true);

		// B joins with the full store bundle — A already seeded the shared doc
		// with an unrelated document, so this join IS a snapshot replacement.
		const bindingB = createCanvasYjsBinding({
			doc: docB,
			sceneStore: bStores.sceneStore,
			peer: { id: "bob" },
			stores: bStores,
		});

		expect(bStores.sceneStore.getState().ir.id).toBe("a");
		expect(bStores.selectionStore.getState().selectedIds).toEqual([]);
		expect(bStores.focusStore.getState().focusedId).toBeNull();
		expect(bStores.historyStore.getState().canUndo()).toBe(false);
		// A's replacement doc has one page — B's stale "b-page-2" is gone, so the
		// active page falls back to A's first (only) page.
		expect(bStores.pagesStore.getState().activePageId).toBe(aIR.pages[0]?.id);

		bindingA.destroy();
		bindingB.destroy();
	});
});
