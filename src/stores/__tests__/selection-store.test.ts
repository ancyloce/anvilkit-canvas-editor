import { encodeResolvedNodeId } from "@anvilkit/canvas-core";
import { describe, expect, it } from "vitest";
import {
	type CanvasSelectionTarget,
	createSelectionStore,
	projectSelectionTargets,
} from "../selection-store.js";

describe("createSelectionStore — defaults", () => {
	it("starts with an empty selection", () => {
		const store = createSelectionStore();
		expect(store.getState().selectedIds).toEqual([]);
		expect(store.getState().isSelected("n1")).toBe(false);
	});
});

describe("createSelectionStore — setSelection", () => {
	it("replaces the current selection", () => {
		const store = createSelectionStore();
		store.getState().setSelection(["a", "b"]);
		expect(store.getState().selectedIds).toEqual(["a", "b"]);
		store.getState().setSelection(["c"]);
		expect(store.getState().selectedIds).toEqual(["c"]);
	});

	it("dedupes input", () => {
		const store = createSelectionStore();
		store.getState().setSelection(["a", "a", "b"]);
		expect(store.getState().selectedIds).toEqual(["a", "b"]);
	});
});

describe("createSelectionStore — add / remove / toggle", () => {
	it("addToSelection appends if not present", () => {
		const store = createSelectionStore();
		store.getState().addToSelection("a");
		store.getState().addToSelection("b");
		store.getState().addToSelection("a"); // no-op
		expect(store.getState().selectedIds).toEqual(["a", "b"]);
	});

	it("removeFromSelection drops the id (no-op if absent)", () => {
		const store = createSelectionStore();
		store.getState().setSelection(["a", "b"]);
		store.getState().removeFromSelection("a");
		expect(store.getState().selectedIds).toEqual(["b"]);
		store.getState().removeFromSelection("missing");
		expect(store.getState().selectedIds).toEqual(["b"]);
	});

	it("toggleSelection adds when missing, removes when present", () => {
		const store = createSelectionStore();
		store.getState().toggleSelection("a");
		expect(store.getState().selectedIds).toEqual(["a"]);
		store.getState().toggleSelection("a");
		expect(store.getState().selectedIds).toEqual([]);
		store.getState().toggleSelection("b");
		store.getState().toggleSelection("c");
		expect(store.getState().selectedIds).toEqual(["b", "c"]);
	});
});

describe("createSelectionStore — clearSelection / isSelected", () => {
	it("clearSelection empties the list", () => {
		const store = createSelectionStore();
		store.getState().setSelection(["a", "b", "c"]);
		store.getState().clearSelection();
		expect(store.getState().selectedIds).toEqual([]);
	});

	it("isSelected reflects membership", () => {
		const store = createSelectionStore();
		store.getState().setSelection(["a"]);
		expect(store.getState().isSelected("a")).toBe(true);
		expect(store.getState().isSelected("b")).toBe(false);
	});
});

describe("createSelectionStore — independent instances", () => {
	it("two stores do not share state", () => {
		const a = createSelectionStore();
		const b = createSelectionStore();
		a.getState().addToSelection("x");
		expect(a.getState().selectedIds).toEqual(["x"]);
		expect(b.getState().selectedIds).toEqual([]);
	});
});

/**
 * T-SEL-1 (plan 0023 M4-04): the target union is ADDITIVE. `selectedIds` keeps
 * its exact pre-component shape and meaning, and is always the projection of
 * `targets` — the drift between two sources of truth is the entire risk this
 * design carries, so it is pinned here rather than assumed.
 */
const virtualTarget = (
	instanceId: string,
	sourceNodeId: string,
): CanvasSelectionTarget => ({
	kind: "instance-node",
	instanceId,
	resolvedNodeId: encodeResolvedNodeId({
		segments: [instanceId, sourceNodeId],
	}),
	sourceNodeId,
});

/** The invariant, checked after every mutation in these tests. */
function expectProjectionHolds(store: ReturnType<typeof createSelectionStore>) {
	const { selectedIds, targets } = store.getState();
	expect(selectedIds).toEqual(projectSelectionTargets(targets));
}

describe("createSelectionStore — selection targets (M4-04)", () => {
	it("mirrors plain selections into targets", () => {
		const store = createSelectionStore();
		store.getState().setSelection(["a", "b"]);
		expect(store.getState().targets).toEqual([
			{ kind: "node", nodeId: "a" },
			{ kind: "node", nodeId: "b" },
		]);
		expectProjectionHolds(store);
	});

	it("projects a virtual target onto its OWNING instance id", () => {
		const store = createSelectionStore();
		store.getState().setTargets([virtualTarget("inst-1", "src-title")]);
		// Existing consumers — transformer, align, export-by-selection — see a
		// perfectly ordinary single-node selection of the instance.
		expect(store.getState().selectedIds).toEqual(["inst-1"]);
		expectProjectionHolds(store);
	});

	it("dedupes two virtual targets inside one instance to a single id", () => {
		const store = createSelectionStore();
		store
			.getState()
			.setTargets([
				virtualTarget("inst-1", "src-title"),
				virtualTarget("inst-1", "src-body"),
			]);
		expect(store.getState().selectedIds).toEqual(["inst-1"]);
		expect(store.getState().targets).toHaveLength(2);
		expectProjectionHolds(store);
	});

	it("keeps the projection intact across add / toggle / remove", () => {
		const store = createSelectionStore();
		store
			.getState()
			.setTargets([
				{ kind: "node", nodeId: "plain" },
				virtualTarget("inst-1", "src-title"),
			]);
		expect(store.getState().selectedIds).toEqual(["plain", "inst-1"]);

		store.getState().addToSelection("other");
		expectProjectionHolds(store);
		store.getState().toggleSelection("plain");
		expectProjectionHolds(store);

		// Removing the instance drops the virtual target under it too: a target
		// pointing into a no-longer-selected instance would be orphaned.
		store.getState().removeFromSelection("inst-1");
		expect(store.getState().selectedIds).toEqual(["other"]);
		expect(store.getState().targets).toEqual([
			{ kind: "node", nodeId: "other" },
		]);
		expectProjectionHolds(store);
	});

	it("clearSelection empties both halves", () => {
		const store = createSelectionStore();
		store.getState().setTargets([virtualTarget("inst-1", "src-title")]);
		store.getState().clearSelection();
		expect(store.getState().selectedIds).toEqual([]);
		expect(store.getState().targets).toEqual([]);
	});

	it("isSelected answers on the persistent projection", () => {
		const store = createSelectionStore();
		store.getState().setTargets([virtualTarget("inst-1", "src-title")]);
		expect(store.getState().isSelected("inst-1")).toBe(true);
		// The virtual id is NOT a persistent node id, so it is not "selected" in
		// the sense every existing consumer means.
		expect(store.getState().isSelected("src-title")).toBe(false);
	});
});
