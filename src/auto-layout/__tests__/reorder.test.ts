import type { CanvasCommand } from "@anvilkit/canvas-core";
import { describe, expect, it } from "vitest";
import type { FlowChildRect } from "../reorder.js";
import { computeInsertionIndex, reorderCommandsTo } from "../reorder.js";

function rect(id: string, min: number, max: number, cross = 0): FlowChildRect {
	return {
		id,
		footprint: { minX: min, minY: cross, maxX: max, maxY: cross + 10 },
	};
}

function vrect(id: string, min: number, max: number, cross = 0): FlowChildRect {
	return {
		id,
		footprint: { minX: cross, minY: min, maxX: cross + 10, maxY: max },
	};
}

describe("computeInsertionIndex", () => {
	// Midpoints: a=10, b=30, c=50.
	const horizontal = [rect("a", 0, 20), rect("b", 20, 40), rect("c", 40, 60)];

	it("inserts before the first child when the pointer precedes every midpoint", () => {
		expect(
			computeInsertionIndex(horizontal, "horizontal", { x: 5, y: 0 }),
		).toBe(0);
	});

	it("counts midpoints strictly before the pointer", () => {
		expect(
			computeInsertionIndex(horizontal, "horizontal", { x: 20, y: 0 }),
		).toBe(1);
		expect(
			computeInsertionIndex(horizontal, "horizontal", { x: 40, y: 0 }),
		).toBe(2);
	});

	it("appends when the pointer passes every midpoint", () => {
		expect(
			computeInsertionIndex(horizontal, "horizontal", { x: 60, y: 0 }),
		).toBe(3);
	});

	it("a pointer exactly on a midpoint inserts before that child", () => {
		expect(
			computeInsertionIndex(horizontal, "horizontal", { x: 30, y: 0 }),
		).toBe(1);
	});

	it("uses the y axis for vertical layouts and ignores x", () => {
		const vertical = [vrect("a", 0, 20), vrect("b", 20, 40)];
		expect(computeInsertionIndex(vertical, "vertical", { x: 999, y: 5 })).toBe(
			0,
		);
		expect(
			computeInsertionIndex(vertical, "vertical", { x: -999, y: 35 }),
		).toBe(2);
	});

	it("excludes dragged children from the slot count", () => {
		// Dragging "b": remaining midpoints are a=10, c=50.
		const exclude = new Set(["b"]);
		expect(
			computeInsertionIndex(horizontal, "horizontal", { x: 25, y: 0 }, exclude),
		).toBe(1);
		expect(
			computeInsertionIndex(horizontal, "horizontal", { x: 55, y: 0 }, exclude),
		).toBe(2);
		expect(
			computeInsertionIndex(horizontal, "horizontal", { x: 5, y: 0 }, exclude),
		).toBe(0);
	});

	it("returns 0 for an empty child list", () => {
		expect(computeInsertionIndex([], "horizontal", { x: 10, y: 10 })).toBe(0);
	});
});

describe("reorderCommandsTo", () => {
	// Sequential remove-then-insert, exactly how `node.reorder` applies.
	function applySequentially(
		order: readonly string[],
		cmds: readonly CanvasCommand[],
	): string[] {
		const work = [...order];
		for (const cmd of cmds) {
			if (cmd.type !== "node.reorder") {
				throw new Error(`unexpected command: ${cmd.type}`);
			}
			const from = work.indexOf(cmd.nodeId);
			if (from < 0) throw new Error(`unknown node: ${cmd.nodeId}`);
			work.splice(from, 1);
			work.splice(cmd.toIndex, 0, cmd.nodeId);
		}
		return work;
	}

	it("returns no commands when the order already matches", () => {
		expect(reorderCommandsTo(["a", "b", "c"], ["a", "b", "c"])).toEqual([]);
	});

	it("reaches a trailing multi-block target under sequential application", () => {
		// Review 0022 P1-1 counterexample: dragging [r1, r3] to the end of
		// [r1, r2, r3, r4]. Naive per-node `drop.index + k` emission interleaves
		// to [r2, r1, r4, r3]; the mirrored emission must reach [r2, r4, r1, r3].
		const current = ["r1", "r2", "r3", "r4"];
		const target = ["r2", "r4", "r1", "r3"];
		const cmds = reorderCommandsTo(current, target);
		expect(cmds).toEqual([
			{ type: "node.reorder", nodeId: "r2", toIndex: 0 },
			{ type: "node.reorder", nodeId: "r4", toIndex: 1 },
		]);
		expect(applySequentially(current, cmds)).toEqual(target);
	});

	it("reaches a leading multi-block target under sequential application", () => {
		const current = ["a", "d1", "b", "d2"];
		const target = ["d1", "d2", "a", "b"];
		const cmds = reorderCommandsTo(current, target);
		expect(applySequentially(current, cmds)).toEqual(target);
	});

	it("reaches a full reversal under sequential application", () => {
		const current = ["a", "b", "c", "d"];
		const target = ["d", "c", "b", "a"];
		const cmds = reorderCommandsTo(current, target);
		expect(applySequentially(current, cmds)).toEqual(target);
	});

	it("ignores target ids missing from the current order", () => {
		const cmds = reorderCommandsTo(["a", "b"], ["ghost", "b", "a"]);
		expect(applySequentially(["a", "b"], cmds)).toEqual(["b", "a"]);
	});
});
