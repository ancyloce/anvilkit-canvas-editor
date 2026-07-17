import {
	type CanvasIR,
	type CanvasPageCreateCommand,
	type CanvasPageDeleteCommand,
	type CanvasPageDuplicateCommand,
	type CanvasPageRenameCommand,
	type CanvasPageReorderCommand,
	createCanvasIR,
	createGroup,
	createPage,
	createRect,
} from "@anvilkit/canvas-core";
import { describe, expect, it } from "vitest";
import { makeHarness } from "@/tools/__tests__/_tool-test-helpers.js";
import {
	addPage,
	deletePage,
	duplicateCurrentPage,
	renamePage,
	reorderPage,
	switchToPage,
} from "../page-actions.js";

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
	it("commits page.duplicate for the active page and activates the new page id", () => {
		const h = makeHarness({ ir: singlePageWithRect() });
		const cloneId = duplicateCurrentPage(h.studioCtx);
		expect(cloneId).not.toBeNull();
		expect(h.commits).toHaveLength(1);
		const cmd = h.commits[0] as CanvasPageDuplicateCommand;
		expect(cmd.type).toBe("page.duplicate");
		expect(cmd.sourcePageId).toBe("p1");
		expect(cmd.newPageId).toBe(cloneId);
		// Fresh id, distinct from the source — regeneration/positioning/naming
		// are core command domain logic (see canvas-core's page-duplicate.test.ts).
		expect(cloneId).not.toBe("p1");
		// New page is active.
		expect(h.studioCtx.pagesStore.getState().activePageId).toBe(cloneId);
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

	it("FR-170: the last-page guard fires exactly one warning toast reusing the nav tooltip copy", () => {
		const h = makeHarness({ ir: singlePageWithRect() });
		const toasts: { type?: string; title: string }[] = [];
		deletePage(h.studioCtx, "p1", { add: (input) => toasts.push(input) });
		expect(h.commits).toHaveLength(0);
		expect(toasts).toHaveLength(1);
		expect(toasts[0]?.type).toBe("warning");
		expect(toasts[0]?.title).toBe("Cannot delete the only page");
	});

	it("does NOT toast when the delete actually succeeds", () => {
		const h = makeHarness({ ir: multiPageIR() });
		const toasts: { type?: string; title: string }[] = [];
		deletePage(h.studioCtx, "p1", { add: (input) => toasts.push(input) });
		expect(h.commits).toHaveLength(1);
		expect(toasts).toHaveLength(0);
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

describe("reorderPage", () => {
	it("commits page.reorder with the live from/to indices", () => {
		const h = makeHarness({ ir: multiPageIR() });
		reorderPage(h.studioCtx, "p1", 1);
		expect(h.commits).toHaveLength(1);
		const cmd = h.commits[0] as CanvasPageReorderCommand;
		expect(cmd.type).toBe("page.reorder");
		expect(cmd.pageId).toBe("p1");
		expect(cmd.from).toBe(0);
		expect(cmd.to).toBe(1);
	});

	it("is a no-op when the page is already at toIndex", () => {
		const h = makeHarness({ ir: multiPageIR() });
		reorderPage(h.studioCtx, "p1", 0);
		expect(h.commits).toHaveLength(0);
	});

	it("is a no-op when toIndex is out of range", () => {
		const h = makeHarness({ ir: multiPageIR() });
		reorderPage(h.studioCtx, "p1", 99);
		reorderPage(h.studioCtx, "p1", -1);
		expect(h.commits).toHaveLength(0);
	});

	it("is a no-op when the page id is unknown", () => {
		const h = makeHarness({ ir: multiPageIR() });
		reorderPage(h.studioCtx, "ghost", 1);
		expect(h.commits).toHaveLength(0);
	});

	it("does not change the active page", () => {
		const h = makeHarness({ ir: multiPageIR() });
		reorderPage(h.studioCtx, "p2", 0);
		expect(h.studioCtx.pagesStore.getState().activePageId).toBe("p1");
	});
});

describe("renamePage", () => {
	it("commits page.rename with the prior and new names", () => {
		const h = makeHarness({ ir: multiPageIR() });
		renamePage(h.studioCtx, "p1", "Hero");
		expect(h.commits).toHaveLength(1);
		const cmd = h.commits[0] as CanvasPageRenameCommand;
		expect(cmd.type).toBe("page.rename");
		expect(cmd.pageId).toBe("p1");
		expect(cmd.from).toBe("Page 1");
		expect(cmd.to).toBe("Hero");
	});

	it("treats empty string as undefined (clears the name)", () => {
		const h = makeHarness({ ir: multiPageIR() });
		renamePage(h.studioCtx, "p1", "");
		expect(h.commits).toHaveLength(1);
		const cmd = h.commits[0] as CanvasPageRenameCommand;
		expect(cmd.to).toBeUndefined();
	});

	it("is a no-op when the name is unchanged", () => {
		const h = makeHarness({ ir: multiPageIR() });
		renamePage(h.studioCtx, "p1", "Page 1");
		expect(h.commits).toHaveLength(0);
	});

	it("is a no-op when the page id is unknown", () => {
		const h = makeHarness({ ir: multiPageIR() });
		renamePage(h.studioCtx, "ghost", "Hero");
		expect(h.commits).toHaveLength(0);
	});
});
