import {
	type CanvasIR,
	type CanvasPageCreateCommand,
	type CanvasPageDeleteCommand,
	createCanvasIR,
	createPage,
	createRect,
	insertNode,
} from "@anvilkit/canvas-core";
import { cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { CanvasStudioContext } from "@/context/canvas-studio-context.js";
import type { CanvasTemplateEntry } from "@/templates/template-entry.js";
import { makeHarness } from "@/tools/__tests__/_tool-test-helpers.js";
import { TemplatesPanel } from "../TemplatesPanel.js";
import { loadTemplate } from "../template-actions.js";

const FIXED_TS = "2026-07-09T00:00:00.000Z";

function templateIR(): CanvasIR {
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

function entry(): CanvasTemplateEntry {
	return {
		slug: "poster",
		name: "Event Poster",
		description: "A poster.",
		ir: templateIR(),
	};
}

// react-library vitest preset has globals:false — RTL auto-cleanup is OFF.
afterEach(cleanup);

function renderPanel(templates?: readonly CanvasTemplateEntry[]) {
	const h = makeHarness();
	const view = render(
		<CanvasStudioContext.Provider value={{ ...h.studioCtx, templates }}>
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

	it("lists templates and reveals an inline confirm on click", () => {
		const { view } = renderPanel([entry()]);
		expect(view.queryByTestId("template-confirm-poster")).toBeNull();
		fireEvent.click(view.getByTestId("template-item-poster"));
		expect(view.getByTestId("template-confirm-poster")).toBeDefined();
		// Cancel collapses the confirm without committing.
		fireEvent.click(view.getByText("Cancel"));
		expect(view.queryByTestId("template-confirm-poster")).toBeNull();
	});

	it("confirm dispatches ONE batch that creates template pages then deletes prior pages", () => {
		const { h, view } = renderPanel([entry()]);
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
});

describe("loadTemplate", () => {
	it("clones template pages with fresh ids and switches to the first new page", () => {
		const h = makeHarness();
		const tpl = entry();
		loadTemplate({ ...h.studioCtx, templates: [tpl] }, tpl);

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
		// Single-page template keeps the template's name (no " 1" suffix).
		expect(create?.page.name).toBe("Event Poster");
		// Active page switched to the newly created page.
		expect(h.studioCtx.pagesStore.getState().activePageId).toBe(
			create?.page.id,
		);
	});

	it("is a no-op for a template with zero pages", () => {
		const h = makeHarness();
		const tpl: CanvasTemplateEntry = {
			slug: "empty",
			name: "Empty",
			ir: { ...templateIR(), pages: [] },
		};
		loadTemplate(h.studioCtx, tpl);
		expect(h.studioCtx.commitBatch).not.toHaveBeenCalled();
	});
});
