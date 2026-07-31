import type {
	BrandComplianceIssue,
	CanvasComponentDefinition,
	CanvasIR,
} from "@anvilkit/canvas-core";
import {
	createCanvasIR,
	createComponentInstance,
	createGroup,
	createPage,
	createRect,
} from "@anvilkit/canvas-core";
import { cleanup, render } from "@testing-library/react";
import * as React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { CanvasStudioContext } from "@/context/canvas-studio-context.js";
import { makeHarness } from "@/tools/__tests__/_tool-test-helpers.js";
import { CompliancePanel } from "../CompliancePanel.js";

/** T-044 — navigation to each target class, and status that is not colour alone. */

// `globals: false` in the preset means RTL auto-cleanup is OFF.
afterEach(cleanup);

const DEFINITION = {
	id: "card",
	name: "Card",
	revision: 1,
	root: createGroup({
		id: "card-root",
		children: [
			createRect({
				id: "card-inner",
				bounds: { width: 4, height: 4 },
				fill: "#ff0000",
			}),
		],
	}),
	properties: [],
} as unknown as CanvasComponentDefinition;

function makeIR(): CanvasIR {
	const rect = createRect({
		id: "plain-rect",
		bounds: { width: 10, height: 10 },
		fill: "#ff0000",
	});
	const instance = createComponentInstance({
		id: "inst-1",
		componentId: "card",
		bounds: { width: 10, height: 10 },
	});
	return {
		...createCanvasIR({
			id: "doc",
			pages: [
				createPage({
					id: "p1",
					root: createGroup({ id: "p1-root", children: [rect] }),
				}),
				createPage({
					id: "p2",
					root: createGroup({ id: "p2-root", children: [instance] }),
				}),
			],
		}),
		components: { card: DEFINITION },
	};
}

function issue(over: Partial<BrandComplianceIssue>): BrandComplianceIssue {
	return {
		nodeId: "plain-rect",
		code: "off-brand-color",
		property: "fill",
		value: "#ff0000",
		...over,
	} as BrandComplianceIssue;
}

function mount(
	issues: readonly BrandComplianceIssue[],
	onComponentTarget?: (id: string) => void,
) {
	const h = makeHarness({ ir: makeIR() });
	const ctx = { ...h.studioCtx, ir: h.studioCtx.getIR() };
	const view = render(
		<CanvasStudioContext.Provider value={ctx}>
			<CompliancePanel
				issues={issues}
				t={(_k: string, f?: string) => f ?? ""}
				{...(onComponentTarget ? { onComponentTarget } : {})}
			/>
		</CanvasStudioContext.Provider>,
	);
	return { view, ctx };
}

describe("CompliancePanel", () => {
	it("shows a clean state rather than an empty box", () => {
		const { view } = mount([]);
		expect(view.getByTestId("compliance-panel-clean").textContent).toContain(
			"No brand issues found",
		);
	});

	it("navigates to a page node: activates its page and selects it", () => {
		const { view, ctx } = mount([issue({ nodeId: "inst-1" })]);
		view.getByTestId("compliance-issue-inst-1-off-brand-color").click();
		expect(ctx.pagesStore.getState().activePageId).toBe("p2");
		expect(ctx.selectionStore.getState().selectedIds).toEqual(["inst-1"]);
	});

	it("selects the page-level instance for an issue on a virtual Source node", () => {
		const { view, ctx } = mount([
			issue({ nodeId: "inst-1::card-inner", instanceId: "inst-1" }),
		]);
		view
			.getByTestId("compliance-issue-inst-1::card-inner-off-brand-color")
			.click();
		// Never the virtual id — it changes whenever the Source or variant does.
		expect(ctx.selectionStore.getState().selectedIds).toEqual(["inst-1"]);
	});

	it("falls back to the Components panel for a Source-only node", () => {
		const onComponentTarget = vi.fn();
		const { view, ctx } = mount(
			[issue({ nodeId: "card-inner" })],
			onComponentTarget,
		);
		const row = view.getByTestId("compliance-issue-card-inner-off-brand-color");
		expect(row.getAttribute("data-target")).toBe("component");
		row.click();
		expect(onComponentTarget).toHaveBeenCalledWith("card");
		// Navigation must not change selection for this class — entering a Source
		// is a scope push, not something a report row does behind the user.
		expect(ctx.selectionStore.getState().selectedIds).toEqual([]);
	});

	it("disables and explains an unresolvable issue instead of doing nothing", () => {
		const { view } = mount([issue({ nodeId: "ghost" })]);
		const row = view.getByTestId("compliance-issue-ghost-off-brand-color");
		expect(row.getAttribute("data-target")).toBe("unavailable");
		expect((row as HTMLButtonElement).disabled).toBe(true);
		expect(row.getAttribute("title")).toContain("Components panel");
	});

	it("navigating is never a document edit", () => {
		const { view, ctx } = mount([issue({ nodeId: "inst-1" })]);
		const before = ctx.getIR();
		view.getByTestId("compliance-issue-inst-1-off-brand-color").click();
		// Looking at a problem must not land in the undo stack.
		expect(ctx.getIR()).toBe(before);
		expect(ctx.historyStore.getState().past).toHaveLength(0);
	});

	it("conveys severity by text, not colour alone (T-044 step 5)", () => {
		const { view } = mount([
			issue({ nodeId: "inst-1", severity: "blocking" }),
			issue({ nodeId: "plain-rect", severity: "warning" }),
		]);
		const blocking = view.getByTestId(
			"compliance-issue-inst-1-off-brand-color",
		);
		expect(blocking.getAttribute("data-severity")).toBe("blocking");
		// The severity word is in the accessible name, so it survives monochrome
		// rendering and a screen reader.
		expect(blocking.textContent).toContain("Blocking");
		expect(
			view.getByTestId("compliance-issue-plain-rect-off-brand-color")
				.textContent,
		).toContain("Warning");
	});

	it("renders every issue for a small report and keeps duplicates distinct", () => {
		// Two issues that share node+code+property must both survive — a colliding
		// React key silently drops one, which reads as a missing issue.
		const { view } = mount([
			issue({ value: "#ff0000" }),
			issue({ value: "#00ff00" }),
		]);
		expect(
			view.getAllByTestId("compliance-issue-plain-rect-off-brand-color"),
		).toHaveLength(2);
	});

	it("virtualizes a large report (T-044 step 6)", () => {
		const many = Array.from({ length: 400 }, (_, i) =>
			issue({ nodeId: "plain-rect", property: `fill-${i}` }),
		);
		const { view } = mount(many);
		// The point of windowing: 400 issues must not be 400 mounted rows.
		expect(view.getAllByTestId(/^compliance-issue-/).length).toBeLessThan(
			many.length,
		);
		expect(view.getByTestId("compliance-issue-rows")).toBeDefined();
	});
});
