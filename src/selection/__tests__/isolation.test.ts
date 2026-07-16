import {
	type CanvasIR,
	createCanvasIR,
	createGroup,
	createPage,
	createRect,
} from "@anvilkit/canvas-core";
import { describe, expect, it } from "vitest";
import { createIsolationStore } from "@/stores/isolation-store.js";
import { makeHarness } from "@/tools/__tests__/_tool-test-helpers.js";
import { cancelImpl } from "../../actions/cancel-action.js";
import {
	computeDimmedIds,
	enterIsolationImpl,
	isolationScopeChildren,
	progressiveSelectAllImpl,
	validateIsolationPath,
} from "../isolation.js";

/**
 * p1 top level: rect `a`, group `g1` [ rect `b`, group `g2` [ rect `c` ] ],
 * locked rect `locked`.
 */
function makeIR(): CanvasIR {
	const page = createPage({
		id: "p1",
		root: createGroup({
			id: "p1-root",
			children: [
				createRect({ id: "a", bounds: { width: 10, height: 10 } }),
				createGroup({
					id: "g1",
					children: [
						createRect({ id: "b", bounds: { width: 10, height: 10 } }),
						createGroup({
							id: "g2",
							children: [
								createRect({ id: "c", bounds: { width: 10, height: 10 } }),
							],
						}),
					],
				}),
				{
					...createRect({ id: "locked", bounds: { width: 10, height: 10 } }),
					locked: true,
				},
			],
		}),
	});
	return createCanvasIR({ id: "doc", pages: [page] });
}

function harnessWithIsolation() {
	const h = makeHarness({ ir: makeIR() });
	const isolationStore = createIsolationStore();
	const studioCtx = { ...h.studioCtx, isolationStore };
	return { h, isolationStore, studioCtx };
}

describe("isolation helpers (C-09, FR-055)", () => {
	it("validates paths and trims broken tails", () => {
		const page = makeIR().pages[0];
		if (!page) throw new Error("no page");
		expect(validateIsolationPath(page, ["g1", "g2"])).toEqual(["g1", "g2"]);
		expect(validateIsolationPath(page, ["g1", "missing"])).toEqual(["g1"]);
		expect(validateIsolationPath(page, ["a"])).toEqual([]); // not a container
	});

	it("scopes children to the innermost container", () => {
		const page = makeIR().pages[0];
		if (!page) throw new Error("no page");
		expect(isolationScopeChildren(page, []).map((n) => n.id)).toEqual([
			"a",
			"g1",
			"locked",
		]);
		expect(isolationScopeChildren(page, ["g1"]).map((n) => n.id)).toEqual([
			"b",
			"g2",
		]);
		expect(isolationScopeChildren(page, ["g1", "g2"]).map((n) => n.id)).toEqual(
			["c"],
		);
	});

	it("dims off-path siblings at every level; innermost content stays live", () => {
		const page = makeIR().pages[0];
		if (!page) throw new Error("no page");
		expect([...computeDimmedIds(page, ["g1"])].sort()).toEqual(["a", "locked"]);
		expect([...computeDimmedIds(page, ["g1", "g2"])].sort()).toEqual([
			"a",
			"b",
			"locked",
		]);
		expect(computeDimmedIds(page, []).size).toBe(0);
	});

	it("enterIsolationImpl enters containers only and drops them from selection", () => {
		const { isolationStore, studioCtx } = harnessWithIsolation();
		studioCtx.selectionStore.getState().setSelection(["g1"]);
		expect(enterIsolationImpl(studioCtx, "a")).toBe(false);
		expect(enterIsolationImpl(studioCtx, "g1")).toBe(true);
		expect(isolationStore.getState().path).toEqual(["g1"]);
		expect(studioCtx.selectionStore.getState().selectedIds).toEqual([]);
	});
});

describe("progressive select-all (FR-190)", () => {
	it("selects the scope's unlocked nodes, then expands outward on repeat", () => {
		const { isolationStore, studioCtx } = harnessWithIsolation();
		isolationStore.getState().enter("g1");
		isolationStore.getState().enter("g2");
		progressiveSelectAllImpl(studioCtx);
		expect(studioCtx.selectionStore.getState().selectedIds).toEqual(["c"]);
		// Second invocation: scope fully selected → exit one level, select there.
		progressiveSelectAllImpl(studioCtx);
		expect(isolationStore.getState().path).toEqual(["g1"]);
		expect(studioCtx.selectionStore.getState().selectedIds.sort()).toEqual([
			"b",
			"g2",
		]);
		// Third: back to page top level, locked node skipped (FR-024 posture).
		progressiveSelectAllImpl(studioCtx);
		expect(isolationStore.getState().path).toEqual([]);
		expect(studioCtx.selectionStore.getState().selectedIds.sort()).toEqual([
			"a",
			"g1",
		]);
	});

	it("without isolation it selects the page top level and stays there", () => {
		const { studioCtx } = harnessWithIsolation();
		progressiveSelectAllImpl(studioCtx);
		progressiveSelectAllImpl(studioCtx);
		expect(studioCtx.selectionStore.getState().selectedIds.sort()).toEqual([
			"a",
			"g1",
		]);
	});
});

describe("Escape precedence (FR-055 step)", () => {
	it("exits one isolation level after interaction cancels, before tool/selection", () => {
		const { isolationStore, studioCtx } = harnessWithIsolation();
		isolationStore.getState().enter("g1");
		isolationStore.getState().enter("g2");
		studioCtx.selectionStore.getState().setSelection(["c"]);
		expect(cancelImpl(studioCtx)).toBe("isolation");
		expect(isolationStore.getState().path).toEqual(["g1"]);
		expect(cancelImpl(studioCtx)).toBe("isolation");
		expect(isolationStore.getState().path).toEqual([]);
		// Only then the classic steps run.
		expect(cancelImpl(studioCtx)).toBe("selection");
	});

	it("a pending draft still cancels before isolation", () => {
		const { isolationStore, studioCtx } = harnessWithIsolation();
		isolationStore.getState().enter("g1");
		studioCtx.draftStore.getState().setDraft({
			type: "marquee",
			startX: 0,
			startY: 0,
			currentX: 5,
			currentY: 5,
		});
		expect(cancelImpl(studioCtx)).toBe("draft");
		expect(isolationStore.getState().path).toEqual(["g1"]);
	});
});
