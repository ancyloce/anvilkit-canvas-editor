import {
	type CanvasIR,
	type CanvasPageCreateCommand,
	type CanvasPageDeleteCommand,
	createCanvasIR,
	createPage,
} from "@anvilkit/canvas-core";
import { fireEvent, render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import {
	CanvasStudioContext,
	type CanvasStudioContextValue,
} from "../../context/canvas-studio-context.js";
import { makeHarness } from "../../tools/__tests__/_tool-test-helpers.js";
import { PageNavigator } from "../PageNavigator.js";

const FIXED_TS = "2026-05-20T00:00:00.000Z";

function multiPage(): CanvasIR {
	return createCanvasIR({
		id: "ir-1",
		pages: [
			createPage({ id: "p1", name: "First" }),
			createPage({ id: "p2", name: "Second" }),
		],
		now: () => FIXED_TS,
	});
}

function singlePage(): CanvasIR {
	return createCanvasIR({
		id: "ir-1",
		pages: [createPage({ id: "only", name: "Only" })],
		now: () => FIXED_TS,
	});
}

function mount(ctx: CanvasStudioContextValue) {
	return render(
		<CanvasStudioContext.Provider value={ctx}>
			<PageNavigator />
		</CanvasStudioContext.Provider>,
	);
}

describe("PageNavigator — render", () => {
	it("renders one tab per page with the active one flagged", () => {
		const h = makeHarness({ ir: multiPage() });
		const { container } = mount(h.studioCtx);
		const tabs = container.querySelectorAll("[data-testid^='page-tab-']");
		expect(tabs).toHaveLength(2);
		const active = container.querySelector(
			"[data-testid='page-tab-p1']",
		) as HTMLElement;
		expect(active.getAttribute("data-active")).toBe("true");
		const inactive = container.querySelector(
			"[data-testid='page-tab-p2']",
		) as HTMLElement;
		expect(inactive.getAttribute("data-active")).toBe("false");
	});

	it("shows page.name as the tab label", () => {
		const h = makeHarness({ ir: multiPage() });
		const { container } = mount(h.studioCtx);
		const tab1 = container.querySelector(
			"[data-testid='page-tab-p1']",
		) as HTMLElement;
		expect(tab1.textContent).toBe("First");
	});

	it("renders nothing when ir.pages is empty", () => {
		const emptyIR = createCanvasIR({
			id: "ir-empty",
			pages: [createPage({ id: "tmp" })],
			now: () => FIXED_TS,
		});
		// Empty out pages directly (createCanvasIR requires at least 1).
		emptyIR.pages = [];
		const h = makeHarness({ ir: emptyIR });
		const { container } = mount(h.studioCtx);
		expect(
			container.querySelector("[data-testid='page-navigator']"),
		).toBeNull();
	});
});

describe("PageNavigator — switch page", () => {
	it("clicking an inactive tab updates active page id", () => {
		const h = makeHarness({ ir: multiPage() });
		const { container } = mount(h.studioCtx);
		expect(h.studioCtx.pagesStore.getState().activePageId).toBe("p1");
		const tab2 = container.querySelector(
			"[data-testid='page-tab-p2']",
		) as HTMLElement;
		fireEvent.click(tab2);
		expect(h.studioCtx.pagesStore.getState().activePageId).toBe("p2");
	});

	it("switching clears selection / draft / editing", () => {
		const h = makeHarness({ ir: multiPage() });
		h.studioCtx.selectionStore.getState().setSelection(["x"]);
		h.studioCtx.draftStore.getState().setDraft({
			type: "rect",
			startX: 0,
			startY: 0,
			currentX: 1,
			currentY: 1,
		});
		h.studioCtx.editingStore.getState().setEditing("t");
		const { container } = mount(h.studioCtx);
		const tab2 = container.querySelector(
			"[data-testid='page-tab-p2']",
		) as HTMLElement;
		fireEvent.click(tab2);
		expect(h.studioCtx.selectionStore.getState().selectedIds).toEqual([]);
		expect(h.studioCtx.draftStore.getState().draft).toBeNull();
		expect(h.studioCtx.editingStore.getState().editingNodeId).toBeNull();
	});
});

describe("PageNavigator — add", () => {
	it("clicking + fires page.create and activates the new page", () => {
		const h = makeHarness({ ir: multiPage() });
		const { container } = mount(h.studioCtx);
		const add = container.querySelector(
			"[data-testid='page-add']",
		) as HTMLElement;
		fireEvent.click(add);
		expect(h.commits).toHaveLength(1);
		const cmd = h.commits[0] as CanvasPageCreateCommand;
		expect(cmd.type).toBe("page.create");
		expect(h.studioCtx.pagesStore.getState().activePageId).toBe(cmd.page.id);
	});
});

describe("PageNavigator — duplicate", () => {
	it("clicking Duplicate fires page.create with an index and clone name", () => {
		const h = makeHarness({ ir: multiPage() });
		const { container } = mount(h.studioCtx);
		const dup = container.querySelector(
			"[data-testid='page-duplicate']",
		) as HTMLElement;
		fireEvent.click(dup);
		expect(h.commits).toHaveLength(1);
		const cmd = h.commits[0] as CanvasPageCreateCommand;
		expect(cmd.type).toBe("page.create");
		expect(cmd.index).toBe(1);
		expect(cmd.page.name).toBe("First copy");
	});
});

describe("PageNavigator — delete", () => {
	it("Delete button is disabled with only one page", () => {
		const h = makeHarness({ ir: singlePage() });
		const { container } = mount(h.studioCtx);
		const del = container.querySelector(
			"[data-testid='page-delete']",
		) as HTMLButtonElement;
		expect(del.disabled).toBe(true);
		fireEvent.click(del);
		expect(h.commits).toHaveLength(0);
	});

	it("Delete fires page.delete and moves active to the remaining page", () => {
		const h = makeHarness({ ir: multiPage() });
		const { container } = mount(h.studioCtx);
		const del = container.querySelector(
			"[data-testid='page-delete']",
		) as HTMLButtonElement;
		expect(del.disabled).toBe(false);
		fireEvent.click(del);
		expect(h.commits).toHaveLength(1);
		const cmd = h.commits[0] as CanvasPageDeleteCommand;
		expect(cmd.type).toBe("page.delete");
		expect(cmd.pageId).toBe("p1");
		expect(h.studioCtx.pagesStore.getState().activePageId).toBe("p2");
	});
});
