import {
	type CanvasIR,
	createCanvasIR,
	createGroup,
	createImage,
	createPage,
	createRect,
	createText,
} from "@anvilkit/canvas-core";
import type Konva from "konva";
import { describe, expect, it, vi } from "vitest";
import { createDraftStore } from "@/stores/draft-store.js";
import { createEditingStore } from "@/stores/editing-store.js";
import { createSelectionStore } from "@/stores/selection-store.js";
import { draggedIdsKey, selectDraggedIds } from "../active-nodes.js";
import {
	applyGroupCache,
	selectStaticGroupIds,
	useStaticGroupCache,
} from "../static-cache.js";

const TS = "2026-05-22T00:00:00.000Z";

/** Build a 1-page IR whose root group holds the given top-level children. */
function irWith(
	children: Parameters<typeof createGroup>[0]["children"],
): CanvasIR {
	const root = createGroup({
		id: "p1-root",
		bounds: { width: 1000, height: 1000 },
		children,
	});
	const page = createPage({ id: "p1", root });
	return createCanvasIR({ id: "ir", pages: [page], now: () => TS });
}

function shapeGroup(id: string, childId: string) {
	return createGroup({
		id,
		bounds: { width: 100, height: 100 },
		children: [createRect({ id: childId, bounds: { width: 10, height: 10 } })],
	});
}

const NO_ACTIVE = { selectedIds: [], editingNodeId: null, draggedIds: [] };

describe("selectStaticGroupIds", () => {
	it("includes a shape-only group with no active descendants", () => {
		const ir = irWith([shapeGroup("g1", "r1")]);
		expect(selectStaticGroupIds(ir, "p1", NO_ACTIVE)).toEqual(["g1"]);
	});

	it("excludes a group whose descendant is selected / editing / dragged", () => {
		const ir = irWith([shapeGroup("g1", "r1")]);
		expect(
			selectStaticGroupIds(ir, "p1", { ...NO_ACTIVE, selectedIds: ["r1"] }),
		).toEqual([]);
		expect(
			selectStaticGroupIds(ir, "p1", { ...NO_ACTIVE, editingNodeId: "r1" }),
		).toEqual([]);
		expect(
			selectStaticGroupIds(ir, "p1", { ...NO_ACTIVE, draggedIds: ["r1"] }),
		).toEqual([]);
	});

	it("excludes a group selected/dragged by its own id", () => {
		const ir = irWith([shapeGroup("g1", "r1")]);
		expect(
			selectStaticGroupIds(ir, "p1", { ...NO_ACTIVE, draggedIds: ["g1"] }),
		).toEqual([]);
	});

	it("excludes groups containing image or text (async-load) nodes", () => {
		const imgGroup = createGroup({
			id: "gImg",
			bounds: { width: 100, height: 100 },
			children: [
				createImage({
					id: "im1",
					bounds: { width: 10, height: 10 },
					assetId: "a",
				}),
			],
		});
		const textGroup = createGroup({
			id: "gText",
			bounds: { width: 100, height: 100 },
			children: [
				createText({ id: "t1", bounds: { width: 10, height: 10 }, text: "hi" }),
			],
		});
		const ir = irWith([imgGroup, textGroup, shapeGroup("gOk", "r1")]);
		expect(selectStaticGroupIds(ir, "p1", NO_ACTIVE)).toEqual(["gOk"]);
	});

	it("excludes empty groups and ignores non-group top-level nodes", () => {
		const empty = createGroup({
			id: "gEmpty",
			bounds: { width: 1, height: 1 },
		});
		const ir = irWith([
			empty,
			createRect({ id: "loose", bounds: { width: 10, height: 10 } }),
			shapeGroup("g1", "r1"),
		]);
		expect(selectStaticGroupIds(ir, "p1", NO_ACTIVE)).toEqual(["g1"]);
	});

	it("includes a nested shape-only group", () => {
		const inner = shapeGroup("inner", "r1");
		const outer = createGroup({
			id: "outer",
			bounds: { width: 200, height: 200 },
			children: [inner],
		});
		const ir = irWith([outer]);
		expect(selectStaticGroupIds(ir, "p1", NO_ACTIVE)).toEqual(["outer"]);
		// A selected node deep inside excludes the outer group.
		expect(
			selectStaticGroupIds(ir, "p1", { ...NO_ACTIVE, selectedIds: ["r1"] }),
		).toEqual([]);
	});

	it("returns [] for a missing page", () => {
		const ir = irWith([shapeGroup("g1", "r1")]);
		expect(selectStaticGroupIds(ir, "nope", NO_ACTIVE)).toEqual([]);
	});
});

/** Fake Konva stage: findOne(`.id`) returns a per-id node with cache spies. */
function fakeStage() {
	const nodes = new Map<
		string,
		{ cache: ReturnType<typeof vi.fn>; clearCache: ReturnType<typeof vi.fn> }
	>();
	const get = (id: string) => {
		let n = nodes.get(id);
		if (!n) {
			n = { cache: vi.fn(), clearCache: vi.fn() };
			nodes.set(id, n);
		}
		return n;
	};
	const stage = {
		findOne: (selector: string) => get(selector.replace(/^\./, "")),
	} as unknown as Konva.Stage;
	return { stage, node: get };
}

describe("applyGroupCache", () => {
	it("caches entering ids and clears leaving ids, leaving stable ids untouched", () => {
		const { stage, node } = fakeStage();
		let prev = applyGroupCache(stage, ["a", "b"], new Set());
		expect(node("a").cache).toHaveBeenCalledTimes(1);
		expect(node("b").cache).toHaveBeenCalledTimes(1);

		// "a" stays, "b" leaves, "c" enters.
		prev = applyGroupCache(stage, ["a", "c"], prev);
		expect(node("a").cache).toHaveBeenCalledTimes(1); // untouched
		expect(node("b").clearCache).toHaveBeenCalledTimes(1);
		expect(node("c").cache).toHaveBeenCalledTimes(1);
		expect(prev).toEqual(new Set(["a", "c"]));
	});

	it("does not throw when a node is missing or lacks cache()", () => {
		const stage = {
			findOne: (sel: string) => (sel === ".has" ? {} : null),
		} as unknown as Konva.Stage;
		expect(() =>
			applyGroupCache(stage, ["has", "missing"], new Set()),
		).not.toThrow();
	});
});

describe("useStaticGroupCache", () => {
	it("caches a static group on mount and clears it when selected", async () => {
		const { renderHook, act } = await import("@testing-library/react");
		const { stage, node } = fakeStage();
		const ir = irWith([shapeGroup("g1", "r1")]);
		const selectionStore = createSelectionStore();
		const editingStore = createEditingStore();
		const draftStore = createDraftStore();

		renderHook(() =>
			useStaticGroupCache({
				stage,
				getIR: () => ir,
				activePageId: "p1",
				ir,
				selectionStore,
				editingStore,
				draftStore,
			}),
		);

		expect(node("g1").cache).toHaveBeenCalledTimes(1);

		act(() => {
			selectionStore.getState().setSelection(["r1"]);
		});
		expect(node("g1").clearCache).toHaveBeenCalledTimes(1);
	});

	it("is a no-op when stage is null", async () => {
		const { renderHook } = await import("@testing-library/react");
		const ir = irWith([shapeGroup("g1", "r1")]);
		expect(() =>
			renderHook(() =>
				useStaticGroupCache({
					stage: null,
					getIR: () => ir,
					activePageId: "p1",
					ir,
					selectionStore: createSelectionStore(),
					editingStore: createEditingStore(),
					draftStore: createDraftStore(),
				}),
			),
		).not.toThrow();
	});
});

describe("selectDraggedIds", () => {
	it("returns ids from a MOVED move draft, [] otherwise", () => {
		expect(selectDraggedIds(null)).toEqual([]);
		expect(
			selectDraggedIds({
				type: "move",
				startX: 0,
				startY: 0,
				currentX: 12,
				currentY: 8,
				nodeStarts: [
					{ id: "a", x: 0, y: 0 },
					{ id: "b", x: 0, y: 0 },
				],
			}),
		).toEqual(["a", "b"]);
		expect(
			selectDraggedIds({
				type: "rect",
				startX: 0,
				startY: 0,
				currentX: 1,
				currentY: 1,
			}),
		).toEqual([]);
	});

	it("is NOT dragging for a zero-distance move draft (a pure selection click)", () => {
		// Regression: selectTool opens a move draft on every click. A click that
		// never moves must not promote the node onto the drag layer — that
		// remount detaches it from the selection Transformer and breaks resize.
		expect(
			selectDraggedIds({
				type: "move",
				startX: 40,
				startY: 40,
				currentX: 40,
				currentY: 40,
				nodeStarts: [{ id: "a", x: 0, y: 0 }],
			}),
		).toEqual([]);
		// Sub-threshold jitter (< 0.5px) also stays a click, not a drag.
		expect(
			selectDraggedIds({
				type: "move",
				startX: 40,
				startY: 40,
				currentX: 40.3,
				currentY: 40.1,
				nodeStarts: [{ id: "a", x: 0, y: 0 }],
			}),
		).toEqual([]);
	});
});

describe("draggedIdsKey", () => {
	const moveDraft = (currentX: number, currentY: number) => ({
		type: "move" as const,
		startX: 0,
		startY: 0,
		currentX,
		currentY,
		nodeStarts: [
			{ id: "b", x: 0, y: 0 },
			{ id: "a", x: 0, y: 0 },
		],
	});

	it("is STABLE across pointermove (currentX/Y change, ids do not) — the MVP-7 guarantee", () => {
		// Same dragged set, different move position → identical key, so a
		// useSyncExternalStore subscriber does NOT re-render per move.
		expect(draggedIdsKey(moveDraft(10, 20))).toBe(
			draggedIdsKey(moveDraft(99, 99)),
		);
	});

	it("is order-independent (sorted) and empty when not dragging", () => {
		// A moved draft sorts its ids; an unmoved draft / null is not a drag.
		expect(draggedIdsKey(moveDraft(10, 20))).toBe("a,b");
		expect(draggedIdsKey(moveDraft(0, 0))).toBe("");
		expect(draggedIdsKey(null)).toBe("");
	});
});
