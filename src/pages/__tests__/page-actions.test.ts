import {
	type CanvasIR,
	type CanvasPageCreateCommand,
	type CanvasPageDeleteCommand,
	createCanvasIR,
	createGroup,
	createPage,
	createRect,
} from "@anvilkit/canvas-core";
import { describe, expect, it } from "vitest";
import {
	addPage,
	deletePage,
	duplicateCurrentPage,
	switchToPage,
} from "../page-actions.js";
import { makeHarness } from "../../tools/__tests__/_tool-test-helpers.js";

const FIXED_TS = "2026-05-20T00:00:00.000Z";

function multiPageIR(): CanvasIR {
	return createCanvasIR({
		id: "ir-1",
		pages: [
			createPage({ id: "p1", name: "Page 1" }),
			createPage({ id: "p2", name: "Page 2" }),
		],
		now: () => FIXED_TS,
	});
}

function singlePageWithRect(): CanvasIR {
	const page = createPage({ id: "p1", name: "First" });
	page.root = createGroup({
		id: "p1-root",
		bounds: page.root.bounds,
		children: [
			createRect({
				id: "rectA",
				bounds: { width: 50, height: 30 },
				transform: { x: 10, y: 20 },
			}),
		],
	});
	return createCanvasIR({
		id: "ir-1",
		pages: [page],
		now: () => FIXED_TS,
	});
}

describe("addPage", () => {
	it("commits page.create with the new page and activates it", () => {
		const h = makeHarness({ ir: multiPageIR() });
		const newId = addPage(h.studioCtx, { name: "Brand new" });
		expect(h.commits).toHaveLength(1);
		const cmd = h.commits[0] as CanvasPageCreateCommand;
		expect(cmd.type).toBe("page.create");
		expect(cmd.page.id).toBe(newId);
		expect(cmd.page.name).toBe("Brand new");
		expect(h.studioCtx.pagesStore.getState().activePageId).toBe(newId);
	});

	it("returns the new page id", () => {
		const h = makeHarness({ ir: multiPageIR() });
		const id = addPage(h.studioCtx);
		expect(typeof id).toBe("string");
		expect(id).toHaveLength(
			(h.commits[0] as CanvasPageCreateCommand).page.id.length,
		);
	});
});

describe("duplicateCurrentPage", () => {
	it("inserts a clone after the active page with name '<original> copy'", () => {
		const h = makeHarness({ ir: singlePageWithRect() });
		const cloneId = duplicateCurrentPage(h.studioCtx);
		expect(cloneId).not.toBeNull();
		expect(h.commits).toHaveLength(1);
		const cmd = h.commits[0] as CanvasPageCreateCommand;
		expect(cmd.type).toBe("page.create");
		expect(cmd.index).toBe(1);
		expect(cmd.page.name).toBe("First copy");
		// New page is active.
		expect(h.studioCtx.pagesStore.getState().activePageId).toBe(cloneId);
	});

	it("clones nodes with fresh ids", () => {
		const h = makeHarness({ ir: singlePageWithRect() });
		duplicateCurrentPage(h.studioCtx);
		const cmd = h.commits[0] as CanvasPageCreateCommand;
		const originalRectId = "rectA";
		const clonedRectId = cmd.page.root.children[0]?.id;
		expect(clonedRectId).toBeTruthy();
		expect(clonedRectId).not.toBe(originalRectId);
	});

	it("returns null when no active page exists in IR", () => {
		const h = makeHarness({ ir: multiPageIR() });
		// Force active to a missing id.
		h.studioCtx.pagesStore.getState().setActivePageId("missing");
		const result = duplicateCurrentPage(h.studioCtx);
		expect(result).toBeNull();
		expect(h.commits).toHaveLength(0);
	});
});

describe("deletePage", () => {
	it("commits page.delete and moves active to the next remaining page", () => {
		const h = makeHarness({ ir: multiPageIR() });
		// p1 is active by default.
		deletePage(h.studioCtx, "p1");
		expect(h.commits).toHaveLength(1);
		const cmd = h.commits[0] as CanvasPageDeleteCommand;
		expect(cmd.type).toBe("page.delete");
		expect(cmd.pageId).toBe("p1");
		// Active moved to p2 (the next remaining).
		expect(h.studioCtx.pagesStore.getState().activePageId).toBe("p2");
	});

	it("falls back to the previous page when deleting the last page", () => {
		const h = makeHarness({ ir: multiPageIR() });
		h.studioCtx.pagesStore.getState().setActivePageId("p2");
		deletePage(h.studioCtx, "p2");
		expect(h.studioCtx.pagesStore.getState().activePageId).toBe("p1");
	});

	it("is a no-op when only one page remains (last-page guard)", () => {
		const h = makeHarness({ ir: singlePageWithRect() });
		deletePage(h.studioCtx, "p1");
		expect(h.commits).toHaveLength(0);
		expect(h.studioCtx.pagesStore.getState().activePageId).toBe("p1");
	});

	it("does not change active page when deleting a non-active page", () => {
		const h = makeHarness({ ir: multiPageIR() });
		// p1 is active; delete p2.
		deletePage(h.studioCtx, "p2");
		expect(h.commits).toHaveLength(1);
		expect(h.studioCtx.pagesStore.getState().activePageId).toBe("p1");
	});

	it("is a no-op when the page id does not exist", () => {
		const h = makeHarness({ ir: multiPageIR() });
		deletePage(h.studioCtx, "missing");
		expect(h.commits).toHaveLength(0);
	});
});

describe("switchToPage", () => {
	it("updates active page id and clears selection / draft / editing / guides", () => {
		const h = makeHarness({ ir: multiPageIR() });
		// Set up some transient state.
		h.studioCtx.selectionStore.getState().setSelection(["rectA"]);
		h.studioCtx.draftStore.getState().setDraft({
			type: "rect",
			startX: 0,
			startY: 0,
			currentX: 10,
			currentY: 10,
		});
		h.studioCtx.editingStore.getState().setEditing("text1");
		h.studioCtx.guidesStore.getState().setGuides([
			{
				axis: "x",
				position: 0,
				from: { x: 0, y: 0 },
				to: { x: 0, y: 10 },
			},
		]);

		switchToPage(h.studioCtx, "p2");

		expect(h.studioCtx.pagesStore.getState().activePageId).toBe("p2");
		expect(h.studioCtx.selectionStore.getState().selectedIds).toEqual([]);
		expect(h.studioCtx.draftStore.getState().draft).toBeNull();
		expect(h.studioCtx.editingStore.getState().editingNodeId).toBeNull();
		expect(h.studioCtx.guidesStore.getState().guides).toEqual([]);
		// No history commit — switching is view state only.
		expect(h.commits).toHaveLength(0);
	});

	it("is a no-op when switching to the same page (preserves transient state)", () => {
		const h = makeHarness({ ir: multiPageIR() });
		h.studioCtx.selectionStore.getState().setSelection(["rectA"]);
		switchToPage(h.studioCtx, "p1"); // already active
		expect(h.studioCtx.selectionStore.getState().selectedIds).toEqual([
			"rectA",
		]);
	});
});
