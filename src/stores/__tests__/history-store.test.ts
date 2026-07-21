import {
	applyCommand,
	type CanvasCommand,
	type CanvasIR,
	type CanvasNodeMoveCommand,
	createCanvasIR,
	createGroup,
	createPage,
	createRect,
} from "@anvilkit/canvas-core";
import { beforeEach, describe, expect, it } from "vitest";
import {
	type CommandApplyFn,
	createHistoryStore,
	DEFAULT_HISTORY_LIMIT,
} from "../history-store.js";

const FIXED_TS = "2026-05-20T00:00:00.000Z";
const now = () => FIXED_TS;

function fixtureIR(): CanvasIR {
	const rect = createRect({
		id: "rectA",
		bounds: { width: 100, height: 50 },
		fill: "#f00",
	});
	const page = createPage({ id: "page-1" });
	page.root = createGroup({
		id: "page-1-root",
		bounds: page.root.bounds,
		children: [rect],
	});
	return createCanvasIR({ id: "ir-1", pages: [page], now });
}

function snapshot(ir: CanvasIR): string {
	return JSON.stringify(ir);
}

function moveRectA(to: { x: number; y: number }): CanvasNodeMoveCommand {
	return {
		type: "node.move",
		nodeId: "rectA",
		from: { x: 0, y: 0 },
		to,
	};
}

function moveRect(
	id: string,
	to: { x: number; y: number },
): CanvasNodeMoveCommand {
	return { type: "node.move", nodeId: id, from: { x: 0, y: 0 }, to };
}

function fixtureIR2(): CanvasIR {
	const a = createRect({ id: "rectA", bounds: { width: 100, height: 50 } });
	const b = createRect({ id: "rectB", bounds: { width: 80, height: 40 } });
	const page = createPage({ id: "page-1" });
	page.root = createGroup({
		id: "page-1-root",
		bounds: page.root.bounds,
		children: [a, b],
	});
	return createCanvasIR({ id: "ir-1", pages: [page], now });
}

function nodeX(ir: CanvasIR, id: string): number | undefined {
	return ir.pages[0]?.root.children.find((c) => c.id === id)?.transform.x;
}

describe("createHistoryStore — defaults", () => {
	it("has empty past and future, canUndo/canRedo false", () => {
		const store = createHistoryStore({ now });
		const state = store.getState();
		expect(state.past).toEqual([]);
		expect(state.future).toEqual([]);
		expect(state.canUndo()).toBe(false);
		expect(state.canRedo()).toBe(false);
		expect(state.limit).toBe(DEFAULT_HISTORY_LIMIT);
	});
});

describe("createHistoryStore — commit", () => {
	let ir: CanvasIR;
	beforeEach(() => {
		ir = fixtureIR();
	});

	it("returns a new IR, pushes inverse to past, clears future", () => {
		const store = createHistoryStore({ now });
		const after = store.getState().commit(ir, moveRectA({ x: 50, y: 0 }));
		expect(after).not.toBe(ir);
		const s = store.getState();
		expect(s.past).toHaveLength(1);
		expect(s.future).toEqual([]);
		expect(s.canUndo()).toBe(true);
		expect(s.canRedo()).toBe(false);
	});

	it("chains across multiple commits", () => {
		const store = createHistoryStore({ now });
		const after1 = store.getState().commit(ir, moveRectA({ x: 10, y: 0 }));
		const after2 = store.getState().commit(after1, moveRectA({ x: 20, y: 0 }));
		expect(store.getState().past).toHaveLength(2);
		expect(snapshot(after2)).not.toBe(snapshot(after1));
	});

	it("clears future when a new commit follows an undo", () => {
		const store = createHistoryStore({ now });
		const after1 = store.getState().commit(ir, moveRectA({ x: 10, y: 0 }));
		const afterUndo = store.getState().undo(after1);
		expect(store.getState().future).toHaveLength(1);
		store.getState().commit(afterUndo, moveRectA({ x: 99, y: 0 }));
		expect(store.getState().future).toEqual([]);
	});
});

describe("createHistoryStore — undo / redo", () => {
	let ir: CanvasIR;
	beforeEach(() => {
		ir = fixtureIR();
	});

	it("undo restores the pre-commit IR", () => {
		const store = createHistoryStore({ now });
		const before = snapshot(ir);
		const after = store.getState().commit(ir, moveRectA({ x: 50, y: 0 }));
		const undone = store.getState().undo(after);
		expect(snapshot(undone)).toBe(before);
		expect(store.getState().canUndo()).toBe(false);
		expect(store.getState().canRedo()).toBe(true);
	});

	it("undo then redo returns to the post-commit IR", () => {
		const store = createHistoryStore({ now });
		const after = store.getState().commit(ir, moveRectA({ x: 50, y: 0 }));
		const undone = store.getState().undo(after);
		const redone = store.getState().redo(undone);
		expect(snapshot(redone)).toBe(snapshot(after));
		expect(store.getState().canUndo()).toBe(true);
		expect(store.getState().canRedo()).toBe(false);
	});

	it("two commits then undo+undo+redo+redo walks the stack", () => {
		const store = createHistoryStore({ now });
		const original = snapshot(ir);
		const a1 = store.getState().commit(ir, moveRectA({ x: 10, y: 0 }));
		const a2 = store.getState().commit(a1, moveRectA({ x: 20, y: 0 }));
		const u1 = store.getState().undo(a2);
		expect(snapshot(u1)).toBe(snapshot(a1));
		const u2 = store.getState().undo(u1);
		expect(snapshot(u2)).toBe(original);
		const r1 = store.getState().redo(u2);
		expect(snapshot(r1)).toBe(snapshot(a1));
		const r2 = store.getState().redo(r1);
		expect(snapshot(r2)).toBe(snapshot(a2));
	});

	it("undo on empty past returns the input IR unchanged (by reference)", () => {
		const store = createHistoryStore({ now });
		const result = store.getState().undo(ir);
		expect(result).toBe(ir);
		expect(store.getState().past).toEqual([]);
	});

	it("redo on empty future returns the input IR unchanged (by reference)", () => {
		const store = createHistoryStore({ now });
		const result = store.getState().redo(ir);
		expect(result).toBe(ir);
		expect(store.getState().future).toEqual([]);
	});
});

describe("createHistoryStore — stale inverse safety (E-20)", () => {
	/** Delegates to the real `applyCommand`, except the Nth call throws —
	 *  simulating a stored inverse that references a node a remote peer has
	 *  since deleted. */
	function flakyApplyOnCall(n: number): CommandApplyFn {
		let calls = 0;
		return (irArg, cmd, opts) => {
			calls += 1;
			if (calls === n) throw new Error("simulated stale inverse");
			return applyCommand(irArg, cmd as CanvasCommand, opts);
		};
	}

	it("undo drops a throwing top entry and returns ir unchanged instead of throwing", () => {
		const ir = fixtureIR();
		const store = createHistoryStore({ now, apply: flakyApplyOnCall(3) });
		const a1 = store.getState().commit(ir, moveRectA({ x: 10, y: 0 })); // call 1
		const a2 = store.getState().commit(a1, moveRectA({ x: 20, y: 0 })); // call 2
		expect(store.getState().past).toHaveLength(2);

		const result = store.getState().undo(a2); // call 3 -> throws, caught
		expect(result).toBe(a2);
		expect(store.getState().past).toHaveLength(1);
		expect(store.getState().canUndo()).toBe(true);

		// The next-older entry is intact and undoes normally.
		const undone = store.getState().undo(result);
		expect(nodeX(undone, "rectA")).toBe(0);
	});

	it("redo drops a throwing top future entry and returns ir unchanged instead of throwing", () => {
		const ir = fixtureIR();
		const store = createHistoryStore({ now, apply: flakyApplyOnCall(3) });
		const a1 = store.getState().commit(ir, moveRectA({ x: 10, y: 0 })); // call 1
		const undone = store.getState().undo(a1); // call 2
		expect(store.getState().future).toHaveLength(1);

		const result = store.getState().redo(undone); // call 3 -> throws, caught
		expect(result).toBe(undone);
		expect(store.getState().future).toHaveLength(0);
		expect(store.getState().canRedo()).toBe(false);
	});
});

describe("createHistoryStore — reset", () => {
	it("empties both stacks", () => {
		const store = createHistoryStore({ now });
		const ir = fixtureIR();
		const after = store.getState().commit(ir, moveRectA({ x: 5, y: 0 }));
		store.getState().undo(after);
		expect(store.getState().past).toHaveLength(0);
		expect(store.getState().future).toHaveLength(1);
		store.getState().reset();
		expect(store.getState().past).toEqual([]);
		expect(store.getState().future).toEqual([]);
		expect(store.getState().canUndo()).toBe(false);
		expect(store.getState().canRedo()).toBe(false);
	});
});

describe("createHistoryStore — limit overflow", () => {
	it("drops the oldest inverse when past exceeds limit", () => {
		const store = createHistoryStore({ now, limit: 3 });
		let ir = fixtureIR();
		ir = store.getState().commit(ir, moveRectA({ x: 1, y: 0 }));
		ir = store.getState().commit(ir, moveRectA({ x: 2, y: 0 }));
		ir = store.getState().commit(ir, moveRectA({ x: 3, y: 0 }));
		ir = store.getState().commit(ir, moveRectA({ x: 4, y: 0 }));
		const state = store.getState();
		expect(state.past).toHaveLength(3);
		// The first inverse (which would have undone the x:1 commit) is gone.
		// Top of past is the inverse of x:4 → undoing it should set x back to 3.
		const undone = state.undo(ir);
		// rectA.transform.x should now be 3 (the x:3 commit's value).
		const rect = undone.pages[0]?.root.children[0];
		expect(rect?.transform.x).toBe(3);
	});
});

describe("createHistoryStore — PRD §9.2 scenario 3", () => {
	it("commit(move 100px) then undo() restores the original IR", () => {
		const store = createHistoryStore({ now });
		const ir = fixtureIR();
		const before = snapshot(ir);
		const after = store.getState().commit(ir, moveRectA({ x: 100, y: 0 }));
		const restored = store.getState().undo(after);
		expect(snapshot(restored)).toBe(before);
	});
});

describe("createHistoryStore — commitBatch", () => {
	it("records a multi-command gesture as ONE undo entry", () => {
		const store = createHistoryStore({ now });
		let ir = fixtureIR2();
		ir = store
			.getState()
			.commitBatch(ir, [
				moveRect("rectA", { x: 10, y: 0 }),
				moveRect("rectB", { x: 20, y: 0 }),
			]);
		expect(store.getState().past).toHaveLength(1);
		expect(nodeX(ir, "rectA")).toBe(10);
		expect(nodeX(ir, "rectB")).toBe(20);

		const undone = store.getState().undo(ir);
		expect(store.getState().past).toHaveLength(0);
		expect(nodeX(undone, "rectA")).toBe(0);
		expect(nodeX(undone, "rectB")).toBe(0);
	});

	it("redo restores the whole batch", () => {
		const store = createHistoryStore({ now });
		let ir = fixtureIR2();
		ir = store
			.getState()
			.commitBatch(ir, [
				moveRect("rectA", { x: 10, y: 0 }),
				moveRect("rectB", { x: 20, y: 0 }),
			]);
		const undone = store.getState().undo(ir);
		const redone = store.getState().redo(undone);
		expect(nodeX(redone, "rectA")).toBe(10);
		expect(nodeX(redone, "rectB")).toBe(20);
	});

	it("empty batch is a no-op and records nothing", () => {
		const store = createHistoryStore({ now });
		const ir = fixtureIR2();
		const after = store.getState().commitBatch(ir, []);
		expect(after).toBe(ir);
		expect(store.getState().past).toEqual([]);
	});
});

describe("createHistoryStore — commitCoalesced", () => {
	it("collapses a same-key burst within the window into one undo entry", () => {
		let clock = 0;
		const store = createHistoryStore({ now, nowMs: () => clock });
		let ir = fixtureIR();
		ir = store
			.getState()
			.commitCoalesced(ir, moveRectA({ x: 1, y: 0 }), "m:rectA");
		clock = 100;
		ir = store
			.getState()
			.commitCoalesced(ir, moveRectA({ x: 2, y: 0 }), "m:rectA");
		clock = 200;
		ir = store
			.getState()
			.commitCoalesced(ir, moveRectA({ x: 3, y: 0 }), "m:rectA");

		expect(store.getState().past).toHaveLength(1);
		expect(nodeX(ir, "rectA")).toBe(3);
		const undone = store.getState().undo(ir);
		expect(nodeX(undone, "rectA")).toBe(0); // restores pre-burst
	});

	it("redo after a coalesced undo restores the full burst end state", () => {
		let clock = 0;
		const store = createHistoryStore({ now, nowMs: () => clock });
		let ir = fixtureIR();
		ir = store
			.getState()
			.commitCoalesced(ir, moveRectA({ x: 1, y: 0 }), "m:rectA");
		clock = 100;
		ir = store
			.getState()
			.commitCoalesced(ir, moveRectA({ x: 5, y: 0 }), "m:rectA");
		const undone = store.getState().undo(ir);
		expect(nodeX(undone, "rectA")).toBe(0);
		const redone = store.getState().redo(undone);
		expect(nodeX(redone, "rectA")).toBe(5);
	});

	it("does not coalesce across different merge keys", () => {
		let clock = 0;
		const store = createHistoryStore({ now, nowMs: () => clock });
		let ir = fixtureIR();
		ir = store
			.getState()
			.commitCoalesced(ir, moveRectA({ x: 1, y: 0 }), "m:rectA");
		clock = 10;
		ir = store
			.getState()
			.commitCoalesced(ir, moveRectA({ x: 2, y: 0 }), "m:rectB");
		expect(store.getState().past).toHaveLength(2);
	});

	it("does not coalesce once the merge window elapses", () => {
		let clock = 0;
		const store = createHistoryStore({
			now,
			nowMs: () => clock,
			mergeWindowMs: 400,
		});
		let ir = fixtureIR();
		ir = store
			.getState()
			.commitCoalesced(ir, moveRectA({ x: 1, y: 0 }), "m:rectA");
		clock = 1000;
		ir = store
			.getState()
			.commitCoalesced(ir, moveRectA({ x: 2, y: 0 }), "m:rectA");
		expect(store.getState().past).toHaveLength(2);
	});

	it("a plain commit breaks the coalescing run", () => {
		let clock = 0;
		const store = createHistoryStore({ now, nowMs: () => clock });
		let ir = fixtureIR();
		ir = store
			.getState()
			.commitCoalesced(ir, moveRectA({ x: 1, y: 0 }), "m:rectA");
		clock = 10;
		ir = store.getState().commit(ir, moveRectA({ x: 2, y: 0 }));
		clock = 20;
		ir = store
			.getState()
			.commitCoalesced(ir, moveRectA({ x: 3, y: 0 }), "m:rectA");
		expect(store.getState().past).toHaveLength(3);
	});
});

describe("createHistoryStore — independent instances", () => {
	it("two stores do not share state", () => {
		const s1 = createHistoryStore({ now });
		const s2 = createHistoryStore({ now });
		const ir = fixtureIR();
		s1.getState().commit(ir, moveRectA({ x: 1, y: 0 }));
		expect(s1.getState().past).toHaveLength(1);
		expect(s2.getState().past).toEqual([]);
	});
});
