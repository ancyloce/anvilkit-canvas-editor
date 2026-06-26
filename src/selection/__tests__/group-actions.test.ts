import {
	type CanvasIR,
	type CanvasNodeGroupCommand,
	type CanvasNodeUngroupCommand,
	createCanvasIR,
	createGroup,
	createPage,
	createRect,
} from "@anvilkit/canvas-core";
import { describe, expect, it } from "vitest";
import { makeHarness } from "@/tools/__tests__/_tool-test-helpers.js";
import {
	canGroupSelection,
	canUngroupSelection,
	groupSelection,
	ungroupSelection,
} from "../group-actions.js";

const now = () => "2026-05-20T00:00:00.000Z";

const rect = (id: string) =>
	createRect({ id, bounds: { width: 10, height: 10 } });

/** root: [a, b, c, g(=[x, y])] on page "p1". */
function fixtureIR(): CanvasIR {
	const page = createPage({ id: "p1" });
	page.root = createGroup({
		id: "root",
		bounds: page.root.bounds,
		children: [
			rect("a"),
			rect("b"),
			rect("c"),
			createGroup({
				id: "g",
				bounds: { width: 20, height: 20 },
				children: [rect("x"), rect("y")],
			}),
		],
	});
	return createCanvasIR({ id: "ir", pages: [page], now });
}

describe("canGroupSelection", () => {
	const ir = fixtureIR();
	it("requires at least two nodes", () => {
		expect(canGroupSelection(ir, [])).toBe(false);
		expect(canGroupSelection(ir, ["a"])).toBe(false);
	});
	it("is true for siblings sharing a parent", () => {
		expect(canGroupSelection(ir, ["a", "c"])).toBe(true);
		expect(canGroupSelection(ir, ["x", "y"])).toBe(true);
	});
	it("is false when nodes span different parents", () => {
		expect(canGroupSelection(ir, ["a", "x"])).toBe(false);
	});
	it("is false for unknown ids", () => {
		expect(canGroupSelection(ir, ["a", "ghost"])).toBe(false);
	});
});

describe("canUngroupSelection", () => {
	const ir = fixtureIR();
	it("is true when a non-root group is selected", () => {
		expect(canUngroupSelection(ir, ["g"])).toBe(true);
		expect(canUngroupSelection(ir, ["a", "g"])).toBe(true);
	});
	it("is false for leaf-only or root-only selections", () => {
		expect(canUngroupSelection(ir, ["a"])).toBe(false);
		expect(canUngroupSelection(ir, ["root"])).toBe(false);
		expect(canUngroupSelection(ir, [])).toBe(false);
	});
});

describe("groupSelection", () => {
	it("dispatches node.group for the selection and selects the new group", () => {
		const h = makeHarness({ ir: fixtureIR() });
		h.studioCtx.selectionStore.getState().setSelection(["a", "b"]);
		const groupId = groupSelection(h.studioCtx);
		expect(groupId).not.toBeNull();
		expect(h.commits).toHaveLength(1);
		const cmd = h.commits[0] as CanvasNodeGroupCommand;
		expect(cmd.type).toBe("node.group");
		expect(cmd.pageId).toBe("p1");
		expect(cmd.childIds).toEqual(["a", "b"]);
		expect(cmd.groupId).toBe(groupId);
		expect(h.studioCtx.selectionStore.getState().selectedIds).toEqual([
			groupId,
		]);
	});

	it("is a no-op when the selection cannot be grouped", () => {
		const h = makeHarness({ ir: fixtureIR() });
		h.studioCtx.selectionStore.getState().setSelection(["a", "x"]);
		expect(groupSelection(h.studioCtx)).toBeNull();
		expect(h.commits).toHaveLength(0);
	});
});

describe("ungroupSelection", () => {
	it("dispatches node.ungroup and selects the lifted children", () => {
		const h = makeHarness({ ir: fixtureIR() });
		h.studioCtx.selectionStore.getState().setSelection(["g"]);
		const lifted = ungroupSelection(h.studioCtx);
		expect(lifted).toEqual(["x", "y"]);
		expect(h.commits).toHaveLength(1);
		const cmd = h.commits[0] as CanvasNodeUngroupCommand;
		expect(cmd.type).toBe("node.ungroup");
		expect(cmd.groupId).toBe("g");
		expect(h.studioCtx.selectionStore.getState().selectedIds).toEqual([
			"x",
			"y",
		]);
	});

	it("ignores selected non-group nodes", () => {
		const h = makeHarness({ ir: fixtureIR() });
		h.studioCtx.selectionStore.getState().setSelection(["a"]);
		expect(ungroupSelection(h.studioCtx)).toEqual([]);
		expect(h.commits).toHaveLength(0);
	});
});
