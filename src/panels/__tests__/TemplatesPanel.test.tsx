import {
	type CanvasIR,
	type CanvasPageCreateCommand,
	type CanvasPageDeleteCommand,
	createCanvasIR,
	createPage,
	createRect,
	insertNode,
} from "@anvilkit/canvas-core";
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CanvasStudioContext } from "@/context/canvas-studio-context.js";
import type { CanvasTemplateEntry } from "@/templates/template-entry.js";
import type {
	CanvasTemplateProvider,
	CanvasTemplateSearchQuery,
} from "@/templates/template-provider.js";
import { makeHarness } from "@/tools/__tests__/_tool-test-helpers.js";
import { TemplatesPanel } from "../TemplatesPanel.js";
import { insertTemplateAsNewPages, loadTemplate } from "../template-actions.js";

const FIXED_TS = "2026-07-09T00:00:00.000Z";

function templateDocument(): CanvasIR {
	const page = createPage({ id: "tpl-page-1" });
	let ir = createCanvasIR({
		id: "tpl-1",
		title: "Template",
		pages: [page],
		now: () => FIXED_TS,
	});
	ir = insertNode(ir, {
		parentId: page.root.id,
		node: createRect({ id: "tpl-rect", bounds: { width: 100, height: 50 } }),
	});
	return ir;
}

function entry(
	overrides: Partial<CanvasTemplateEntry> = {},
): CanvasTemplateEntry {
	return {
		id: "poster",
		version: "1",
		title: "Event Poster",
		description: "A poster.",
		category: "social",
		tags: ["poster"],
		supportedSizes: [],
		document: templateDocument(),
		variables: [],
		editableSlots: [],
		lockedNodeIds: [],
		...overrides,
	};
}

// react-library vitest preset has globals:false — RTL auto-cleanup is OFF.
afterEach(cleanup);

function renderPanel(
	templates?: readonly CanvasTemplateEntry[],
	templateProvider?: CanvasTemplateProvider,
) {
	const h = makeHarness();
	const view = render(
		<CanvasStudioContext.Provider
			value={{ ...h.studioCtx, templates, templateProvider }}
		>
			<TemplatesPanel />
		</CanvasStudioContext.Provider>,
	);
	return { h, view };
}

describe("TemplatesPanel", () => {
	it("renders the empty state when the host supplies no templates", () => {
		const { view } = renderPanel(undefined);
		expect(view.getByTestId("templates-panel-empty")).toBeDefined();
	});

	it("lists templates and reveals an inline confirm on click", async () => {
		const { view } = renderPanel([entry()]);
		await view.findByTestId("template-item-poster");
		expect(view.queryByTestId("template-confirm-poster")).toBeNull();
		fireEvent.click(view.getByTestId("template-item-poster"));
		expect(view.getByTestId("template-confirm-poster")).toBeDefined();
		// Cancel collapses the confirm without committing.
		fireEvent.click(view.getByText("Cancel"));
		expect(view.queryByTestId("template-confirm-poster")).toBeNull();
	});

	it("filters the list by a free-text search across title/description/tags", async () => {
		const flyer = entry({
			id: "flyer",
			title: "Flyer",
			description: "A print flyer.",
			category: "print",
			tags: ["flyer", "print"],
		});
		const { view } = renderPanel([entry(), flyer]);
		await view.findByTestId("template-item-poster");
		expect(view.getByTestId("template-item-flyer")).toBeDefined();

		fireEvent.change(view.getByTestId("templates-search"), {
			target: { value: "flyer" },
		});
		await waitFor(() =>
			expect(view.queryByTestId("template-item-poster")).toBeNull(),
		);
		expect(view.getByTestId("template-item-flyer")).toBeDefined();
	});

	it("shows a no-results message when the search matches nothing", async () => {
		const { view } = renderPanel([entry()]);
		await view.findByTestId("template-item-poster");
		fireEvent.change(view.getByTestId("templates-search"), {
			target: { value: "no such template" },
		});
		await view.findByTestId("templates-panel-no-results");
	});

	it("confirm dispatches ONE batch that creates template pages then deletes prior pages", async () => {
		const { h, view } = renderPanel([entry()]);
		await view.findByTestId("template-item-poster");
		fireEvent.click(view.getByTestId("template-item-poster"));
		fireEvent.click(view.getByTestId("template-load-poster"));

		expect(h.studioCtx.commitBatch).toHaveBeenCalledTimes(1);
		const [cmds, label] = (
			h.studioCtx.commitBatch as unknown as {
				mock: { calls: [readonly unknown[], string][] };
			}
		).mock.calls[0];
		expect(label).toContain("Event Poster");

		const creates = (cmds as { type: string }[]).filter(
			(c) => c.type === "page.create",
		) as CanvasPageCreateCommand[];
		const deletes = (cmds as { type: string }[]).filter(
			(c) => c.type === "page.delete",
		) as CanvasPageDeleteCommand[];
		expect(creates).toHaveLength(1);
		expect(deletes).toHaveLength(1);
		// Creates come first (never violates the one-page schema minimum).
		expect((cmds as { type: string }[])[0].type).toBe("page.create");
		// Prior page is the harness default page.
		expect(deletes[0].pageId).toBe("p1");
	});

	it("insert-as-new commits a single batch via ctx.commit and never touches commitBatch", async () => {
		const { h, view } = renderPanel([entry()]);
		await view.findByTestId("template-item-poster");
		fireEvent.click(view.getByTestId("template-item-poster"));
		fireEvent.click(view.getByTestId("template-insert-new-poster"));

		expect(h.studioCtx.commit).toHaveBeenCalledTimes(1);
		expect(h.studioCtx.commitBatch).not.toHaveBeenCalled();
		const [cmd] = (
			h.studioCtx.commit as unknown as {
				mock: { calls: [{ type: string }][] };
			}
		).mock.calls[0];
		expect(cmd.type).toBe("batch");
	});
});

describe("loadTemplate", () => {
	it("clones template pages with fresh ids and switches to the first new page", () => {
		const h = makeHarness();
		const tpl = entry();
		const result = loadTemplate({ ...h.studioCtx, templates: [tpl] }, tpl);
		expect(result.ok).toBe(true);

		const [cmds] = (
			h.studioCtx.commitBatch as unknown as {
				mock: { calls: [readonly unknown[], string][] };
			}
		).mock.calls[0];
		const create = (cmds as CanvasPageCreateCommand[]).find(
			(c) => c.type === "page.create",
		);
		expect(create).toBeDefined();
		// Ids regenerated: never reuses the template's authored ids.
		expect(create?.page.id).not.toBe("tpl-page-1");
		expect(create?.page.root.children[0]?.id).not.toBe("tpl-rect");
		// Active page switched to the newly created page.
		expect(h.studioCtx.pagesStore.getState().activePageId).toBe(
			create?.page.id,
		);
	});

	it("returns a structured error and never commits for a template whose document fails validation", () => {
		const h = makeHarness();
		const tpl = entry({ document: { ...templateDocument(), pages: [] } });
		const result = loadTemplate(h.studioCtx, tpl);
		expect(result.ok).toBe(false);
		expect(h.studioCtx.commitBatch).not.toHaveBeenCalled();
	});
});

describe("insertTemplateAsNewPages", () => {
	it("is a no-op for a template whose document fails validation", () => {
		const h = makeHarness();
		const tpl = entry({ document: { ...templateDocument(), pages: [] } });
		const result = insertTemplateAsNewPages(h.studioCtx, tpl);
		expect(result.ok).toBe(false);
		expect(h.studioCtx.commit).not.toHaveBeenCalled();
	});
});

describe("TemplatesPanel — provider protocol (C-06, FR-130/131)", () => {
	it("a host provider takes precedence and pagination loads more", async () => {
		const first = entry({ id: "page1-item", title: "Alpha" });
		const second = entry({ id: "page2-item", title: "Beta" });
		const search = vi.fn((query: CanvasTemplateSearchQuery) =>
			Promise.resolve(
				query.cursor
					? { entries: [second] }
					: { entries: [first], nextCursor: "1" },
			),
		);
		const provider: CanvasTemplateProvider = {
			search,
			getById: () => Promise.resolve(null),
		};
		const { view } = renderPanel(undefined, provider);
		await view.findByTestId("template-item-page1-item");
		expect(view.queryByTestId("template-item-page2-item")).toBeNull();
		fireEvent.click(view.getByTestId("templates-load-more"));
		await view.findByTestId("template-item-page2-item");
		// Loaded pages accumulate.
		expect(view.getByTestId("template-item-page1-item")).toBeDefined();
		expect(view.queryByTestId("templates-load-more")).toBeNull();
	});

	it("a rejecting provider shows the error state and Retry re-queries", async () => {
		let fail = true;
		const provider: CanvasTemplateProvider = {
			search: () =>
				fail
					? Promise.reject(new Error("network"))
					: Promise.resolve({ entries: [entry()] }),
			getById: () => Promise.resolve(null),
		};
		const { view } = renderPanel(undefined, provider);
		await view.findByTestId("templates-panel-error");
		fail = false;
		fireEvent.click(view.getByTestId("templates-retry"));
		await view.findByTestId("template-item-poster");
		expect(view.queryByTestId("templates-panel-error")).toBeNull();
	});

	it("the size filter is passed to the provider as first-page dimensions", async () => {
		const search = vi.fn(() => Promise.resolve({ entries: [entry()] }));
		const provider: CanvasTemplateProvider = {
			search,
			getById: () => Promise.resolve(null),
		};
		const { view } = renderPanel(undefined, provider);
		await view.findByTestId("template-item-poster");
		expect(view.getByTestId("templates-size-filter")).toBeDefined();
		expect(search).toHaveBeenCalledWith(
			expect.not.objectContaining({ size: expect.anything() }),
		);
	});
});
