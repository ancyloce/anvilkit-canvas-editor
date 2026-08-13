import {
	type CanvasIR,
	createCanvasIR,
	createFrame,
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
import { createViewportStore } from "@/stores/viewport-store.js";
import { draggedIdsKey, selectDraggedIds } from "../active-nodes.js";
import {
	applyGroupCache,
	cachePixelRatio,
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

	it("excludes empty groups and ignores non-container top-level nodes", () => {
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

	it("includes a shape-only top-level frame", () => {
		const frame = createFrame({
			id: "f1",
			bounds: { width: 100, height: 100 },
			clip: true,
			children: [createRect({ id: "r1", bounds: { width: 10, height: 10 } })],
		});
		expect(selectStaticGroupIds(irWith([frame]), "p1", NO_ACTIVE)).toEqual([
			"f1",
		]);
	});

	// The active-id sweep must see through a frame, or selecting a node inside a
	// frame would leave the frame's stale bitmap cached.
	it("excludes a frame whose descendant is active", () => {
		const frame = createFrame({
			id: "f1",
			bounds: { width: 100, height: 100 },
			children: [createRect({ id: "r1", bounds: { width: 10, height: 10 } })],
		});
		const ir = irWith([frame]);
		expect(
			selectStaticGroupIds(ir, "p1", { ...NO_ACTIVE, selectedIds: ["r1"] }),
		).toEqual([]);
	});

	// A placeholder resolves to an asset and starts rendering asynchronously —
	// same stale-bitmap hazard that keeps `image` out of CACHEABLE_LEAF_TYPES.
	it("excludes a frame carrying a placeholder", () => {
		const frame = createFrame({
			id: "f1",
			bounds: { width: 100, height: 100 },
			placeholder: { kind: "image" },
			children: [createRect({ id: "r1", bounds: { width: 10, height: 10 } })],
		});
		expect(selectStaticGroupIds(irWith([frame]), "p1", NO_ACTIVE)).toEqual([]);
	});

	it("includes a group holding a shape-only frame", () => {
		const group = createGroup({
			id: "g1",
			bounds: { width: 200, height: 200 },
			children: [
				createFrame({
					id: "f1",
					bounds: { width: 100, height: 100 },
					children: [
						createRect({ id: "r1", bounds: { width: 10, height: 10 } }),
					],
				}),
			],
		});
		expect(selectStaticGroupIds(irWith([group]), "p1", NO_ACTIVE)).toEqual([
			"g1",
		]);
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

/**
 * Fake Konva stage returning a per-id node with cache spies. `ids` pre-
 * registers every id the test cares about — `findNodeById` (E-13) selects
 * via a predicate (real Konva's `findOne(fn)` semantics), so this fake must
 * search a known node set rather than parse an id out of a selector string.
 */
function fakeStage(ids: readonly string[] = []) {
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
	for (const id of ids) get(id);
	const stage = {
		findOne: (selector: (node: { id(): string }) => boolean) => {
			for (const [id, n] of nodes) {
				if (selector({ id: () => id, ...n })) return n;
			}
			return null;
		},
	} as unknown as Konva.Stage;
	return { stage, node: get };
}

describe("applyGroupCache", () => {
	it("caches entering ids and clears leaving ids, leaving stable ids untouched", () => {
		const { stage, node } = fakeStage(["a", "b", "c"]);
		const view = { zoom: 1, devicePixelRatio: 1 };
		let prev = applyGroupCache(stage, ["a", "b"], new Map(), view);
		expect(node("a").cache).toHaveBeenCalledTimes(1);
		expect(node("b").cache).toHaveBeenCalledTimes(1);

		// "a" stays, "b" leaves, "c" enters.
		prev = applyGroupCache(stage, ["a", "c"], prev, view);
		expect(node("a").cache).toHaveBeenCalledTimes(1); // untouched
		expect(node("b").clearCache).toHaveBeenCalledTimes(1);
		expect(node("c").cache).toHaveBeenCalledTimes(1);
		expect([...prev.keys()].sort()).toEqual(["a", "c"]);
	});

	it("does not throw when a node is missing or lacks cache()", () => {
		const stage = {
			findOne: (selector: (node: { id(): string }) => boolean) =>
				selector({ id: () => "has" }) ? {} : null,
		} as unknown as Konva.Stage;
		expect(() =>
			applyGroupCache(stage, ["has", "missing"], new Map(), {
				zoom: 1,
				devicePixelRatio: 1,
			}),
		).not.toThrow();
	});
});

/**
 * K-7 item 1. `node.cache()` with no config rasterises at `devicePixelRatio`,
 * and Konva then blits that bitmap through the node's absolute transform —
 * which includes the stage's `scaleX/Y = zoom`. So a group cached at DPR 2 and
 * viewed at zoom 4 is an 8× upscale of a 2× bitmap: soft exactly where the
 * user zoomed in to look closely.
 */
describe("cachePixelRatio", () => {
	it("matches one bitmap pixel to one device pixel", () => {
		expect(cachePixelRatio(null, { zoom: 4, devicePixelRatio: 2 })).toBe(8);
		expect(cachePixelRatio(null, { zoom: 1, devicePixelRatio: 2 })).toBe(2);
	});

	it("follows the zoom down rather than over-allocating when zoomed out", () => {
		// Below 1:1 the DPR baseline would rasterise more pixels than the view
		// can show; the floor tracks the target instead.
		expect(cachePixelRatio(null, { zoom: 0.5, devicePixelRatio: 2 })).toBe(1);
	});

	it("gives a small group full crispness at maximum zoom", () => {
		// 200×200 at ratio 8 is 2.6 Mpx — inside the budget.
		expect(cachePixelRatio(200 * 200, { zoom: 4, devicePixelRatio: 2 })).toBe(
			8,
		);
	});

	it("caps a mid-size group below the crisp ratio but above the old default", () => {
		// 500×500 at ratio 8 would be 16 Mpx; the budget allows ratio 4 — still
		// twice the resolution the argument-less cache() produced.
		const ratio = cachePixelRatio(500 * 500, { zoom: 4, devicePixelRatio: 2 });
		expect(ratio).toBeCloseTo(4, 5);
	});

	it("never comes out worse than the argument-less cache it replaces", () => {
		// A full-page group cannot afford the crisp ratio, but must not be
		// rasterised BELOW the DPR the old code used.
		const ratio = cachePixelRatio(1080 * 1920, { zoom: 4, devicePixelRatio: 2 });
		expect(ratio).toBe(2);
	});

	it("falls back to DPR for a degenerate zoom", () => {
		expect(cachePixelRatio(100, { zoom: 0, devicePixelRatio: 3 })).toBe(3);
		expect(
			cachePixelRatio(100, { zoom: Number.NaN, devicePixelRatio: 3 }),
		).toBe(3);
	});
});

describe("applyGroupCache — resolution reconciliation (K-7)", () => {
	it("rasterises at the zoom-aware ratio", () => {
		const { stage, node } = fakeStage(["a"]);
		applyGroupCache(stage, ["a"], new Map(), {
			zoom: 3,
			devicePixelRatio: 2,
		});
		expect(node("a").cache).toHaveBeenCalledWith({ pixelRatio: 6 });
	});

	it("re-rasterises a still-static group after a real zoom change", () => {
		const { stage, node } = fakeStage(["a"]);
		let prev = applyGroupCache(stage, ["a"], new Map(), {
			zoom: 1,
			devicePixelRatio: 2,
		});
		expect(node("a").cache).toHaveBeenCalledTimes(1);

		prev = applyGroupCache(stage, ["a"], prev, {
			zoom: 4,
			devicePixelRatio: 2,
		});
		// Membership did not change — only the resolution did, which is exactly
		// the case the old membership-only diff could not see.
		expect(node("a").cache).toHaveBeenCalledTimes(2);
		expect(node("a").cache).toHaveBeenLastCalledWith({ pixelRatio: 8 });
	});

	it("ignores a zoom nudge too small to be worth re-rasterising", () => {
		const { stage, node } = fakeStage(["a"]);
		const prev = applyGroupCache(stage, ["a"], new Map(), {
			zoom: 1,
			devicePixelRatio: 2,
		});
		applyGroupCache(stage, ["a"], prev, { zoom: 1.05, devicePixelRatio: 2 });
		expect(node("a").cache).toHaveBeenCalledTimes(1);
	});
});

describe("useStaticGroupCache", () => {
	it("caches a static group on mount and clears it when selected", async () => {
		const { renderHook, act } = await import("@testing-library/react");
		const { stage, node } = fakeStage(["g1"]);
		const ir = irWith([shapeGroup("g1", "r1")]);
		const selectionStore = createSelectionStore();
		const editingStore = createEditingStore();
		const draftStore = createDraftStore();
		const viewportStore = createViewportStore();

		renderHook(() =>
			useStaticGroupCache({
				stage,
				getIR: () => ir,
				activePageId: "p1",
				ir,
				selectionStore,
				editingStore,
				draftStore,
				viewportStore,
			}),
		);

		expect(node("g1").cache).toHaveBeenCalledTimes(1);

		act(() => {
			selectionStore.getState().setSelection(["r1"]);
		});
		expect(node("g1").clearCache).toHaveBeenCalledTimes(1);
	});

	// K-7 item 2. A cached bitmap is the wrong resolution the moment the zoom
	// moves, and nothing used to re-rasterise it — the group stayed soft for
	// the rest of the session, or until it happened to become active again.
	it("re-caches after the zoom settles, and not once per wheel tick", async () => {
		const { renderHook, act } = await import("@testing-library/react");
		vi.useFakeTimers();
		try {
			const { stage, node } = fakeStage(["g1"]);
			const ir = irWith([shapeGroup("g1", "r1")]);
			const selectionStore = createSelectionStore();
			const editingStore = createEditingStore();
			const draftStore = createDraftStore();
			const viewportStore = createViewportStore();

			renderHook(() =>
				useStaticGroupCache({
					stage,
					getIR: () => ir,
					activePageId: "p1",
					ir,
					selectionStore,
					editingStore,
					draftStore,
					viewportStore,
				}),
			);
			expect(node("g1").cache).toHaveBeenCalledTimes(1);

			// A wheel zoom emits a burst. Re-rasterising each intermediate value
			// would cost far more than the momentary blur it fixes.
			act(() => {
				for (const z of [1.2, 1.6, 2.1, 2.8, 3.4, 4]) {
					viewportStore.getState().setZoom(z);
				}
			});
			expect(node("g1").cache).toHaveBeenCalledTimes(1);

			act(() => {
				vi.advanceTimersByTime(500);
			});
			// Exactly one re-cache for the whole gesture, at the settled zoom.
			expect(node("g1").cache).toHaveBeenCalledTimes(2);
		} finally {
			vi.useRealTimers();
		}
	});

	it("does not re-cache on pan, which cannot change resolution", async () => {
		const { renderHook, act } = await import("@testing-library/react");
		vi.useFakeTimers();
		try {
			const { stage, node } = fakeStage(["g1"]);
			const ir = irWith([shapeGroup("g1", "r1")]);
			const selectionStore = createSelectionStore();
			const editingStore = createEditingStore();
			const draftStore = createDraftStore();
			const viewportStore = createViewportStore();

			renderHook(() =>
				useStaticGroupCache({
					stage,
					getIR: () => ir,
					activePageId: "p1",
					ir,
					selectionStore,
					editingStore,
					draftStore,
					viewportStore,
				}),
			);
			expect(node("g1").cache).toHaveBeenCalledTimes(1);

			// `viewportStore` carries pan too, and a hand-drag writes it every
			// frame — none of which affects the cache resolution.
			act(() => {
				viewportStore.getState().setPan(40, 40);
				viewportStore.getState().setPan(80, 90);
			});
			act(() => {
				vi.advanceTimersByTime(500);
			});
			expect(node("g1").cache).toHaveBeenCalledTimes(1);
		} finally {
			vi.useRealTimers();
		}
	});

	it("re-caches a group whose content changed via IR update, even though it stayed static (E-7)", async () => {
		const { renderHook } = await import("@testing-library/react");
		const { stage, node } = fakeStage(["g1"]);
		const selectionStore = createSelectionStore();
		const editingStore = createEditingStore();
		const draftStore = createDraftStore();
		const viewportStore = createViewportStore();
		const ir1 = irWith([shapeGroup("g1", "r1")]);

		const { rerender } = renderHook(
			(props: Parameters<typeof useStaticGroupCache>[0]) =>
				useStaticGroupCache(props),
			{
				initialProps: {
					stage,
					getIR: () => ir1,
					activePageId: "p1",
					ir: ir1,
					selectionStore,
					editingStore,
					draftStore,
					viewportStore,
				},
			},
		);
		expect(node("g1").cache).toHaveBeenCalledTimes(1);

		// Simulate an undo/redo/remote-collab write into the STILL-idle
		// group — a fresh top-level node reference for the SAME id "g1",
		// which is never selected/edited/dragged either time.
		const ir2 = irWith([shapeGroup("g1", "r1")]);
		rerender({
			stage,
			getIR: () => ir2,
			activePageId: "p1",
			ir: ir2,
			selectionStore,
			editingStore,
			draftStore,
			viewportStore,
		});
		// Before the fix, applyGroupCache saw "g1" as membership-unchanged
		// and never refreshed its now-stale bitmap.
		expect(node("g1").cache).toHaveBeenCalledTimes(2);
	});

	it("does not re-cache a still-static group when its content did not change", async () => {
		const { renderHook, act } = await import("@testing-library/react");
		const { stage, node } = fakeStage(["g1"]);
		const selectionStore = createSelectionStore();
		const editingStore = createEditingStore();
		const draftStore = createDraftStore();
		const viewportStore = createViewportStore();
		const ir = irWith([shapeGroup("g1", "r1")]);

		renderHook(() =>
			useStaticGroupCache({
				stage,
				getIR: () => ir,
				activePageId: "p1",
				ir,
				selectionStore,
				editingStore,
				draftStore,
				viewportStore,
			}),
		);
		expect(node("g1").cache).toHaveBeenCalledTimes(1);

		// A store notification with no actual IR change (e.g. selecting an
		// unrelated id that was already unselected) must not re-cache.
		act(() => {
			selectionStore.getState().setSelection([]);
		});
		expect(node("g1").cache).toHaveBeenCalledTimes(1);
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
