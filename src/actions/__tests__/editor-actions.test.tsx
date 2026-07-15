import {
	type CanvasIR,
	type CanvasNodeMoveCommand,
	createCanvasIR,
	createGroup,
	createPage,
	createRect,
} from "@anvilkit/canvas-core";
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { CanvasStudioContext } from "@/context/canvas-studio-context.js";
import { makeHarness } from "@/tools/__tests__/_tool-test-helpers.js";
import {
	type CanvasEditorActions,
	createCanvasEditorActions,
	useCanvasActions,
} from "../editor-actions.js";

const FIXED_TS = "2026-05-20T00:00:00.000Z";

/**
 * Page p1 root children: rect `a`, rect `b`, LOCKED rect `c`, and group `g`
 * containing rect `d`.
 */
function fixtureIR(): CanvasIR {
	const page = createPage({ id: "p1" });
	page.root = createGroup({
		id: "p1-root",
		bounds: page.root.bounds,
		children: [
			createRect({
				id: "a",
				transform: { x: 0 },
				bounds: { width: 50, height: 50 },
			}),
			createRect({
				id: "b",
				transform: { x: 80 },
				bounds: { width: 50, height: 50 },
			}),
			{
				...createRect({
					id: "c",
					transform: { x: 160 },
					bounds: { width: 50, height: 50 },
				}),
				locked: true,
			},
			createGroup({
				id: "g",
				children: [createRect({ id: "d" })],
			}),
		],
	});
	return createCanvasIR({ id: "ir", pages: [page], now: () => FIXED_TS });
}

function makeActionsHarness() {
	const h = makeHarness({ ir: fixtureIR() });
	const actions = createCanvasEditorActions(h.studioCtx);
	return { h, actions };
}

afterEach(cleanup);

describe("createCanvasEditorActions — deleteSelection", () => {
	it("deletes a multi-selection as ONE batch and clears the selection", () => {
		const { h, actions } = makeActionsHarness();
		h.studioCtx.selectionStore.getState().setSelection(["a", "b"]);
		const deleted = actions.deleteSelection();
		expect(deleted).toEqual(["a", "b"]);
		// One undoable entry: a single commitBatch call, no single commits.
		expect(h.studioCtx.commitBatch).toHaveBeenCalledTimes(1);
		expect(h.studioCtx.commit).not.toHaveBeenCalled();
		expect(h.commits.map((c) => c.type)).toEqual([
			"node.delete",
			"node.delete",
		]);
		expect(h.studioCtx.selectionStore.getState().selectedIds).toHaveLength(0);
	});

	it("skips locked nodes (FR-024)", () => {
		const { h, actions } = makeActionsHarness();
		h.studioCtx.selectionStore.getState().setSelection(["a", "c"]);
		const deleted = actions.deleteSelection();
		expect(deleted).toEqual(["a"]);
		// Only one deletable node → plain commit, not a batch.
		expect(h.studioCtx.commit).toHaveBeenCalledTimes(1);
		expect(h.studioCtx.commitBatch).not.toHaveBeenCalled();
	});

	it("skips descendants of a selected ancestor (no double-delete in the batch)", () => {
		const { h, actions } = makeActionsHarness();
		h.studioCtx.selectionStore.getState().setSelection(["g", "d"]);
		const deleted = actions.deleteSelection();
		expect(deleted).toEqual(["g"]);
		expect(h.commits).toHaveLength(1);
	});

	it("is a no-op for an empty or fully-locked selection", () => {
		const { h, actions } = makeActionsHarness();
		actions.deleteSelection();
		h.studioCtx.selectionStore.getState().setSelection(["c"]);
		const deleted = actions.deleteSelection();
		expect(deleted).toEqual([]);
		expect(h.commits).toHaveLength(0);
		// Selection is preserved on a no-op (nothing was deleted).
		expect(h.studioCtx.selectionStore.getState().selectedIds).toEqual(["c"]);
	});
});

describe("createCanvasEditorActions — delegation", () => {
	it("groupSelection emits node.group and selects the new group", () => {
		const { h, actions } = makeActionsHarness();
		h.studioCtx.selectionStore.getState().setSelection(["a", "b"]);
		const groupId = actions.groupSelection();
		expect(groupId).not.toBeNull();
		expect(h.commits.map((c) => c.type)).toEqual(["node.group"]);
		expect(h.studioCtx.selectionStore.getState().selectedIds).toEqual([
			groupId,
		]);
	});

	it("ungroupSelection emits node.ungroup and selects the lifted children", () => {
		const { h, actions } = makeActionsHarness();
		h.studioCtx.selectionStore.getState().setSelection(["g"]);
		const lifted = actions.ungroupSelection();
		expect(lifted).toEqual(["d"]);
		expect(h.commits.map((c) => c.type)).toEqual(["node.ungroup"]);
		expect(h.studioCtx.selectionStore.getState().selectedIds).toEqual(["d"]);
	});

	it("alignSelection('left') moves nodes to the min-left edge as one batch", () => {
		const { h, actions } = makeActionsHarness();
		h.studioCtx.selectionStore.getState().setSelection(["a", "b"]);
		actions.alignSelection("left");
		expect(h.studioCtx.commitBatch).toHaveBeenCalledTimes(1);
		const xs = h.commits.map((c) => (c as CanvasNodeMoveCommand).to.x);
		expect(xs).toEqual([0, 0]);
	});

	it("distributeSelection('x') evens gaps as one batch (locked node excluded)", () => {
		const { h, actions } = makeActionsHarness();
		// c is locked → align-actions filters it; a, b alone are < 3 → no-op.
		h.studioCtx.selectionStore.getState().setSelection(["a", "b", "c"]);
		actions.distributeSelection("x");
		expect(h.commits).toHaveLength(0);
	});
});

describe("useCanvasActions", () => {
	function Probe({
		capture,
	}: {
		capture: (actions: CanvasEditorActions) => void;
	}) {
		capture(useCanvasActions());
		return null;
	}

	it("returns a stable actions object wired to the live context", () => {
		const h = makeHarness({ ir: fixtureIR() });
		const seen: CanvasEditorActions[] = [];
		// Fresh element per render — reusing one element reference lets React
		// bail out of the re-render entirely.
		const ui = () => (
			<CanvasStudioContext.Provider value={h.studioCtx}>
				<Probe capture={(a) => seen.push(a)} />
			</CanvasStudioContext.Provider>
		);
		const { rerender } = render(ui());
		rerender(ui());
		expect(seen.length).toBeGreaterThanOrEqual(2);
		// Identity is stable across re-renders (PRD 0012 §13.3).
		expect(seen[0]).toBe(seen[1]);

		// The hook's actions operate on live store state at call time.
		h.studioCtx.selectionStore.getState().setSelection(["a", "b"]);
		seen[0]?.deleteSelection();
		expect(h.commits.map((c) => c.type)).toEqual([
			"node.delete",
			"node.delete",
		]);
		expect(h.studioCtx.selectionStore.getState().selectedIds).toHaveLength(0);
	});
});
