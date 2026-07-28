import type { CanvasIR, CanvasNode } from "@anvilkit/canvas-core";
import {
	createCanvasIR,
	createFrame,
	createPage,
	createRect,
	insertNode,
} from "@anvilkit/canvas-core";
import { describe, expect, it, vi } from "vitest";
import { createResolvedDocumentStore } from "@/stores/resolved-document-store.js";
import { createSceneStore } from "@/stores/scene-store.js";
import { makeHarness } from "@/tools/__tests__/_tool-test-helpers.js";
import {
	canEnableAutoLayout,
	canRemoveAutoLayout,
	canWrapSelectionInAutoLayout,
	enableAutoLayoutOnSelectionImpl,
	removeAutoLayoutFromSelectionImpl,
	wrapSelectionInAutoLayoutImpl,
} from "../auto-layout-actions.js";

/**
 * T-M4-05 (TS-29, TS-30) — creation/conversion/removal actions. A REAL
 * resolved-document store backs every test so footprints/local transforms
 * come from the actual resolver, proving the caller-side geometry path.
 */

const DEFAULT_LAYOUT = {
	version: 1,
	direction: "horizontal",
	padding: { top: 0, right: 0, bottom: 0, left: 0 },
	gap: 8,
	primaryAlign: "start",
	crossAlign: "start",
} as const;

function rectAt(id: string, x: number, y: number): CanvasNode {
	return createRect({
		id,
		transform: { x, y },
		bounds: { width: 40, height: 20 },
	});
}

function irWith(nodes: readonly CanvasNode[]): CanvasIR {
	const page = createPage({ id: "p1" });
	let ir = createCanvasIR({ id: "doc", title: "t", pages: [page] });
	for (const node of nodes) {
		ir = insertNode(ir, { parentId: page.root.id, node });
	}
	return ir;
}

function setup(ir: CanvasIR, selection: readonly string[]) {
	const h = makeHarness({ ir, pageId: "p1" });
	const fieldPreviewStore = h.studioCtx.fieldPreviewStore;
	if (!fieldPreviewStore) throw new Error("harness lacks fieldPreviewStore");
	// The harness tracks `ir` in a closure (no sceneStore) — back the resolved
	// store with a real scene store over the same fixture; commits are
	// record-only, so the two never diverge within a test.
	const store = createResolvedDocumentStore({
		sceneStore: createSceneStore({ initialIR: ir }),
		fieldPreviewStore,
	});
	h.studioCtx.resolvedDocumentStore = store;
	h.studioCtx.selectionStore.getState().setSelection([...selection]);
	return h;
}

describe("wrapSelectionInAutoLayoutImpl (TS-29)", () => {
	it("wraps a horizontal selection adopting visual bounds and rebased child geometry", () => {
		const ir = irWith([rectAt("r1", 10, 10), rectAt("r2", 70, 12)]);
		const h = setup(ir, ["r1", "r2"]);
		const frameId = wrapSelectionInAutoLayoutImpl(h.studioCtx);
		expect(frameId).not.toBeNull();
		// Sibling order already matches visual order → ONE plain command.
		expect(h.studioCtx.commit).toHaveBeenCalledTimes(1);
		expect(h.studioCtx.commitBatch).not.toHaveBeenCalled();
		const cmd = h.commits[0] as Record<string, unknown>;
		expect(cmd).toMatchObject({
			type: "selection.wrap-in-layout-frame",
			pageId: "p1",
			childIds: ["r1", "r2"],
			frameId,
			transform: { x: 10, y: 10 },
			bounds: { width: 100, height: 22 },
			layout: DEFAULT_LAYOUT,
		});
		const geometry = (
			cmd as {
				geometry: { nodeId: string; transform: { x: number; y: number } }[];
			}
		).geometry;
		expect(geometry).toHaveLength(2);
		expect(geometry[0]).toMatchObject({
			nodeId: "r1",
			transform: { x: 0, y: 0 },
		});
		expect(geometry[1]).toMatchObject({
			nodeId: "r2",
			transform: { x: 60, y: 2 },
		});
		// The new frame becomes the selection.
		expect(h.studioCtx.selectionStore.getState().selectedIds).toEqual([
			frameId,
		]);
	});

	it("infers vertical direction from a stacked selection", () => {
		const ir = irWith([rectAt("r1", 10, 10), rectAt("r2", 12, 60)]);
		const h = setup(ir, ["r1", "r2"]);
		wrapSelectionInAutoLayoutImpl(h.studioCtx);
		expect(h.commits[0]).toMatchObject({
			layout: { ...DEFAULT_LAYOUT, direction: "vertical" },
		});
	});

	it("emits one canvas.layout.created event (source selection) — T-M4-11", () => {
		const ir = irWith([rectAt("r1", 10, 10), rectAt("r2", 70, 12)]);
		const h = setup(ir, ["r1", "r2"]);
		const onLayoutEvent = vi.fn();
		h.studioCtx.onLayoutEvent = onLayoutEvent;
		wrapSelectionInAutoLayoutImpl(h.studioCtx);
		expect(onLayoutEvent).toHaveBeenCalledTimes(1);
		expect(onLayoutEvent).toHaveBeenCalledWith({
			type: "canvas.layout.created",
			direction: "horizontal",
			source: "selection",
			childCount: 2,
		});
	});

	it("adds fixing reorders as ONE batch when sibling order differs from visual order", () => {
		// r1 sits visually RIGHT of r2 while preceding it in sibling order.
		const ir = irWith([rectAt("r1", 70, 10), rectAt("r2", 10, 10)]);
		const h = setup(ir, ["r1", "r2"]);
		const frameId = wrapSelectionInAutoLayoutImpl(h.studioCtx);
		expect(h.studioCtx.commitBatch).toHaveBeenCalledTimes(1);
		expect(h.studioCtx.commit).not.toHaveBeenCalled();
		expect(h.commits).toHaveLength(2);
		expect(h.commits[0]).toMatchObject({
			type: "selection.wrap-in-layout-frame",
			frameId,
			childIds: ["r2", "r1"],
		});
		expect(h.commits[1]).toEqual({
			type: "node.reorder",
			nodeId: "r2",
			toIndex: 0,
		});
	});

	it("declines non-sibling selections", () => {
		const frame: CanvasNode = {
			...createFrame({ id: "f1", bounds: { width: 200, height: 100 } }),
			children: [rectAt("inner", 0, 0)],
		} as CanvasNode;
		const ir = irWith([frame, rectAt("outer", 10, 60)]);
		expect(canWrapSelectionInAutoLayout(ir, ["inner", "outer"])).toBe(false);
		const h = setup(ir, ["inner", "outer"]);
		expect(wrapSelectionInAutoLayoutImpl(h.studioCtx)).toBeNull();
		expect(h.commits).toHaveLength(0);
	});
});

describe("enableAutoLayoutOnSelectionImpl", () => {
	it("converts a plain frame with defaults and visual-order reorders as one batch", () => {
		const frame: CanvasNode = {
			...createFrame({ id: "f1", bounds: { width: 200, height: 100 } }),
			children: [rectAt("r1", 70, 10), rectAt("r2", 10, 10)],
		} as CanvasNode;
		const ir = irWith([frame]);
		expect(canEnableAutoLayout(ir, ["f1"])).toBe(true);
		const h = setup(ir, ["f1"]);
		const ids = enableAutoLayoutOnSelectionImpl(h.studioCtx);
		expect(ids).toEqual(["f1"]);
		expect(h.studioCtx.commitBatch).toHaveBeenCalledTimes(1);
		expect(h.commits).toEqual([
			{ type: "node.reorder", nodeId: "r2", toIndex: 0 },
			{ type: "frame.set-layout", nodeId: "f1", layout: DEFAULT_LAYOUT },
		]);
	});

	it("declines frames that already have layout and non-frames", () => {
		const frame: CanvasNode = {
			...createFrame({ id: "f1", bounds: { width: 200, height: 100 } }),
			autoLayout: DEFAULT_LAYOUT,
		} as CanvasNode;
		const ir = irWith([frame, rectAt("r1", 10, 10)]);
		expect(canEnableAutoLayout(ir, ["f1"])).toBe(false);
		expect(canEnableAutoLayout(ir, ["r1"])).toBe(false);
		expect(canEnableAutoLayout(ir, [])).toBe(false);
	});
});

describe("removeAutoLayoutFromSelectionImpl (TS-30)", () => {
	it("materializes the resolved visual result and clears child intent", () => {
		const frame: CanvasNode = {
			...createFrame({
				id: "f1",
				transform: { x: 5, y: 6 },
				bounds: { width: 200, height: 100 },
			}),
			autoLayout: { ...DEFAULT_LAYOUT, gap: 10 },
			children: [
				{
					...rectAt("r1", 0, 0),
					layoutItem: { positioning: "flow" as const },
				},
				rectAt("r2", 0, 0),
			],
		} as CanvasNode;
		const ir = irWith([frame]);
		expect(canRemoveAutoLayout(ir, ["f1"])).toBe(true);
		const h = setup(ir, ["f1"]);
		const onLayoutEvent = vi.fn();
		h.studioCtx.onLayoutEvent = onLayoutEvent;
		const ids = removeAutoLayoutFromSelectionImpl(h.studioCtx);
		expect(ids).toEqual(["f1"]);
		expect(onLayoutEvent).toHaveBeenCalledWith({
			type: "canvas.layout.removed",
			childCount: 2,
			nestedDepth: 1,
		});
		expect(h.studioCtx.commit).toHaveBeenCalledTimes(1);
		const cmd = h.commits[0] as {
			type: string;
			nodeId: string;
			geometry: {
				nodeId: string;
				transform?: { x: number; y: number };
				bounds?: { width: number; height: number };
				layoutItem?: null;
			}[];
		};
		expect(cmd.type).toBe("frame.remove-layout");
		expect(cmd.nodeId).toBe("f1");
		const byId = new Map(cmd.geometry.map((g) => [g.nodeId, g]));
		// Frame keeps its resolved placement and size.
		expect(byId.get("f1")).toMatchObject({
			transform: { x: 5, y: 6 },
			bounds: { width: 200, height: 100 },
		});
		// Children are pinned at their resolved flow positions; r2 follows r1
		// at 40 wide + gap 10.
		expect(byId.get("r1")).toMatchObject({
			transform: { x: 0, y: 0 },
			layoutItem: null,
		});
		expect(byId.get("r2")).toMatchObject({ transform: { x: 50, y: 0 } });
		expect(byId.get("r2")?.layoutItem).toBeUndefined();
	});

	it("declines when no selected frame has layout", () => {
		const ir = irWith([rectAt("r1", 10, 10)]);
		expect(canRemoveAutoLayout(ir, ["r1"])).toBe(false);
		const h = setup(ir, ["r1"]);
		expect(removeAutoLayoutFromSelectionImpl(h.studioCtx)).toEqual([]);
		expect(h.commits).toHaveLength(0);
	});
});
