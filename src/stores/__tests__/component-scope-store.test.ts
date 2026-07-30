import { MAX_COMPONENT_NESTED_DEPTH } from "@anvilkit/canvas-core";
import { describe, expect, it } from "vitest";
import {
	type CanvasComponentEditingFrame,
	createComponentScopeStore,
} from "../component-scope-store.js";

/**
 * @file T-SCOPE-1 (plan 0023 M4-05) — Source editing scope is a STACK: enter A,
 * enter B nested inside it, Escape pops one frame at a time.
 */

const fromPage = (componentId: string): CanvasComponentEditingFrame => ({
	componentId,
	returnSelection: { kind: "page", pageId: "p1", selectedIds: ["inst-a"] },
});

const fromComponent = (
	componentId: string,
	host: string,
	selectedIds: readonly string[] = [],
): CanvasComponentEditingFrame => ({
	componentId,
	returnSelection: { kind: "component", componentId: host, selectedIds },
});

describe("createComponentScopeStore", () => {
	it("starts closed", () => {
		const store = createComponentScopeStore();
		expect(store.getState().stack).toEqual([]);
		expect(store.getState().activeFrame()).toBeNull();
		expect(store.getState().isOpen("cmp-a")).toBe(false);
	});

	it("T-SCOPE-1: A → B → pop → pop, one frame at a time", () => {
		const store = createComponentScopeStore();
		expect(store.getState().enter(fromPage("cmp-a"))).toBeNull();
		expect(
			store.getState().enter(fromComponent("cmp-b", "cmp-a", ["n-1"])),
		).toBeNull();

		expect(store.getState().stack.map((f) => f.componentId)).toEqual([
			"cmp-a",
			"cmp-b",
		]);
		expect(store.getState().activeFrame()?.componentId).toBe("cmp-b");

		// Popping hands the frame back so the caller can restore where the user
		// was — here, inside A's Source with n-1 selected.
		const poppedB = store.getState().exitOne();
		expect(poppedB?.componentId).toBe("cmp-b");
		expect(poppedB?.returnSelection).toEqual({
			kind: "component",
			componentId: "cmp-a",
			selectedIds: ["n-1"],
		});
		expect(store.getState().activeFrame()?.componentId).toBe("cmp-a");

		const poppedA = store.getState().exitOne();
		expect(poppedA?.returnSelection.kind).toBe("page");
		expect(store.getState().stack).toEqual([]);
		expect(store.getState().exitOne()).toBeNull();
	});

	it("rejects re-entering a component already on the stack", () => {
		const store = createComponentScopeStore();
		store.getState().enter(fromPage("cmp-a"));
		store.getState().enter(fromComponent("cmp-b", "cmp-a"));
		// The interactive face of the DAG rule: A inside A is the start of a cycle,
		// so the UI must refuse before any document write is even contemplated.
		expect(store.getState().enter(fromComponent("cmp-a", "cmp-b"))).toBe(
			"already-open",
		);
		expect(store.getState().stack).toHaveLength(2);
	});

	it("refuses to nest deeper than the resolver would expand", () => {
		const store = createComponentScopeStore({ maxDepth: 2 });
		expect(store.getState().enter(fromPage("cmp-1"))).toBeNull();
		expect(store.getState().enter(fromComponent("cmp-2", "cmp-1"))).toBeNull();
		expect(store.getState().enter(fromComponent("cmp-3", "cmp-2"))).toBe(
			"depth-exceeded",
		);
		expect(store.getState().stack).toHaveLength(2);
	});

	it("defaults its cap to the resolver's nesting limit", () => {
		const store = createComponentScopeStore();
		for (let i = 0; i < MAX_COMPONENT_NESTED_DEPTH; i += 1) {
			expect(store.getState().enter(fromPage(`cmp-${i}`))).toBeNull();
		}
		expect(store.getState().enter(fromPage("one-too-deep"))).toBe(
			"depth-exceeded",
		);
	});

	it("exitAll returns the OUTERMOST frame so the page return address survives", () => {
		const store = createComponentScopeStore();
		store.getState().enter(fromPage("cmp-a"));
		store.getState().enter(fromComponent("cmp-b", "cmp-a"));
		store.getState().enter(fromComponent("cmp-c", "cmp-b"));

		const outermost = store.getState().exitAll();
		expect(outermost?.componentId).toBe("cmp-a");
		expect(outermost?.returnSelection).toEqual({
			kind: "page",
			pageId: "p1",
			selectedIds: ["inst-a"],
		});
		expect(store.getState().stack).toEqual([]);
		expect(store.getState().exitAll()).toBeNull();
	});

	it("keeps two instances independent", () => {
		const a = createComponentScopeStore();
		const b = createComponentScopeStore();
		a.getState().enter(fromPage("cmp-a"));
		expect(a.getState().stack).toHaveLength(1);
		expect(b.getState().stack).toHaveLength(0);
	});
});
