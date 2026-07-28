import type { CanvasIR, CanvasNode } from "@anvilkit/canvas-core";
import {
	createCanvasIR,
	createFrame,
	createPage,
	createRect,
	insertNode,
} from "@anvilkit/canvas-core";
import type Konva from "konva";
import { describe, expect, it } from "vitest";
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

function fixtureIR(): CanvasIR {
	const frame: CanvasNode = {
		...createFrame({
			id: "f1",
			transform: { x: 100, y: 100 },
			bounds: { width: 200, height: 100 },
		}),
		autoLayout: LAYOUT,
		children: [rect("r1"), rect("r2"), rect("r3")],
	} as CanvasNode;
	const page = createPage({ id: "p1" });
	let ir = createCanvasIR({ id: "doc", title: "t", pages: [page] });
	ir = insertNode(ir, { parentId: page.root.id, node: frame });
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

function setup(opts?: { isolate?: boolean }) {
	const ir = fixtureIR();
	const h = makeHarness({ ir, pageId: "p1" });
	h.ctx.getIR = () => ir;
	const fieldPreviewStore = h.studioCtx.fieldPreviewStore;
	if (!fieldPreviewStore) throw new Error("harness lacks fieldPreviewStore");
	h.ctx.resolvedDocumentStore = createResolvedDocumentStore({
		sceneStore: createSceneStore({ initialIR: ir }),
		fieldPreviewStore,
	});
	// The pointer-move Konva mutation path looks nodes up via stage.findOne;
	// the plain fake stage has none — a null lookup just skips the mutation.
	h.ctx.stage = { findOne: () => null } as unknown as Konva.Stage;
	if (opts?.isolate) {
		const isolationStore = createIsolationStore();
		isolationStore.getState().enter("f1");
		h.ctx.isolationStore = isolationStore;
	}
	return h;
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
		expect(h.commits).toEqual([
			{ type: "node.reorder", nodeId: "r1", toIndex: 1 },
		]);
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
});
