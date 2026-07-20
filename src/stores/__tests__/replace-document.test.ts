import {
	type CanvasIR,
	createCanvasIR,
	createGroup,
	createPage,
	createRect,
} from "@anvilkit/canvas-core";
import { describe, expect, it, vi } from "vitest";
import { createAiJobStore } from "../ai-job-store.js";
import { createCropStore } from "../crop-store.js";
import { createDraftStore } from "../draft-store.js";
import { createEditingStore } from "../editing-store.js";
import { createFocusStore } from "../focus-store.js";
import { createGuidesStore } from "../guides-store.js";
import { createHistoryStore } from "../history-store.js";
import { createPagesStore } from "../pages-store.js";
import { createPathEditStore } from "../path-edit-store.js";
import { createPenStore } from "../pen-store.js";
import type { DocumentStores } from "../replace-document.js";
import { replaceDocumentSnapshot } from "../replace-document.js";
import { createSceneStore } from "../scene-store.js";
import { createSelectionStore } from "../selection-store.js";
import { createUploadStore } from "../upload-store.js";

function twoPageIR(): CanvasIR {
	const rect = createRect({ id: "rectA", bounds: { width: 10, height: 10 } });
	const page1 = createPage({ id: "page-1" });
	page1.root = createGroup({
		id: "page-1-root",
		bounds: page1.root.bounds,
		children: [rect],
	});
	const page2 = createPage({ id: "page-2" });
	return createCanvasIR({ id: "doc-1", pages: [page1, page2] });
}

function makeStores(initialIR: CanvasIR): DocumentStores {
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
		uploadStore: createUploadStore(),
	};
}

describe("replaceDocumentSnapshot", () => {
	it("swaps the IR", () => {
		const stores = makeStores(twoPageIR());
		const next = createCanvasIR({ id: "doc-2" });
		replaceDocumentSnapshot(stores, next, { source: "remote-update" });
		expect(stores.sceneStore.getState().ir).toEqual(next);
	});

	it("resets undo/redo history", () => {
		const ir = twoPageIR();
		const stores = makeStores(ir);
		stores.historyStore.getState().commit(ir, {
			type: "node.move",
			nodeId: "rectA",
			from: { x: 0, y: 0 },
			to: { x: 5, y: 0 },
		});
		expect(stores.historyStore.getState().canUndo()).toBe(true);
		replaceDocumentSnapshot(stores, createCanvasIR({ id: "doc-2" }), {
			source: "remote-update",
		});
		expect(stores.historyStore.getState().canUndo()).toBe(false);
		expect(stores.historyStore.getState().canRedo()).toBe(false);
	});

	it("clears selection, focus, and every in-progress transient gesture", () => {
		const stores = makeStores(twoPageIR());
		stores.selectionStore.getState().setSelection(["rectA"]);
		stores.focusStore.getState().setFocus("rectA");
		stores.draftStore.getState().setDraft({
			type: "marquee",
			startX: 0,
			startY: 0,
			currentX: 10,
			currentY: 10,
		});
		stores.editingStore.getState().setEditing("rectA");
		stores.cropStore.getState().begin("rectA");
		stores.penStore.getState().addAnchor({ x: 0, y: 0, hx: 0, hy: 0 });
		stores.pathEditStore.getState().begin("rectA");
		stores.guidesStore
			.getState()
			.setGuides([
				{ axis: "x", position: 5, from: { x: 5, y: 0 }, to: { x: 5, y: 10 } },
			]);

		replaceDocumentSnapshot(stores, createCanvasIR({ id: "doc-2" }), {
			source: "remote-update",
		});

		expect(stores.selectionStore.getState().selectedIds).toEqual([]);
		expect(stores.focusStore.getState().focusedId).toBeNull();
		expect(stores.draftStore.getState().draft).toBeNull();
		expect(stores.editingStore.getState().editingNodeId).toBeNull();
		expect(stores.cropStore.getState().cropNodeId).toBeNull();
		expect(stores.penStore.getState().anchors).toEqual([]);
		expect(stores.pathEditStore.getState().editNodeId).toBeNull();
		expect(stores.guidesStore.getState().guides).toEqual([]);
	});

	it("aborts every pending AI job and clears the registry", () => {
		const stores = makeStores(twoPageIR());
		const abort = vi.fn();
		stores.aiJobStore.getState().register("job-1", { nodeId: "ph-1", abort });
		replaceDocumentSnapshot(stores, createCanvasIR({ id: "doc-2" }), {
			source: "remote-update",
		});
		expect(abort).toHaveBeenCalledOnce();
		expect(stores.aiJobStore.getState().get("job-1")).toBeUndefined();
	});

	it("aborts every in-flight upload and clears the task list (FR-091)", () => {
		const stores = makeStores(twoPageIR());
		const uploadStore = stores.uploadStore;
		if (!uploadStore) throw new Error("uploadStore missing");
		const id = uploadStore
			.getState()
			.begin(new File(["x"], "a.png", { type: "image/png" }));
		const abort = vi.fn();
		uploadStore.getState().registerAbort(id, abort);
		replaceDocumentSnapshot(stores, createCanvasIR({ id: "doc-2" }), {
			source: "document-switch",
		});
		expect(abort).toHaveBeenCalledOnce();
		expect(uploadStore.getState().tasks).toHaveLength(0);
		// An upload resolving after the swap finds its task gone → inserts nothing.
		expect(uploadStore.getState().has(id)).toBe(false);
	});

	it("keeps the active page when it still exists in the new document", () => {
		const stores = makeStores(twoPageIR());
		stores.pagesStore.getState().setActivePageId("page-2");
		const next = twoPageIR(); // same page ids, different doc id
		replaceDocumentSnapshot(stores, next, { source: "document-switch" });
		expect(stores.pagesStore.getState().activePageId).toBe("page-2");
	});

	it("falls back to the new document's first page when the active one is gone", () => {
		const stores = makeStores(twoPageIR());
		stores.pagesStore.getState().setActivePageId("page-2");
		const replacement = createPage({ id: "only-page" });
		const next = createCanvasIR({ id: "doc-2", pages: [replacement] });
		replaceDocumentSnapshot(stores, next, { source: "remote-update" });
		expect(stores.pagesStore.getState().activePageId).toBe("only-page");
	});
});
