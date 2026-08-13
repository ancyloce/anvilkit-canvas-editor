import type { CanvasIR, CanvasNode } from "@anvilkit/canvas-core";
import {
	applyCommand,
	createCanvasIR,
	createFrame,
	createPage,
	createRect,
	findNode,
	insertNode,
} from "@anvilkit/canvas-core";
import type Konva from "konva";
import { describe, expect, it, vi } from "vitest";
import { createIsolationStore } from "@/stores/isolation-store.js";
import { createResolvedDocumentStore } from "@/stores/resolved-document-store.js";
import { createSceneStore } from "@/stores/scene-store.js";
import { selectTool } from "../select-tool.js";
import { makeHarness, pointerEvent } from "./_tool-test-helpers.js";

/**
 * T-M4-06 (TS-34, TS-35) — flow-insertion preview and drop commits. Backed by
 * a REAL resolved-document store: slots come from actual resolver footprints.
 *
 * Fixture: auto-layout frame f1 at page (100,100), 200×100, gap 10, children
 * r1/r2/r3 (40×20 each) → resolved local x = 0 / 50 / 100; a loose top-level
 * rect at (400,400).
 */

const LAYOUT = {
	version: 1,
	direction: "horizontal",
	padding: { top: 0, right: 0, bottom: 0, left: 0 },
	gap: 10,
	primaryAlign: "start",
	crossAlign: "start",
} as const;

function rect(id: string): CanvasNode {
	return createRect({ id, bounds: { width: 40, height: 20 } });
}

interface FixtureOptions {
	/** f1's flow children (defaults to r1/r2/r3; four 40-wide children still fit). */
	childIds?: readonly string[];
	/** Add a second auto-layout frame f2 at page (100,250) with children s1/s2. */
	secondFrame?: boolean;
}

function fixtureIR(opts?: FixtureOptions): CanvasIR {
	const frame: CanvasNode = {
		...createFrame({
			id: "f1",
			transform: { x: 100, y: 100 },
			bounds: { width: 200, height: 100 },
		}),
		autoLayout: LAYOUT,
		children: (opts?.childIds ?? ["r1", "r2", "r3"]).map(rect),
	} as CanvasNode;
	const page = createPage({ id: "p1" });
	let ir = createCanvasIR({ id: "doc", title: "t", pages: [page] });
	ir = insertNode(ir, { parentId: page.root.id, node: frame });
	if (opts?.secondFrame) {
		const second: CanvasNode = {
			...createFrame({
				id: "f2",
				transform: { x: 100, y: 250 },
				bounds: { width: 200, height: 100 },
			}),
			autoLayout: LAYOUT,
			children: [rect("s1"), rect("s2")],
		} as CanvasNode;
		ir = insertNode(ir, { parentId: page.root.id, node: second });
	}
	ir = insertNode(ir, {
		parentId: page.root.id,
		node: createRect({
			id: "loose",
			transform: { x: 400, y: 400 },
			bounds: { width: 40, height: 20 },
		}),
	});
	return ir;
}

function setup(
	opts?: {
		isolate?: boolean;
		/** Node ids to expose through `stage.findOne` with a `position` spy. */
		trackPositions?: readonly string[];
	} & FixtureOptions,
) {
	const ir = fixtureIR(opts);
	const h = makeHarness({ ir, pageId: "p1" });
	h.ctx.getIR = () => ir;
	const fieldPreviewStore = h.studioCtx.fieldPreviewStore;
	if (!fieldPreviewStore) throw new Error("harness lacks fieldPreviewStore");
	h.ctx.resolvedDocumentStore = createResolvedDocumentStore({
		sceneStore: createSceneStore({ initialIR: ir }),
		fieldPreviewStore,
	});
	// The pointer-move Konva mutation path looks nodes up via stage.findOne.
	// The default fake stage has none — a null lookup just skips the mutation —
	// but `trackPositions` installs nodes with a `position` spy so a test can
	// assert what the gesture left on the live Konva node.
	const positionFns = new Map<string, ReturnType<typeof vi.fn>>();
	if (opts?.trackPositions) {
		for (const id of opts.trackPositions) positionFns.set(id, vi.fn());
	}
	h.ctx.stage = {
		findOne: (selector: (node: { id(): string }) => boolean) => {
			for (const [id, position] of positionFns) {
				const node = { id: () => id, position };
				if (selector(node)) return node;
			}
			return null;
		},
	} as unknown as Konva.Stage;
	if (opts?.isolate) {
		const isolationStore = createIsolationStore();
		isolationStore.getState().enter("f1");
		h.ctx.isolationStore = isolationStore;
	}
	return Object.assign(h, { positionFns });
}

function target(id: string): Konva.Node {
	return { name: () => id, getParent: () => null } as unknown as Konva.Node;
}

function altPointerEvent(x: number, y: number) {
	const e = pointerEvent(x, y);
	(e as { evt: unknown }).evt = { shiftKey: false, altKey: true };
	return e;
}

function draft(h: ReturnType<typeof makeHarness>) {
	const d = h.ctx.draftStore.getState().draft;
	if (d?.type !== "move")
		throw new Error(`expected move draft, got ${d?.type}`);
	return d;
}

/**
 * The frame's child ids after applying every recorded commit sequentially to
 * the fixture IR — the semantic outcome of a drop, independent of WHICH
 * commands produced it (review 0022 P1-1 pinned exactly this disagreement
 * between emitted indices and their sequential application).
 */
function appliedChildIds(
	h: ReturnType<typeof makeHarness>,
	frameId: string,
): string[] {
	const applied = h.commits.reduce(
		(acc, cmd) => applyCommand(acc, cmd).ir,
		h.ctx.getIR(),
	);
	const found = findNode(applied, frameId);
	if (!found || found.node.type !== "frame")
		throw new Error(`frame ${frameId} missing after apply`);
	return found.node.children.map((c) => c.id);
}

describe("selectTool — auto-layout drop preview (TS-35)", () => {
	it("previews an insertion slot during moves and never commits", () => {
		const h = setup();
		selectTool.onPointerDown?.(
			pointerEvent(410, 410, { target: target("loose") }),
			h.ctx,
		);
		// Local (25,10) inside f1: between r1 (mid 20) and r2 (mid 70) → slot 1.
		selectTool.onPointerMove?.(pointerEvent(125, 110), h.ctx);
		expect(draft(h).layoutDrop).toMatchObject({
			frameId: "f1",
			index: 1,
			absolute: false,
		});
		// Indicator: midway between r1.max (40) and r2.min (50) → local x 45 →
		// page x 145, spanning the children's cross extent (page y 100..120).
		expect(draft(h).layoutDrop?.indicator).toEqual({
			x1: 145,
			y1: 100,
			x2: 145,
			y2: 120,
		});
		selectTool.onPointerMove?.(pointerEvent(126, 111), h.ctx);
		selectTool.onPointerMove?.(pointerEvent(127, 112), h.ctx);
		expect(h.ctx.commit).not.toHaveBeenCalled();
		expect(h.ctx.commitBatch).not.toHaveBeenCalled();
		expect(h.commits).toHaveLength(0);
	});

	it("clears the preview when the pointer leaves every layout frame", () => {
		const h = setup();
		selectTool.onPointerDown?.(
			pointerEvent(410, 410, { target: target("loose") }),
			h.ctx,
		);
		selectTool.onPointerMove?.(pointerEvent(125, 110), h.ctx);
		expect(draft(h).layoutDrop).not.toBeNull();
		selectTool.onPointerMove?.(pointerEvent(500, 500), h.ctx);
		expect(draft(h).layoutDrop).toBeNull();
	});
});

describe("selectTool — cross-container drop", () => {
	it("commits reparent + transform correction as ONE batch", () => {
		const h = setup();
		selectTool.onPointerDown?.(
			pointerEvent(410, 410, { target: target("loose") }),
			h.ctx,
		);
		selectTool.onPointerMove?.(pointerEvent(125, 110), h.ctx);
		selectTool.onPointerUp?.(pointerEvent(125, 110), h.ctx);
		expect(h.ctx.commitBatch).toHaveBeenCalledTimes(1);
		// Dropped page origin = (400,400) + (-285,-300) = (115,100) → f1-local (15,0).
		expect(h.commits).toEqual([
			{ type: "node.reparent", nodeId: "loose", toParentId: "f1", toIndex: 1 },
			{
				type: "node.update",
				nodeId: "loose",
				kind: "rect",
				patch: {
					transform: { x: 15, y: 0, rotation: 0, scaleX: 1, scaleY: 1 },
				},
			},
		]);
	});

	it("Alt inserts as Absolute (documented modifier)", () => {
		const h = setup();
		selectTool.onPointerDown?.(
			pointerEvent(410, 410, { target: target("loose") }),
			h.ctx,
		);
		selectTool.onPointerMove?.(altPointerEvent(125, 110), h.ctx);
		expect(draft(h).layoutDrop?.absolute).toBe(true);
		selectTool.onPointerUp?.(altPointerEvent(125, 110), h.ctx);
		expect(h.commits).toEqual([
			{ type: "node.reparent", nodeId: "loose", toParentId: "f1", toIndex: 1 },
			{
				type: "node.update",
				nodeId: "loose",
				kind: "rect",
				patch: {
					transform: { x: 15, y: 0, rotation: 0, scaleX: 1, scaleY: 1 },
					layoutItem: { positioning: "absolute" },
				},
			},
		]);
	});
});

describe("selectTool — same-parent flow reorder (TS-34)", () => {
	it("commits exactly ONE node.reorder, not a node.move", () => {
		const h = setup({ isolate: true });
		selectTool.onPointerDown?.(
			pointerEvent(105, 110, { target: target("r1") }),
			h.ctx,
		);
		// Local x 75: past r2's midpoint (70), before r3's (120) → slot 1 among
		// the remaining [r2, r3].
		selectTool.onPointerMove?.(pointerEvent(175, 110), h.ctx);
		expect(draft(h).layoutDrop).toMatchObject({ frameId: "f1", index: 1 });
		selectTool.onPointerUp?.(pointerEvent(175, 110), h.ctx);
		expect(h.ctx.commit).toHaveBeenCalledTimes(1);
		expect(h.ctx.commitBatch).not.toHaveBeenCalled();
		// The mirrored emission may move a NON-dragged sibling when that is the
		// minimal command reaching the target order: [r1,r2,r3] → [r2,r1,r3] is
		// one reorder of r2 to 0 (review 0022 P1-1).
		expect(h.commits).toEqual([
			{ type: "node.reorder", nodeId: "r2", toIndex: 0 },
		]);
		expect(appliedChildIds(h, "f1")).toEqual(["r2", "r1", "r3"]);
	});

	it("dropping back into the same slot commits nothing", () => {
		const h = setup({ isolate: true });
		selectTool.onPointerDown?.(
			pointerEvent(105, 110, { target: target("r1") }),
			h.ctx,
		);
		// Local x 8 → before r2's midpoint → slot 0 = r1's own slot.
		selectTool.onPointerMove?.(pointerEvent(108, 110), h.ctx);
		expect(draft(h).layoutDrop).toMatchObject({ index: 0 });
		selectTool.onPointerUp?.(pointerEvent(108, 110), h.ctx);
		expect(h.commits).toHaveLength(0);
	});

	// K-9 case 2. A same-slot drop is "handled" (it must not fall through to a
	// plain `node.move`) but emits zero commands — so there is no IR change, no
	// re-render, and nothing to write the imperatively-dragged position back.
	// This used to be masked by the drag layer remounting the node from IR
	// props on pointerup; K-4 removed that remount, so the restore is explicit.
	it("restores the dragged node's Konva position on a no-op same-slot drop", () => {
		const h = setup({ isolate: true, trackPositions: ["r1"] });
		selectTool.onPointerDown?.(
			pointerEvent(105, 110, { target: target("r1") }),
			h.ctx,
		);
		selectTool.onPointerMove?.(pointerEvent(108, 110), h.ctx);
		const position = h.positionFns.get("r1");
		// The gesture really did move the live node…
		expect(position).toHaveBeenCalled();
		const duringDrag = position?.mock.calls.at(-1)?.[0];
		expect(duringDrag).not.toEqual({ x: 0, y: 0 });

		selectTool.onPointerUp?.(pointerEvent(108, 110), h.ctx);

		expect(h.commits).toHaveLength(0);
		// …and pointerup put it back on r1's stored transform (0,0 in frame
		// space), not the abandoned drop position.
		expect(position).toHaveBeenLastCalledWith({ x: 0, y: 0 });
	});
});

describe("selectTool — multi-node layout drops (review 0022 P1-1)", () => {
	// The mixed case of a dragged member ALREADY inside the target frame
	// alongside foreign members is unconstructible through pointer events
	// today (nodeStarts is filtered to one selection scope, so every dragged
	// member shares a parent); commitLayoutDrop still handles it via the same
	// mirrored emission, unit-covered by reorderCommandsTo's specs.

	it("same-parent multi-drag to a trailing slot reaches the previewed order", () => {
		// The review's worked counterexample: children [r1,r2,r3,r4], drag
		// [r1,r3] past every remaining midpoint (r2:70, r4:170) → slot 2 among
		// [r2,r4]. Naive `drop.index + k` emission sequentially applies to
		// [r2,r1,r4,r3]; the target order is [r2,r4,r1,r3].
		const h = setup({ isolate: true, childIds: ["r1", "r2", "r3", "r4"] });
		h.ctx.selectionStore.getState().setSelection(["r1", "r3"]);
		selectTool.onPointerDown?.(
			pointerEvent(105, 110, { target: target("r1") }),
			h.ctx,
		);
		selectTool.onPointerMove?.(pointerEvent(275, 110), h.ctx);
		expect(draft(h).layoutDrop).toMatchObject({ frameId: "f1", index: 2 });
		selectTool.onPointerUp?.(pointerEvent(275, 110), h.ctx);
		expect(h.ctx.commitBatch).toHaveBeenCalledTimes(1);
		expect(h.commits).toEqual([
			{ type: "node.reorder", nodeId: "r2", toIndex: 0 },
			{ type: "node.reorder", nodeId: "r4", toIndex: 1 },
		]);
		expect(appliedChildIds(h, "f1")).toEqual(["r2", "r4", "r1", "r3"]);
	});

	it("multi-drag into another layout frame reparents into consecutive mirrored slots", () => {
		const h = setup({ isolate: true, secondFrame: true });
		h.ctx.selectionStore.getState().setSelection(["r1", "r2"]);
		selectTool.onPointerDown?.(
			pointerEvent(105, 110, { target: target("r1") }),
			h.ctx,
		);
		// f2-local (45,10): past s1's midpoint (20), before s2's (70) → slot 1.
		selectTool.onPointerMove?.(pointerEvent(145, 260), h.ctx);
		expect(draft(h).layoutDrop).toMatchObject({ frameId: "f2", index: 1 });
		selectTool.onPointerUp?.(pointerEvent(145, 260), h.ctx);
		expect(h.ctx.commitBatch).toHaveBeenCalledTimes(1);
		// Page origins r1 (100,100) / r2 (150,100), drag delta (40,150) →
		// f2-local landings (40,0) and (90,0).
		expect(h.commits).toEqual([
			{ type: "node.reparent", nodeId: "r1", toParentId: "f2", toIndex: 1 },
			{
				type: "node.update",
				nodeId: "r1",
				kind: "rect",
				patch: {
					transform: { x: 40, y: 0, rotation: 0, scaleX: 1, scaleY: 1 },
				},
			},
			{ type: "node.reparent", nodeId: "r2", toParentId: "f2", toIndex: 2 },
			{
				type: "node.update",
				nodeId: "r2",
				kind: "rect",
				patch: {
					transform: { x: 90, y: 0, rotation: 0, scaleX: 1, scaleY: 1 },
				},
			},
		]);
		expect(appliedChildIds(h, "f2")).toEqual(["s1", "r1", "r2", "s2"]);
		expect(appliedChildIds(h, "f1")).toEqual(["r3"]);
	});

	it("Alt multi-drag into another frame reparents at consecutive slots as Absolute", () => {
		const h = setup({ isolate: true, secondFrame: true });
		h.ctx.selectionStore.getState().setSelection(["r1", "r2"]);
		selectTool.onPointerDown?.(
			pointerEvent(105, 110, { target: target("r1") }),
			h.ctx,
		);
		selectTool.onPointerMove?.(altPointerEvent(145, 260), h.ctx);
		expect(draft(h).layoutDrop).toMatchObject({
			frameId: "f2",
			absolute: true,
		});
		selectTool.onPointerUp?.(altPointerEvent(145, 260), h.ctx);
		expect(h.ctx.commitBatch).toHaveBeenCalledTimes(1);
		expect(h.commits).toEqual([
			{ type: "node.reparent", nodeId: "r1", toParentId: "f2", toIndex: 1 },
			{
				type: "node.update",
				nodeId: "r1",
				kind: "rect",
				patch: {
					transform: { x: 40, y: 0, rotation: 0, scaleX: 1, scaleY: 1 },
					layoutItem: { positioning: "absolute" },
				},
			},
			{ type: "node.reparent", nodeId: "r2", toParentId: "f2", toIndex: 2 },
			{
				type: "node.update",
				nodeId: "r2",
				kind: "rect",
				patch: {
					transform: { x: 90, y: 0, rotation: 0, scaleX: 1, scaleY: 1 },
					layoutItem: { positioning: "absolute" },
				},
			},
		]);
		expect(appliedChildIds(h, "f2")).toEqual(["s1", "r1", "r2", "s2"]);
	});

	it("Alt multi-drag within the same frame writes Absolute per node without reparents", () => {
		const h = setup({ isolate: true });
		h.ctx.selectionStore.getState().setSelection(["r1", "r2"]);
		selectTool.onPointerDown?.(
			pointerEvent(105, 110, { target: target("r1") }),
			h.ctx,
		);
		// f1-local x 30, delta (25,0) → landings (25,0) and (75,0).
		selectTool.onPointerMove?.(altPointerEvent(130, 110), h.ctx);
		expect(draft(h).layoutDrop).toMatchObject({
			frameId: "f1",
			absolute: true,
		});
		selectTool.onPointerUp?.(altPointerEvent(130, 110), h.ctx);
		expect(h.ctx.commitBatch).toHaveBeenCalledTimes(1);
		expect(h.commits).toEqual([
			{
				type: "node.update",
				nodeId: "r1",
				kind: "rect",
				patch: {
					transform: { x: 25, y: 0, rotation: 0, scaleX: 1, scaleY: 1 },
					layoutItem: { positioning: "absolute" },
				},
			},
			{
				type: "node.update",
				nodeId: "r2",
				kind: "rect",
				patch: {
					transform: { x: 75, y: 0, rotation: 0, scaleX: 1, scaleY: 1 },
					layoutItem: { positioning: "absolute" },
				},
			},
		]);
	});
});
