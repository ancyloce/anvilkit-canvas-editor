import {
	type CanvasIR,
	type CanvasPageCreateCommand,
	type CanvasPageDeleteCommand,
	type CanvasPageDuplicateCommand,
	type CanvasPageRenameCommand,
	type CanvasPageReorderCommand,
	createCanvasIR,
	createPage,
} from "@anvilkit/canvas-core";
import {
	cleanup,
	fireEvent,
	render,
	screen,
	waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
	CanvasStudioContext,
	type CanvasStudioContextValue,
} from "@/context/canvas-studio-context.js";
import { createExportRequestStore } from "@/stores/export-request-store.js";
import { makeHarness } from "@/tools/__tests__/_tool-test-helpers.js";
import { PageNavigator } from "../PageNavigator.js";

afterEach(cleanup);

/** Opens the FR-032 row context menu for `pageId` and waits for its portal. */
async function openPageMenu(pageId: string): Promise<void> {
	fireEvent.contextMenu(screen.getByTestId(`page-tab-${pageId}`));
	await waitFor(() => {
		expect(screen.getByTestId(`page-menu-${pageId}`)).toBeTruthy();
	});
}

function isMenuItemDisabled(el: HTMLElement): boolean {
	return (
		el.getAttribute("data-disabled") !== null ||
		el.getAttribute("aria-disabled") === "true"
	);
}

// I2-5: PageNavigator now rasterizes non-active pages into thumbnails. Stub the
// off-screen rasterizer (a real Konva mount won't run under jsdom) so these
// tests stay deterministic and fast.
vi.mock("../../render/rasterize-page.js", () => ({
	rasterizePage: vi.fn(async ({ page }: { page: { id: string } }) => ({
		url: `data:thumb/${page.id}`,
		mimeType: "image/png",
	})),
}));

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

	it("renders a cached thumbnail for non-active pages, not the active one (I2-5)", async () => {
		const h = makeHarness({ ir: multiPage() });
		const { container, findByTestId } = mount(h.studioCtx);
		const thumb = await findByTestId("page-thumb-p2");
		expect(thumb.getAttribute("src")).toBe("data:thumb/p2");
		expect(container.querySelector("[data-testid='page-thumb-p1']")).toBeNull();
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

describe("PageNavigator — a11y", () => {
	it("exposes the tab strip as a labeled tablist of tabs", () => {
		const h = makeHarness({ ir: multiPage() });
		const { container } = mount(h.studioCtx);
		const tablist = container.querySelector("[role='tablist']") as HTMLElement;
		expect(tablist).not.toBeNull();
		expect(tablist.getAttribute("aria-label")).toBe("Artboards");
		expect(tablist.querySelectorAll("[role='tab']")).toHaveLength(2);
	});

	it("flags the active page tab with aria-selected", () => {
		const h = makeHarness({ ir: multiPage() });
		const { container } = mount(h.studioCtx);
		const active = container.querySelector(
			"[data-testid='page-tab-p1']",
		) as HTMLElement;
		const inactive = container.querySelector(
			"[data-testid='page-tab-p2']",
		) as HTMLElement;
		expect(active.getAttribute("role")).toBe("tab");
		expect(active.getAttribute("aria-selected")).toBe("true");
		expect(inactive.getAttribute("aria-selected")).toBe("false");
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
	it("clicking Duplicate fires page.duplicate for the active page", () => {
		const h = makeHarness({ ir: multiPage() });
		const { container } = mount(h.studioCtx);
		const dup = container.querySelector(
			"[data-testid='page-duplicate']",
		) as HTMLElement;
		fireEvent.click(dup);
		expect(h.commits).toHaveLength(1);
		const cmd = h.commits[0] as CanvasPageDuplicateCommand;
		expect(cmd.type).toBe("page.duplicate");
		expect(cmd.sourcePageId).toBe("p1");
		expect(cmd.newPageId).not.toBe("p1");
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

describe("PageNavigator — reorder", () => {
	it("Left/Right buttons are disabled at the boundaries", () => {
		const h = makeHarness({ ir: multiPage() }); // p1 active (index 0)
		const { container } = mount(h.studioCtx);
		const left = container.querySelector(
			"[data-testid='page-reorder-left']",
		) as HTMLButtonElement;
		const right = container.querySelector(
			"[data-testid='page-reorder-right']",
		) as HTMLButtonElement;
		expect(left.disabled).toBe(true); // p1 is at index 0 — cannot move left
		expect(right.disabled).toBe(false);
	});

	it("Right button fires page.reorder with from/to", () => {
		const h = makeHarness({ ir: multiPage() }); // p1 active (index 0)
		const { container } = mount(h.studioCtx);
		const right = container.querySelector(
			"[data-testid='page-reorder-right']",
		) as HTMLButtonElement;
		fireEvent.click(right);
		expect(h.commits).toHaveLength(1);
		const cmd = h.commits[0] as CanvasPageReorderCommand;
		expect(cmd.type).toBe("page.reorder");
		expect(cmd.pageId).toBe("p1");
		expect(cmd.from).toBe(0);
		expect(cmd.to).toBe(1);
	});

	it("Left button moves the active page back one slot", () => {
		const h = makeHarness({ ir: multiPage() });
		h.studioCtx.pagesStore.getState().setActivePageId("p2"); // index 1
		const { container } = mount(h.studioCtx);
		const left = container.querySelector(
			"[data-testid='page-reorder-left']",
		) as HTMLButtonElement;
		expect(left.disabled).toBe(false);
		fireEvent.click(left);
		expect(h.commits).toHaveLength(1);
		const cmd = h.commits[0] as CanvasPageReorderCommand;
		expect(cmd.from).toBe(1);
		expect(cmd.to).toBe(0);
	});
});

describe("PageNavigator — rename", () => {
	it("double-clicking a tab swaps in a rename input with the existing name", () => {
		const h = makeHarness({ ir: multiPage() });
		const { container } = mount(h.studioCtx);
		const tab = container.querySelector(
			"[data-testid='page-tab-p1']",
		) as HTMLButtonElement;
		fireEvent.doubleClick(tab);
		const input = container.querySelector(
			"[data-testid='page-rename-input-p1']",
		) as HTMLInputElement;
		expect(input).not.toBeNull();
		expect(input.value).toBe("First");
	});

	it("commits page.rename on Enter and exits rename mode", () => {
		const h = makeHarness({ ir: multiPage() });
		const { container } = mount(h.studioCtx);
		const tab = container.querySelector(
			"[data-testid='page-tab-p1']",
		) as HTMLButtonElement;
		fireEvent.doubleClick(tab);
		const input = container.querySelector(
			"[data-testid='page-rename-input-p1']",
		) as HTMLInputElement;
		fireEvent.change(input, { target: { value: "Hero" } });
		fireEvent.keyDown(input, { key: "Enter" });
		expect(h.commits).toHaveLength(1);
		const cmd = h.commits[0] as CanvasPageRenameCommand;
		expect(cmd.type).toBe("page.rename");
		expect(cmd.pageId).toBe("p1");
		expect(cmd.from).toBe("First");
		expect(cmd.to).toBe("Hero");
		// Input gone — rename mode exited.
		expect(
			container.querySelector("[data-testid='page-rename-input-p1']"),
		).toBeNull();
	});

	it("commits on blur", () => {
		const h = makeHarness({ ir: multiPage() });
		const { container } = mount(h.studioCtx);
		const tab = container.querySelector(
			"[data-testid='page-tab-p1']",
		) as HTMLButtonElement;
		fireEvent.doubleClick(tab);
		const input = container.querySelector(
			"[data-testid='page-rename-input-p1']",
		) as HTMLInputElement;
		fireEvent.change(input, { target: { value: "Cover" } });
		fireEvent.blur(input);
		expect(h.commits).toHaveLength(1);
		expect((h.commits[0] as CanvasPageRenameCommand).to).toBe("Cover");
	});

	it("Escape cancels and does not commit", () => {
		const h = makeHarness({ ir: multiPage() });
		const { container } = mount(h.studioCtx);
		const tab = container.querySelector(
			"[data-testid='page-tab-p1']",
		) as HTMLButtonElement;
		fireEvent.doubleClick(tab);
		const input = container.querySelector(
			"[data-testid='page-rename-input-p1']",
		) as HTMLInputElement;
		fireEvent.change(input, { target: { value: "Throwaway" } });
		fireEvent.keyDown(input, { key: "Escape" });
		expect(h.commits).toHaveLength(0);
		expect(
			container.querySelector("[data-testid='page-rename-input-p1']"),
		).toBeNull();
	});

	it("skips the commit when the name is unchanged", () => {
		const h = makeHarness({ ir: multiPage() });
		const { container } = mount(h.studioCtx);
		const tab = container.querySelector(
			"[data-testid='page-tab-p1']",
		) as HTMLButtonElement;
		fireEvent.doubleClick(tab);
		const input = container.querySelector(
			"[data-testid='page-rename-input-p1']",
		) as HTMLInputElement;
		// value is "First" already; press Enter without editing
		fireEvent.keyDown(input, { key: "Enter" });
		expect(h.commits).toHaveLength(0);
	});

	it("clears the name when the input is emptied", () => {
		const h = makeHarness({ ir: multiPage() });
		const { container } = mount(h.studioCtx);
		const tab = container.querySelector(
			"[data-testid='page-tab-p1']",
		) as HTMLButtonElement;
		fireEvent.doubleClick(tab);
		const input = container.querySelector(
			"[data-testid='page-rename-input-p1']",
		) as HTMLInputElement;
		fireEvent.change(input, { target: { value: "" } });
		fireEvent.keyDown(input, { key: "Enter" });
		expect(h.commits).toHaveLength(1);
		const cmd = h.commits[0] as CanvasPageRenameCommand;
		expect(cmd.from).toBe("First");
		expect(cmd.to).toBeUndefined();
	});
});

// FR-032: PageNavigator previously had toolbar-only page actions with no
// Resize/Export access. This suite covers the added row context menu, which
// mirrors PagesCanvas.tsx's row menu (same @anvilkit/ui primitive, same
// page-actions.js call sites).
describe("PageNavigator — context menu (FR-032)", () => {
	it("renders all seven FR-032 entries", async () => {
		const h = makeHarness({ ir: multiPage() });
		mount(h.studioCtx);
		await openPageMenu("p1");
		for (const suffix of [
			"duplicate",
			"rename",
			"settings",
			"move-left",
			"move-right",
			"export",
			"delete",
		]) {
			expect(screen.getByTestId(`page-menu-${suffix}-p1`)).toBeTruthy();
		}
	});

	it("Duplicate fires page.duplicate for the target page", async () => {
		const h = makeHarness({ ir: multiPage() });
		mount(h.studioCtx);
		await openPageMenu("p1");
		fireEvent.click(screen.getByTestId("page-menu-duplicate-p1"));
		expect(h.commits).toHaveLength(1);
		const cmd = h.commits[0] as CanvasPageDuplicateCommand;
		expect(cmd.type).toBe("page.duplicate");
		expect(cmd.sourcePageId).toBe("p1");
		expect(cmd.newPageId).not.toBe("p1");
	});

	it("Rename opens the rename input for that page", async () => {
		const h = makeHarness({ ir: multiPage() });
		mount(h.studioCtx);
		await openPageMenu("p2");
		fireEvent.click(screen.getByTestId("page-menu-rename-p2"));
		expect(await screen.findByTestId("page-rename-input-p2")).toBeTruthy();
	});

	it("Resize opens the (lazy) page settings dialog", async () => {
		const h = makeHarness({ ir: multiPage() });
		mount(h.studioCtx);
		await openPageMenu("p1");
		fireEvent.click(screen.getByTestId("page-menu-settings-p1"));
		expect(await screen.findByTestId("page-settings-dialog")).toBeTruthy();
	});

	it("Move left is disabled on the first row regardless of which page is active", async () => {
		const h = makeHarness({ ir: multiPage() }); // p1 (index 0) is active
		mount(h.studioCtx);
		await openPageMenu("p1");
		expect(
			isMenuItemDisabled(screen.getByTestId("page-menu-move-left-p1")),
		).toBe(true);
		expect(
			isMenuItemDisabled(screen.getByTestId("page-menu-move-right-p1")),
		).toBe(false);
	});

	it("Move right is disabled on the last row even when it is not the active page", async () => {
		const h = makeHarness({ ir: multiPage() }); // p1 active, p2 (index 1) is not
		mount(h.studioCtx);
		await openPageMenu("p2");
		expect(
			isMenuItemDisabled(screen.getByTestId("page-menu-move-right-p2")),
		).toBe(true);
		expect(
			isMenuItemDisabled(screen.getByTestId("page-menu-move-left-p2")),
		).toBe(false);
		fireEvent.click(screen.getByTestId("page-menu-move-left-p2"));
		expect(h.commits).toHaveLength(1);
		const cmd = h.commits[0] as CanvasPageReorderCommand;
		expect(cmd.type).toBe("page.reorder");
		expect(cmd.pageId).toBe("p2");
		expect(cmd.from).toBe(1);
		expect(cmd.to).toBe(0);
	});

	it("Export is disabled when no export UI is mounted (headless <CanvasStudio>)", async () => {
		const h = makeHarness({ ir: multiPage() });
		mount(h.studioCtx);
		await openPageMenu("p1");
		expect(isMenuItemDisabled(screen.getByTestId("page-menu-export-p1"))).toBe(
			true,
		);
	});

	it("Export switches to that page and requests scope 'current' when export UI is mounted", async () => {
		const h = makeHarness({ ir: multiPage() });
		const exportRequestStore = createExportRequestStore();
		exportRequestStore.getState().setAvailable(true);
		const ctx: CanvasStudioContextValue = {
			...h.studioCtx,
			exportRequestStore,
		};
		render(
			<CanvasStudioContext.Provider value={ctx}>
				<PageNavigator />
			</CanvasStudioContext.Provider>,
		);
		await openPageMenu("p2");
		const exportItem = screen.getByTestId("page-menu-export-p2");
		expect(isMenuItemDisabled(exportItem)).toBe(false);
		fireEvent.click(exportItem);
		expect(ctx.pagesStore.getState().activePageId).toBe("p2");
		expect(exportRequestStore.getState().pending).toEqual({
			scope: "current",
		});
	});

	it("Delete is disabled with an explanatory title on the only page, and does not commit", async () => {
		const h = makeHarness({ ir: singlePage() });
		mount(h.studioCtx);
		await openPageMenu("only");
		const del = screen.getByTestId("page-menu-delete-only");
		expect(isMenuItemDisabled(del)).toBe(true);
		expect(del.getAttribute("title")).toBe("Cannot delete the only page");
		fireEvent.click(del);
		expect(h.commits).toHaveLength(0);
	});

	it("Delete confirms then fires page.delete on a multi-page document", async () => {
		const h = makeHarness({ ir: multiPage() });
		mount(h.studioCtx);
		await openPageMenu("p1");
		const del = screen.getByTestId("page-menu-delete-p1");
		expect(isMenuItemDisabled(del)).toBe(false);
		fireEvent.click(del);
		await waitFor(() => {
			expect(h.commits).toHaveLength(1);
		});
		const cmd = h.commits[0] as CanvasPageDeleteCommand;
		expect(cmd.type).toBe("page.delete");
		expect(cmd.pageId).toBe("p1");
	});
});
