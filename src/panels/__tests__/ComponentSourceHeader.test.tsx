import type {
	CanvasComponentDefinition,
	CanvasIR,
	CanvasNode,
} from "@anvilkit/canvas-core";
import { createCanvasIR, createFrame, createPage } from "@anvilkit/canvas-core";
import { cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { CanvasStudioContext } from "@/context/canvas-studio-context.js";
import { createComponentScopeStore } from "@/stores/component-scope-store.js";
import { makeHarness } from "@/tools/__tests__/_tool-test-helpers.js";
import { ComponentSourceHeader } from "../ComponentSourceHeader.js";

/**
 * @file M5-03 breadcrumb — renders the WHOLE scope stack, and every crumb is a
 * way out. Navigation touches no IR, so no test here expects a commit.
 */

afterEach(cleanup);

function definition(id: string, name: string): CanvasComponentDefinition {
	return {
		id,
		name,
		revision: 1,
		properties: [],
		root: createFrame({
			id: `${id}-root`,
			bounds: { width: 80, height: 40 },
		}) as CanvasNode,
	};
}

function doc(): CanvasIR {
	const ir = createCanvasIR({
		id: "doc",
		title: "t",
		pages: [createPage({ id: "p1" })],
	});
	return {
		...ir,
		components: {
			"cmp-a": definition("cmp-a", "Alpha"),
			"cmp-b": definition("cmp-b", "Beta"),
		},
	};
}

function mount(frames: readonly string[]) {
	const ir = doc();
	const h = makeHarness({ ir });
	const componentScopeStore = createComponentScopeStore();
	for (const componentId of frames) {
		componentScopeStore.getState().enter({
			componentId,
			returnSelection: { kind: "page", pageId: "p1", selectedIds: [] },
		});
	}
	const view = render(
		<CanvasStudioContext.Provider
			value={{ ...h.studioCtx, ir, componentScopeStore }}
		>
			<ComponentSourceHeader />
		</CanvasStudioContext.Provider>,
	);
	return { view, h, scope: componentScopeStore };
}

describe("ComponentSourceHeader", () => {
	it("renders nothing while editing a page", () => {
		const { view } = mount([]);
		// Mounted unconditionally by the workspace, so the page-mode cost must be
		// exactly zero DOM.
		expect(view.queryByTestId("component-source-header")).toBeNull();
	});

	it("renders one crumb per stack frame, innermost marked current", () => {
		const { view } = mount(["cmp-a", "cmp-b"]);
		expect(view.getByTestId("component-source-header")).toBeDefined();
		expect(view.getByTestId("component-crumb-cmp-a").textContent).toContain(
			"Alpha",
		);
		const innermost = view.getByTestId(
			"component-crumb-cmp-b",
		) as HTMLButtonElement;
		expect(innermost.textContent).toContain("Beta");
		// The current scope is not a navigation target.
		expect(innermost.disabled).toBe(true);
		expect(innermost.getAttribute("aria-current")).toBe("true");
	});

	it("clicking an outer crumb pops back to it", () => {
		const { view, scope, h } = mount(["cmp-a", "cmp-b"]);
		fireEvent.click(view.getByTestId("component-crumb-cmp-a"));
		expect(scope.getState().stack.map((f) => f.componentId)).toEqual(["cmp-a"]);
		expect(h.commits).toHaveLength(0);
	});

	it("the Page crumb leaves every frame", () => {
		const { view, scope } = mount(["cmp-a", "cmp-b"]);
		fireEvent.click(view.getByTestId("component-crumb-page"));
		expect(scope.getState().stack).toEqual([]);
	});

	it("the exit button pops exactly one frame", () => {
		const { view, scope } = mount(["cmp-a", "cmp-b"]);
		fireEvent.click(view.getByTestId("component-source-exit"));
		expect(scope.getState().stack.map((f) => f.componentId)).toEqual(["cmp-a"]);
	});

	it("still renders a frame whose definition has vanished", () => {
		const ir = doc();
		const h = makeHarness({ ir });
		const componentScopeStore = createComponentScopeStore();
		componentScopeStore.getState().enter({
			componentId: "cmp-deleted",
			returnSelection: { kind: "page", pageId: "p1", selectedIds: [] },
		});
		const view = render(
			<CanvasStudioContext.Provider
				value={{ ...h.studioCtx, ir, componentScopeStore }}
			>
				<ComponentSourceHeader />
			</CanvasStudioContext.Provider>,
		);
		// A remote peer's delete (or an undo) must not trap the user in a scope
		// with no way out.
		expect(
			view.getByTestId("component-crumb-cmp-deleted").textContent,
		).toContain("Missing component");
		fireEvent.click(view.getByTestId("component-crumb-page"));
		expect(componentScopeStore.getState().stack).toEqual([]);
	});

	it("announces politely without stealing focus", () => {
		const { view } = mount(["cmp-a"]);
		expect(
			view.getByTestId("component-source-header").getAttribute("aria-live"),
		).toBe("polite");
	});
});
