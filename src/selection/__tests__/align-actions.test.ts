import {
	type CanvasIR,
	type CanvasNodeMoveCommand,
	createCanvasIR,
	createGroup,
	createPage,
	createRect,
} from "@anvilkit/canvas-core";
import { describe, expect, it } from "vitest";
import { makeHarness } from "@/tools/__tests__/_tool-test-helpers.js";
import { alignSelection, distributeSelection } from "../align-actions.js";

function ir3(): CanvasIR {
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
			createRect({
				id: "c",
				transform: { x: 200 },
				bounds: { width: 50, height: 50 },
			}),
		],
	});
	return createCanvasIR({ id: "ir", pages: [page], now: () => "T" });
}

const toXs = (commits: readonly unknown[]): number[] =>
	commits.map((c) => (c as CanvasNodeMoveCommand).to.x);

describe("align-actions", () => {
	it("alignSelection 'left' moves every node to the min-left edge", () => {
		const h = makeHarness({ ir: ir3() });
		h.studioCtx.selectionStore.getState().setSelection(["a", "b", "c"]);
		alignSelection(h.studioCtx, "left");
		expect(toXs(h.commits)).toEqual([0, 0, 0]);
	});

	it("alignSelection is a no-op for fewer than 2 nodes", () => {
		const h = makeHarness({ ir: ir3() });
		h.studioCtx.selectionStore.getState().setSelection(["a"]);
		alignSelection(h.studioCtx, "left");
		expect(h.commits).toHaveLength(0);
	});

	it("distributeSelection 'x' evens out the gaps (ends fixed)", () => {
		const h = makeHarness({ ir: ir3() });
		h.studioCtx.selectionStore.getState().setSelection(["a", "b", "c"]);
		distributeSelection(h.studioCtx, "x");
		// a@0, c@200 fixed; widths 50 → gap (250-150)/2 = 50 → b lands at 100.
		expect(toXs(h.commits)).toEqual([0, 100, 200]);
	});

	it("distributeSelection is a no-op for fewer than 3 nodes", () => {
		const h = makeHarness({ ir: ir3() });
		h.studioCtx.selectionStore.getState().setSelection(["a", "b"]);
		distributeSelection(h.studioCtx, "x");
		expect(h.commits).toHaveLength(0);
	});
});
