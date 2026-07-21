import type { CanvasIR, CanvasNodeMoveCommand } from "@anvilkit/canvas-core";
import {
	createCanvasIR,
	createEllipse,
	createFrame,
	createGroup,
	createPage,
	createRect,
} from "@anvilkit/canvas-core";
import type Konva from "konva";
import { describe, expect, it, vi } from "vitest";
import { selectTool } from "../select-tool.js";
import { makeHarness, pointerEvent } from "./_tool-test-helpers.js";

const FIXED_TS = "2026-05-20T00:00:00.000Z";

function fixtureIR(): CanvasIR {
	const page = createPage({ id: "p1" });
	page.root = createGroup({
		id: "p1-root",
		bounds: page.root.bounds,
		children: [
			createRect({
				id: "rectA",
				bounds: { width: 100, height: 50 },
				transform: { x: 10, y: 20 },
			}),
			createRect({
				id: "rectB",
				bounds: { width: 80, height: 40 },
				transform: { x: 200, y: 300 },
			}),
		],
	});
	return createCanvasIR({ id: "ir-1", pages: [page], now: () => FIXED_TS });
}

function fakeKonvaNodeWithName(id: string): Konva.Node {
	return { name: () => id, getParent: () => null } as unknown as Konva.Node;
}

/**
 * A pointer target that originates on the selection Transformer: a resize/rotate
 * anchor (a `Konva.Rect`, no IR id) whose parent is the `Konva.Transformer`.
 * This is what `e.target` resolves to when the user grabs a transform handle.
 */
function fakeTransformerAnchorTarget(): Konva.Node {
	const transformer = {
		getClassName: () => "Transformer",
		name: () => "",
		getParent: () => null,
	} as unknown as Konva.Node;
	return {
		name: () => "rotater",
		getParent: () => transformer,
	} as unknown as Konva.Node;
}

function fakeStageWithNodes(
	positions: Record<string, { x: number; y: number }>,
): Konva.Stage {
	const positionFns = new Map<string, ReturnType<typeof vi.fn>>();
	for (const id of Object.keys(positions)) {
		positionFns.set(id, vi.fn());
	}
	return {
		// `findNodeById` (E-13) selects via a predicate, not a `.`-selector
		// string — match real Konva's `findOne(fn)` semantics here too.
		findOne: (selector: (node: { id(): string }) => boolean) => {
			for (const [id, positionFn] of positionFns) {
				const node = { id: () => id, position: positionFn };
				if (selector(node)) return node as unknown as Konva.Node;
			}
			return null;
		},
		_positionFns: positionFns,
	} as unknown as Konva.Stage;
}

describe("selectTool — click selection", () => {
	it("selects the clicked node when nothing is selected", () => {
		const h = makeHarness();
		h.ctx.getIR = () => fixtureIR();
		const e = pointerEvent(15, 25, { target: fakeKonvaNodeWithName("rectA") });
		selectTool.onPointerDown?.(e, h.ctx);
		expect(h.ctx.selectionStore.getState().selectedIds).toEqual(["rectA"]);
	});

	it("shift-click toggles selection", () => {
		const h = makeHarness();
		h.ctx.getIR = () => fixtureIR();
		// First select rectA.
		selectTool.onPointerDown?.(
			pointerEvent(15, 25, { target: fakeKonvaNodeWithName("rectA") }),
			h.ctx,
		);
		// Shift-click rectB → both selected.
		selectTool.onPointerDown?.(
			pointerEvent(210, 310, {
				shiftKey: true,
				target: fakeKonvaNodeWithName("rectB"),
			}),
			h.ctx,
		);
		expect(h.ctx.selectionStore.getState().selectedIds.sort()).toEqual([
			"rectA",
			"rectB",
		]);
		// Shift-click rectA again → only rectB remains.
		selectTool.onPointerDown?.(
			pointerEvent(15, 25, {
				shiftKey: true,
				target: fakeKonvaNodeWithName("rectA"),
			}),
			h.ctx,
		);
		expect(h.ctx.selectionStore.getState().selectedIds).toEqual(["rectB"]);
	});

	it("clicking empty stage clears selection (on pointerup, via degenerate marquee)", () => {
		const h = makeHarness();
		h.ctx.getIR = () => fixtureIR();
		h.ctx.selectionStore.getState().setSelection(["rectA"]);
		// Click with a target whose name() is empty (e.g. Stage/Layer).
		const emptyTarget = {
			name: () => "",
			getParent: () => null,
		} as unknown as Konva.Node;
		selectTool.onPointerDown?.(
			pointerEvent(500, 500, { target: emptyTarget }),
			h.ctx,
		);
		// Task 6: pointerdown on empty starts a marquee draft (preserves
		// selection so shift-click can still extend later). Click→pointerup
		// without drag is a degenerate marquee → clears selection.
		expect(h.ctx.selectionStore.getState().selectedIds).toEqual(["rectA"]);
		selectTool.onPointerUp?.(pointerEvent(500, 500), h.ctx);
		expect(h.ctx.selectionStore.getState().selectedIds).toEqual([]);
	});
});

describe("selectTool — Transformer handle gestures are not the select tool's", () => {
	it("ignores a pointerdown that lands on a Transformer handle (no phantom marquee)", () => {
		const h = makeHarness();
		h.ctx.getIR = () => fixtureIR();
		h.ctx.selectionStore.getState().setSelection(["rectA"]);
		// Grabbing a resize/rotate anchor must NOT start a draft — the
		// Transformer owns this gesture. Before the fix, findHitNodeId returned
		// null for the anchor and the tool started a marquee draft.
		selectTool.onPointerDown?.(
			pointerEvent(15, 25, { target: fakeTransformerAnchorTarget() }),
			h.ctx,
		);
		expect(h.ctx.draftStore.getState().draft).toBeNull();
		expect(h.ctx.selectionStore.getState().selectedIds).toEqual(["rectA"]);
	});

	it("keeps the selection through a transform gesture (down+move+up on a handle)", () => {
		const h = makeHarness();
		h.ctx.getIR = () => fixtureIR();
		h.ctx.selectionStore.getState().setSelection(["rectA"]);
		const target = fakeTransformerAnchorTarget();
		// Simulate the full pointer stream of a rotate: the Transformer drives the
		// node + commits via its own transformend; the select tool must stay out
		// of it. The phantom marquee's pointerup used to re-run setSelection over
		// the swept arc and intermittently drop rectA — the "lost rotation state".
		selectTool.onPointerDown?.(pointerEvent(15, 25, { target }), h.ctx);
		selectTool.onPointerMove?.(pointerEvent(40, 10, { target }), h.ctx);
		selectTool.onPointerUp?.(pointerEvent(60, 5, { target }), h.ctx);
		expect(h.ctx.selectionStore.getState().selectedIds).toEqual(["rectA"]);
		// And the select tool issued no node commands for the transform.
		expect(h.commits).toHaveLength(0);
	});
});

describe("selectTool — drag-to-move", () => {
	it("commits exactly one node.move command on pointerup (single-node MVP-7 case)", () => {
		const h = makeHarness();
		h.ctx.getIR = () => fixtureIR();
		h.ctx.stage = fakeStageWithNodes({ rectA: { x: 10, y: 20 } });
		const target = fakeKonvaNodeWithName("rectA");
		// pointerdown at (15, 25) — picks rectA, starts move draft.
		selectTool.onPointerDown?.(pointerEvent(15, 25, { target }), h.ctx);
		expect(h.ctx.draftStore.getState().draft?.type).toBe("move");
		// Drag through several intermediate positions — NO commits during move.
		for (let i = 0; i < 5; i++) {
			selectTool.onPointerMove?.(pointerEvent(15 + i * 10, 25), h.ctx);
		}
		expect(h.commits).toHaveLength(0);
		// pointerup at (75, 25) — total delta = (60, 0). Snap may shift if other
		// nodes are within threshold (rectB at x=200 is far) — should not snap.
		selectTool.onPointerUp?.(pointerEvent(75, 25), h.ctx);
		expect(h.commits).toHaveLength(1);
		const cmd = h.commits[0] as CanvasNodeMoveCommand;
		expect(cmd).toMatchObject({
			type: "node.move",
			nodeId: "rectA",
			from: { x: 10, y: 20 },
			to: { x: 70, y: 20 },
		});
		expect(h.ctx.draftStore.getState().draft).toBeNull();
	});

	it("grid-snaps the drop when snapToGridEnabled is on, even while the grid is HIDDEN (FR-112)", () => {
		const h = makeHarness();
		h.ctx.getIR = () => fixtureIR();
		h.ctx.stage = fakeStageWithNodes({ rectA: { x: 10, y: 20 } });
		const vs = h.ctx.viewportStore.getState();
		expect(vs.gridEnabled).toBe(false); // harness default: grid not drawn
		vs.setSnapToGridEnabled(true); // gridSize default 8
		const target = fakeKonvaNodeWithName("rectA");
		selectTool.onPointerDown?.(pointerEvent(15, 25, { target }), h.ctx);
		selectTool.onPointerUp?.(pointerEvent(75, 25), h.ctx);
		const cmd = h.commits[0] as CanvasNodeMoveCommand;
		// Candidate (70, 20) → nearest 8px multiples (72, 24).
		expect(cmd).toMatchObject({
			type: "node.move",
			nodeId: "rectA",
			to: { x: 72, y: 24 },
		});
	});

	it("showing the grid alone does NOT enable grid snap (FR-112 separation)", () => {
		const h = makeHarness();
		h.ctx.getIR = () => fixtureIR();
		h.ctx.stage = fakeStageWithNodes({ rectA: { x: 10, y: 20 } });
		const vs = h.ctx.viewportStore.getState();
		vs.setGridEnabled(true);
		expect(vs.snapToGridEnabled).toBe(false); // harness default
		const target = fakeKonvaNodeWithName("rectA");
		selectTool.onPointerDown?.(pointerEvent(15, 25, { target }), h.ctx);
		selectTool.onPointerUp?.(pointerEvent(75, 25), h.ctx);
		const cmd = h.commits[0] as CanvasNodeMoveCommand;
		expect(cmd.to).toEqual({ x: 70, y: 20 });
	});

	it("passes the store's snapThreshold to the snap engine (FR-112)", () => {
		// rectA's right edge lands 8px short of rectB's left edge (x=200): out of
		// reach for the default threshold (6), inside a raised threshold (12).
		const dragTo = (h: ReturnType<typeof makeHarness>): void => {
			const target = fakeKonvaNodeWithName("rectA");
			selectTool.onPointerDown?.(pointerEvent(15, 25, { target }), h.ctx);
			selectTool.onPointerUp?.(pointerEvent(97, 25), h.ctx);
		};

		const base = makeHarness();
		base.ctx.getIR = () => fixtureIR();
		base.ctx.stage = fakeStageWithNodes({ rectA: { x: 10, y: 20 } });
		dragTo(base);
		expect((base.commits[0] as CanvasNodeMoveCommand).to).toEqual({
			x: 92,
			y: 20,
		});

		const raised = makeHarness();
		raised.ctx.getIR = () => fixtureIR();
		raised.ctx.stage = fakeStageWithNodes({ rectA: { x: 10, y: 20 } });
		raised.ctx.viewportStore.getState().setSnapThreshold(12);
		dragTo(raised);
		expect((raised.commits[0] as CanvasNodeMoveCommand).to).toEqual({
			x: 100,
			y: 20,
		});
	});

	it("multi-select drag commits ONE batch (not per-node) on pointerup", () => {
		const h = makeHarness();
		h.ctx.getIR = () => fixtureIR();
		h.ctx.stage = fakeStageWithNodes({
			rectA: { x: 10, y: 20 },
			rectB: { x: 200, y: 300 },
		});
		h.ctx.selectionStore.getState().setSelection(["rectA", "rectB"]);
		const target = fakeKonvaNodeWithName("rectA");
		selectTool.onPointerDown?.(pointerEvent(15, 25, { target }), h.ctx);
		expect(h.ctx.draftStore.getState().draft?.type).toBe("move");
		for (let i = 0; i < 5; i++) {
			selectTool.onPointerMove?.(pointerEvent(15 + i * 10, 25), h.ctx);
		}
		selectTool.onPointerUp?.(pointerEvent(75, 25), h.ctx);
		// One batch for the whole gesture; per-node commit is NOT used.
		expect(h.ctx.commitBatch).toHaveBeenCalledTimes(1);
		expect(h.ctx.commit).not.toHaveBeenCalled();
		// The harness flattens the batch into `commits` → both moves are present.
		expect(h.commits).toHaveLength(2);
		expect(h.commits.map((c) => c.type)).toEqual(["node.move", "node.move"]);
	});

	it("ellipse move preview applies the center render offset so it tracks the cursor", () => {
		// Regression: Konva.Ellipse is centered at (x, y) but the IR transform is
		// the top-left. The live drag preview must add the half-bounds offset, or
		// the ellipse renders by its center where its top-left should go — drifting
		// up-left of the cursor during the drag and snapping back on release.
		const ellipseIR = (): CanvasIR => {
			const page = createPage({ id: "p1" });
			page.root = createGroup({
				id: "p1-root",
				bounds: page.root.bounds,
				children: [
					createEllipse({
						id: "ellA",
						bounds: { width: 100, height: 50 },
						transform: { x: 10, y: 20 },
					}),
				],
			});
			return createCanvasIR({
				id: "ir-ell",
				pages: [page],
				now: () => FIXED_TS,
			});
		};
		const h = makeHarness();
		h.ctx.getIR = ellipseIR;
		const stage = fakeStageWithNodes({ ellA: { x: 10, y: 20 } });
		h.ctx.stage = stage;
		selectTool.onPointerDown?.(
			pointerEvent(15, 25, { target: fakeKonvaNodeWithName("ellA") }),
			h.ctx,
		);
		expect(h.ctx.draftStore.getState().draft?.type).toBe("move");
		// Drag delta (60, 0). Preview = top-left(10,20) + delta(60,0) + half-bounds
		// offset(50,25) = (120, 45).
		selectTool.onPointerMove?.(pointerEvent(75, 25), h.ctx);
		const positionFn = (
			stage as unknown as {
				_positionFns: Map<string, ReturnType<typeof vi.fn>>;
			}
		)._positionFns.get("ellA");
		expect(positionFn).toHaveBeenLastCalledWith({ x: 120, y: 45 });
	});

	it("rect move preview uses no render offset (top-left == Konva position)", () => {
		const h = makeHarness();
		h.ctx.getIR = () => fixtureIR();
		const stage = fakeStageWithNodes({ rectA: { x: 10, y: 20 } });
		h.ctx.stage = stage;
		selectTool.onPointerDown?.(
			pointerEvent(15, 25, { target: fakeKonvaNodeWithName("rectA") }),
			h.ctx,
		);
		selectTool.onPointerMove?.(pointerEvent(75, 25), h.ctx);
		const positionFn = (
			stage as unknown as {
				_positionFns: Map<string, ReturnType<typeof vi.fn>>;
			}
		)._positionFns.get("rectA");
		// Delta (60, 0), zero offset → (70, 20).
		expect(positionFn).toHaveBeenLastCalledWith({ x: 70, y: 20 });
	});

	it("skips commit when drag is below MIN_MOVE_DISTANCE", () => {
		const h = makeHarness();
		h.ctx.getIR = () => fixtureIR();
		h.ctx.stage = fakeStageWithNodes({ rectA: { x: 10, y: 20 } });
		selectTool.onPointerDown?.(
			pointerEvent(15, 25, { target: fakeKonvaNodeWithName("rectA") }),
			h.ctx,
		);
		selectTool.onPointerUp?.(pointerEvent(15.2, 25.1), h.ctx);
		expect(h.commits).toHaveLength(0);
	});

	it("multi-node selection fires one commit per moved node", () => {
		const h = makeHarness();
		h.ctx.getIR = () => fixtureIR();
		h.ctx.stage = fakeStageWithNodes({
			rectA: { x: 10, y: 20 },
			rectB: { x: 200, y: 300 },
		});
		h.ctx.selectionStore.getState().setSelection(["rectA", "rectB"]);
		// Click rectA without shift — since rectA is already selected, drag
		// preserves multi-select.
		selectTool.onPointerDown?.(
			pointerEvent(15, 25, { target: fakeKonvaNodeWithName("rectA") }),
			h.ctx,
		);
		selectTool.onPointerUp?.(pointerEvent(115, 25), h.ctx);
		expect(h.commits).toHaveLength(2);
		const ids = h.commits
			.map((c) => (c as CanvasNodeMoveCommand).nodeId)
			.sort();
		expect(ids).toEqual(["rectA", "rectB"]);
	});

	it("onDeactivate clears draft + guides", () => {
		const h = makeHarness();
		h.ctx.getIR = () => fixtureIR();
		h.ctx.stage = fakeStageWithNodes({ rectA: { x: 10, y: 20 } });
		selectTool.onPointerDown?.(
			pointerEvent(15, 25, { target: fakeKonvaNodeWithName("rectA") }),
			h.ctx,
		);
		selectTool.onDeactivate?.(h.ctx);
		expect(h.ctx.draftStore.getState().draft).toBeNull();
	});
});

/**
 * A pointer target with no IR id of its own, whose parent carries `parentId` —
 * exactly the shape of a click landing on a frame's anonymous background Rect,
 * or on any child rendered inside a container Group.
 */
function fakeAnonymousChildOf(parentId: string): Konva.Node {
	const parent = {
		name: () => parentId,
		getParent: () => null,
	} as unknown as Konva.Node;
	return {
		name: () => "",
		getParent: () => parent,
	} as unknown as Konva.Node;
}

function frameIR(): CanvasIR {
	const page = createPage({ id: "p1" });
	page.root = createGroup({
		id: "p1-root",
		bounds: page.root.bounds,
		children: [
			createFrame({
				id: "frameA",
				bounds: { width: 200, height: 100 },
				transform: { x: 10, y: 20 },
				clip: true,
				background: "#0af",
				children: [
					createRect({ id: "inFrame", bounds: { width: 20, height: 20 } }),
				],
			}),
		],
	});
	return createCanvasIR({ id: "ir-1", pages: [page], now: () => FIXED_TS });
}

describe("selectTool — frame selection", () => {
	it("selects the frame when its background Rect is clicked", () => {
		const h = makeHarness();
		h.ctx.getIR = () => frameIR();
		// The backdrop is anonymous, so findHitNodeId walks up to the frame Group.
		selectTool.onPointerDown?.(
			pointerEvent(50, 50, { target: fakeAnonymousChildOf("frameA") }),
			h.ctx,
		);
		expect(h.ctx.selectionStore.getState().selectedIds).toEqual(["frameA"]);
	});

	it("selects the frame (not the child) when a node inside the frame is clicked", () => {
		const h = makeHarness();
		h.ctx.getIR = () => frameIR();
		// Children of a container are not top-level ids, so the walk-up resolves to
		// the frame — the same behaviour a group has. (Enter-frame is deferred.)
		selectTool.onPointerDown?.(
			pointerEvent(20, 30, { target: fakeAnonymousChildOf("frameA") }),
			h.ctx,
		);
		expect(h.ctx.selectionStore.getState().selectedIds).toEqual(["frameA"]);
	});

	it("marquee selects a frame by its own bounds", () => {
		const h = makeHarness();
		h.ctx.getIR = () => frameIR();
		selectTool.onPointerDown?.(
			pointerEvent(0, 0, {
				target: {
					name: () => "",
					getParent: () => null,
				} as unknown as Konva.Node,
			}),
			h.ctx,
		);
		selectTool.onPointerMove?.(pointerEvent(400, 400), h.ctx);
		selectTool.onPointerUp?.(pointerEvent(400, 400), h.ctx);
		expect(h.ctx.selectionStore.getState().selectedIds).toContain("frameA");
	});
});
