import type {
	CanvasIR,
	CanvasNode,
	CanvasNodeCreateCommand,
	CanvasResolvedNodeRecord,
} from "@anvilkit/canvas-core";
import {
	createCanvasIR,
	createFrame,
	createGroup,
	createPage,
	createPath,
	createRect,
	findNode,
	insertNode,
	parentOf,
} from "@anvilkit/canvas-core";
import type Konva from "konva";
import { describe, expect, it, vi } from "vitest";
import type { CanvasStudioContextValue } from "@/context/canvas-studio-context.js";
import type { CanvasElementEntry } from "@/elements/element-entry.js";
import { createResolvedDocumentStore } from "@/stores/resolved-document-store.js";
import { createSceneStore } from "@/stores/scene-store.js";
import { makeHarness } from "@/tools/__tests__/_tool-test-helpers.js";
import {
	beginElementDrag,
	draggedElementEntry,
	endElementDrag,
	insertCanvasElement,
	insertElementAtPoint,
	insertElementAtViewportCenter,
} from "../element-insert-actions.js";

/**
 * @file `cp3-004` — the two insertion paths, over ONE insertion.
 *
 * The load-bearing properties, and why each is tested the way it is:
 *
 * - **One undo step.** Asserted against the REAL history store applying real
 *   commands, not against a command count. A sticker builds a `group` with
 *   children; a per-child implementation would still commit "one gesture" and
 *   still look right in a count assertion, but would need N undos.
 * - **Frame targeting.** Asserted by where the node ENDS UP in the tree
 *   (`parentOf`), not by which helper was called.
 * - **Auto Layout participation.** Asserted through the real resolver
 *   (`createResolvedDocumentStore`) — the same one the renderer and the
 *   exporters read — so "participates in the layout" means the solver moved
 *   it, not that a field was set.
 */

const FIXED_TS = "2026-08-07T00:00:00.000Z";

const LAYOUT = {
	version: 1,
	direction: "horizontal",
	padding: { top: 0, right: 0, bottom: 0, left: 0 },
	gap: 10,
	primaryAlign: "start",
	crossAlign: "start",
} as const;

/** A minimal entry whose `build()` honours `at` exactly as the catalog's does. */
function entry(over: Partial<CanvasElementEntry> = {}): CanvasElementEntry {
	return {
		id: "square",
		name: "Square",
		category: "shape",
		tags: [],
		preview: { kind: "path", d: "M0 0H24V24H0Z", viewBox: "0 0 24 24" },
		defaultSize: { width: 60, height: 40 },
		license: "MIT",
		recolor: "fill",
		build: (context) =>
			createRect({
				bounds: { width: 60, height: 40 },
				transform: { x: context?.at?.x ?? 0, y: context?.at?.y ?? 0 },
			}),
		...over,
	};
}

/** The 22 sticker shape: ONE `group` whose children come with it. */
function stickerEntry(): CanvasElementEntry {
	return entry({
		id: "star-sticker",
		category: "sticker",
		recolor: "multi",
		build: (context) =>
			createGroup({
				bounds: { width: 60, height: 40 },
				transform: { x: context?.at?.x ?? 0, y: context?.at?.y ?? 0 },
				children: [
					createRect({ bounds: { width: 10, height: 10 } }),
					createPath({ bounds: { width: 10, height: 10 }, d: "M0 0H10" }),
				],
			}),
	});
}

function pageIr(nodes: readonly CanvasNode[] = []): CanvasIR {
	const page = createPage({ id: "p1", size: { width: 800, height: 600 } });
	let ir = createCanvasIR({
		id: "doc",
		title: "doc",
		pages: [page],
		now: () => FIXED_TS,
	});
	for (const node of nodes) {
		ir = insertNode(ir, { parentId: page.root.id, node });
	}
	return ir;
}

/**
 * Stage stub whose container rect is supplied by the test, so client == page
 * coordinates at zoom 1 / pan 0 (the same trick `drop-replace.test.tsx` uses).
 */
function makeStage(rect: {
	left: number;
	top: number;
	width: number;
	height: number;
}): Konva.Stage {
	const container = document.createElement("div");
	container.getBoundingClientRect = () =>
		({
			left: rect.left,
			top: rect.top,
			width: rect.width,
			height: rect.height,
			right: rect.left + rect.width,
			bottom: rect.top + rect.height,
			x: rect.left,
			y: rect.top,
			toJSON() {
				return this;
			},
		}) as DOMRect;
	return { container: () => container } as unknown as Konva.Stage;
}

interface LiveHarness {
	ctx: CanvasStudioContextValue;
	commands: CanvasNodeCreateCommand[];
	current: () => CanvasIR;
	undo: () => void;
	redo: () => void;
	undoDepth: () => number;
	/** Resolved children of `id`, straight from the live resolver. */
	resolvedChildren: (id: string) => readonly CanvasResolvedNodeRecord[];
	resolvedRecord: (id: string) => CanvasResolvedNodeRecord | undefined;
	dispose: () => void;
}

/**
 * A harness whose `commit` really APPLIES through the history store, backed by
 * a CONNECTED resolved-document store — so undo, redo and Auto Layout all mean
 * what they mean in the product.
 *
 * `makeHarness`'s own `commit` is record-only by design (see its comment), and
 * an unconnected resolved store answers from the resolution it was built with,
 * which would make every layout assertion here vacuous.
 */
function liveHarness(ir: CanvasIR): LiveHarness {
	const h = makeHarness({ ir, pageId: "p1" });
	const ctx = h.studioCtx;
	const history = ctx.historyStore;
	const fieldPreviewStore = ctx.fieldPreviewStore;
	if (!fieldPreviewStore) throw new Error("harness lacks fieldPreviewStore");
	const sceneStore = createSceneStore({ initialIR: ir });
	const resolvedDocumentStore = createResolvedDocumentStore({
		sceneStore,
		fieldPreviewStore,
	});
	const disconnect = resolvedDocumentStore.connect();
	ctx.resolvedDocumentStore = resolvedDocumentStore;

	const commands: CanvasNodeCreateCommand[] = [];
	const sync = (next: CanvasIR): CanvasIR => {
		h.setIR(next);
		sceneStore.getState().setIR(next);
		return next;
	};
	ctx.commit = vi.fn((cmd) => {
		commands.push(cmd as CanvasNodeCreateCommand);
		return sync(history.getState().commit(ctx.getIR(), cmd));
	});
	ctx.commitBatch = vi.fn((cmds, label) => {
		for (const cmd of cmds) commands.push(cmd as CanvasNodeCreateCommand);
		return sync(history.getState().commitBatch(ctx.getIR(), cmds, label));
	});
	const view = () => resolvedDocumentStore.getState().view;
	return {
		ctx,
		commands,
		current: () => ctx.getIR(),
		undo: () => void sync(history.getState().undo(ctx.getIR())),
		redo: () => void sync(history.getState().redo(ctx.getIR())),
		undoDepth: () => history.getState().past.length,
		resolvedChildren: (id) => view().getChildren(id),
		resolvedRecord: (id) => view().getRecord(id),
		dispose: disconnect,
	};
}

describe("insertCanvasElement — command shape and selection (cp3-004)", () => {
	it("emits exactly ONE node.create on the active page and selects the node", () => {
		const h = liveHarness(pageIr());
		const id = insertCanvasElement(h.ctx, entry(), { at: { x: 10, y: 20 } });

		expect(id).not.toBeNull();
		expect(h.commands).toHaveLength(1);
		expect(h.commands[0]).toMatchObject({
			type: "node.create",
			pageId: "p1",
			node: { type: "rect", transform: { x: 10, y: 20 } },
		});
		expect(h.commands[0]?.parentId).toBeUndefined();
		// Selection after insert, exactly as `tools/rect-tool.ts:65`,
		// `tools/image-tool.ts:127` and `insertAssetsImpl` do it.
		expect(h.ctx.selectionStore.getState().selectedIds).toEqual([id]);
	});

	it("centres on the page when no anchor is given", () => {
		const h = liveHarness(pageIr());
		insertCanvasElement(h.ctx, entry());
		// 800×600 page, 60×40 element.
		expect(h.commands[0]?.node.transform).toMatchObject({ x: 370, y: 280 });
	});

	it("leaves a scale-sized node's bounds/scale pair alone", () => {
		// 353 `path` + 9 `line` catalog entries are scale-sized: baking the scale
		// into `bounds` renders a 96-unit icon at 24 units (`cp3-002`).
		const scaleSized = entry({
			id: "icon",
			build: (context) =>
				createPath({
					bounds: { width: 24, height: 24 },
					d: "M0 0H24",
					transform: {
						x: context?.at?.x ?? 0,
						y: context?.at?.y ?? 0,
						scaleX: 4,
						scaleY: 4,
					},
				}),
		});
		const h = liveHarness(pageIr());
		insertCanvasElement(h.ctx, scaleSized, { at: { x: 0, y: 0 } });
		expect(h.commands[0]?.node.bounds).toEqual({ width: 24, height: 24 });
		expect(h.commands[0]?.node.transform).toMatchObject({
			scaleX: 4,
			scaleY: 4,
		});
	});

	it("returns null and commits nothing when the active page is gone", () => {
		const h = liveHarness(pageIr());
		h.ctx.pagesStore.getState().setActivePageId("nope");
		expect(insertCanvasElement(h.ctx, entry())).toBeNull();
		expect(h.commands).toHaveLength(0);
	});
});

describe("insertCanvasElement — undo/redo is ONE step (cp3-004)", () => {
	it("undo removes the inserted node in a single step; redo restores it", () => {
		const h = liveHarness(pageIr());
		const before = h.current();
		const id = insertCanvasElement(h.ctx, entry(), { at: { x: 5, y: 5 } });

		expect(findNode(h.current(), id ?? "")).not.toBeNull();
		expect(h.undoDepth()).toBe(1);

		h.undo();
		expect(findNode(h.current(), id ?? "")).toBeNull();
		expect(h.current().pages[0]?.root.children).toEqual(
			before.pages[0]?.root.children,
		);
		expect(h.undoDepth()).toBe(0);

		h.redo();
		expect(findNode(h.current(), id ?? "")).not.toBeNull();
	});

	it("a STICKER — one group, several children — is still one undo step", () => {
		const h = liveHarness(pageIr());
		const id = insertCanvasElement(h.ctx, stickerEntry(), {
			at: { x: 0, y: 0 },
		});

		// The natural wrong implementation loops over the built subtree.
		expect(h.commands).toHaveLength(1);
		const created = findNode(h.current(), id ?? "")?.node;
		expect(created?.type).toBe("group");
		expect(
			(created as { children: readonly CanvasNode[] }).children,
		).toHaveLength(2);

		h.undo();
		expect(findNode(h.current(), id ?? "")).toBeNull();
		expect(h.undoDepth()).toBe(0);
	});
});

describe("insertElementAtPoint — frame targeting (cp3-004)", () => {
	function frameIr(over: Partial<CanvasNode> = {}): CanvasIR {
		return pageIr([
			{
				...createFrame({
					id: "f1",
					bounds: { width: 300, height: 200 },
					transform: { x: 100, y: 100 },
					children: [],
				}),
				...over,
			} as CanvasNode,
		]);
	}

	it("a drop over a frame parents the node INSIDE the frame, in frame-local space", () => {
		const h = liveHarness(frameIr());
		const id = insertElementAtPoint(h.ctx, entry(), { x: 150, y: 160 });

		expect(h.commands[0]?.parentId).toBe("f1");
		expect(parentOf(h.current(), id ?? "")?.parent.id).toBe("f1");
		// 150,160 in page space is 50,60 inside a frame at 100,100.
		expect(h.commands[0]?.node.transform).toMatchObject({ x: 50, y: 60 });
	});

	it("a drop outside every frame stays at page top level, at the drop point", () => {
		const h = liveHarness(frameIr());
		const id = insertElementAtPoint(h.ctx, entry(), { x: 700, y: 500 });

		expect(h.commands[0]?.parentId).toBeUndefined();
		expect(parentOf(h.current(), id ?? "")?.parent.type).toBe("group");
		expect(h.commands[0]?.node.transform).toMatchObject({ x: 700, y: 500 });
	});

	it("never targets a locked or hidden frame", () => {
		for (const over of [{ locked: true }, { visible: false }]) {
			const h = liveHarness(frameIr(over as Partial<CanvasNode>));
			insertElementAtPoint(h.ctx, entry(), { x: 150, y: 160 });
			expect(h.commands[0]?.parentId).toBeUndefined();
		}
	});
});

describe("insertElementAtPoint — Auto Layout frames (cp3-004)", () => {
	function layoutIr(): CanvasIR {
		return pageIr([
			{
				...createFrame({
					id: "f1",
					bounds: { width: 300, height: 100 },
					transform: { x: 100, y: 100 },
				}),
				autoLayout: LAYOUT,
				children: [
					createRect({ id: "r1", bounds: { width: 40, height: 20 } }),
					createRect({ id: "r2", bounds: { width: 40, height: 20 } }),
				],
			} as CanvasNode,
		]);
	}

	it("the inserted node joins the FLOW — the resolver lays it out, it is not absolutely positioned", () => {
		const h = liveHarness(layoutIr());
		// Drop past both existing children (local x ≈ 250 of 300).
		const id = insertElementAtPoint(h.ctx, entry(), { x: 350, y: 150 });
		expect(h.commands[0]?.parentId).toBe("f1");

		const created = findNode(h.current(), id ?? "")?.node;
		// The intent: a flow member. An `absolute` positioning override is what
		// would take it OUT of the layout.
		expect(created?.layoutItem?.positioning).toBeUndefined();

		// And the real resolver agrees: horizontal flow, gap 10, children
		// 40 + 10 + 40 + 10 → the new node's origin is at local x = 100.
		const children = h.resolvedChildren("f1");
		expect(children.map((c) => c.sourceNodeId)).toEqual(["r1", "r2", id]);
		const record = h.resolvedRecord(id ?? "");
		expect(record?.geometry.localTransform.x).toBe(100);
		expect(record?.geometry.localTransform.y).toBe(0);
	});

	it("the frame REFLOWS: existing children keep their slots and the new node takes the next one", () => {
		const h = liveHarness(layoutIr());
		const beforeCount = h.resolvedChildren("f1").length;

		insertElementAtPoint(h.ctx, entry(), { x: 350, y: 150 });
		const after = h.resolvedChildren("f1");

		expect(after).toHaveLength(beforeCount + 1);
		// Every child is on the primary axis, in order, separated by the gap.
		const xs = after.map((c) => c.geometry.localTransform.x);
		expect(xs).toEqual([0, 50, 100]);
	});

	it("a drop BEFORE the first child takes slot 0 (the flow-slot maths, reused)", () => {
		const h = liveHarness(layoutIr());
		// Local x = 5 — left of `r1`'s midpoint at 20.
		const id = insertElementAtPoint(h.ctx, entry(), { x: 105, y: 150 });

		expect(h.commands[0]?.index).toBe(0);
		expect(h.resolvedChildren("f1").map((c) => c.sourceNodeId)).toEqual([
			id,
			"r1",
			"r2",
		]);
	});

	it("undo removes it from the layout frame in one step", () => {
		const h = liveHarness(layoutIr());
		const id = insertElementAtPoint(h.ctx, entry(), { x: 350, y: 150 });
		expect(h.undoDepth()).toBe(1);
		h.undo();
		expect(findNode(h.current(), id ?? "")).toBeNull();
		const frame = findNode(h.current(), "f1")?.node;
		expect(
			(frame as { children?: readonly CanvasNode[] }).children,
		).toHaveLength(2);
	});
});

describe("insertElementAtViewportCenter (cp3-004)", () => {
	it("centres the element on the middle of the visible canvas area", () => {
		const h = liveHarness(pageIr());
		// Stage 800×600 at the origin, fully visible → centre (400, 300).
		h.ctx.stage = makeStage({ left: 0, top: 0, width: 800, height: 600 });
		insertCanvasElementViaCenter(h);
		expect(h.commands[0]?.node.transform).toMatchObject({ x: 370, y: 280 });
	});

	it("uses the VISIBLE slice when the stage is larger than the scroll viewport", () => {
		const h = liveHarness(pageIr());
		const stage = makeStage({
			left: -400,
			top: -200,
			width: 1600,
			height: 1200,
		});
		const host = document.createElement("div");
		host.setAttribute("data-canvas-viewport", "");
		host.getBoundingClientRect = () =>
			({
				left: 0,
				top: 0,
				width: 800,
				height: 600,
				right: 800,
				bottom: 600,
				x: 0,
				y: 0,
				toJSON() {
					return this;
				},
			}) as DOMRect;
		host.appendChild(stage.container());
		h.ctx.stage = stage;
		h.ctx.viewportStore.getState().setZoom(2);

		insertCanvasElementViaCenter(h);
		// Visible slice is client (0,0)–(800,600); its centre (400,300) maps to
		// page ((400 − −400)/2, (300 − −200)/2) = (400, 250). Without the
		// intersection this would be the stage's own centre — the page centre.
		expect(h.commands[0]?.node.transform).toMatchObject({ x: 370, y: 230 });
	});

	it("falls back to the page centre when ONE dimension is zero, not just both", () => {
		// A container measured mid-layout as 800x0 is not a measurement. The guard
		// used to require BOTH dimensions to be zero, so this rect passed it; the
		// host intersection then could not satisfy `bottom > top`, the centre
		// collapsed onto `rect.top`, and the element landed at the top edge —
		// off-page once half its own height was subtracted. Worse, because a point
		// WAS returned, the documented page-centre fallback never ran.
		const h = liveHarness(pageIr());
		h.ctx.stage = makeStage({ left: 0, top: 0, width: 800, height: 0 });
		insertCanvasElementViaCenter(h);
		// Page centre for the 800x600 page and a 60x40 element.
		expect(h.commands[0]?.node.transform).toMatchObject({ x: 370, y: 280 });
	});

	it("falls back to the page centre when the WIDTH is zero", () => {
		const h = liveHarness(pageIr());
		h.ctx.stage = makeStage({ left: 0, top: 0, width: 0, height: 600 });
		insertCanvasElementViaCenter(h);
		expect(h.commands[0]?.node.transform).toMatchObject({ x: 370, y: 280 });
	});

	it("falls back to the page centre when the stage is unmeasurable (jsdom / headless)", () => {
		const h = liveHarness(pageIr());
		// The harness's fake stage has a zero-by-zero rect.
		insertCanvasElementViaCenter(h);
		expect(h.commands[0]?.node.transform).toMatchObject({ x: 370, y: 280 });
	});

	it("selects the node it inserted", () => {
		const h = liveHarness(pageIr());
		h.ctx.stage = makeStage({ left: 0, top: 0, width: 800, height: 600 });
		const id = insertElementAtViewportCenter(h.ctx, entry());
		expect(h.ctx.selectionStore.getState().selectedIds).toEqual([id]);
	});

	it("never nests: a frame under the viewport centre is not a drop", () => {
		const h = liveHarness(
			pageIr([
				createFrame({
					id: "f1",
					bounds: { width: 800, height: 600 },
					transform: { x: 0, y: 0 },
					children: [],
				}),
			]),
		);
		h.ctx.stage = makeStage({ left: 0, top: 0, width: 800, height: 600 });
		insertCanvasElementViaCenter(h);
		expect(h.commands[0]?.parentId).toBeUndefined();
	});
});

function insertCanvasElementViaCenter(h: ReturnType<typeof liveHarness>): void {
	insertElementAtViewportCenter(h.ctx, entry());
}

describe("the drag payload handoff (cp3-004)", () => {
	it("resolves only the id it was begun with, and only until dragend", () => {
		const ctx = makeHarness().studioCtx;
		const dragged = entry({ id: "square" });
		expect(draggedElementEntry(ctx, "square")).toBeUndefined();

		beginElementDrag(ctx, dragged);
		expect(draggedElementEntry(ctx, "square")).toBe(dragged);
		// A stale slot must not be applied to somebody else's drag.
		expect(draggedElementEntry(ctx, "other")).toBeUndefined();

		endElementDrag();
		expect(draggedElementEntry(ctx, "square")).toBeUndefined();
	});

	it("does NOT hand a drag begun in one studio to a drop on another", () => {
		// Two `<CanvasStudio>` mounts on one page — a side-by-side compare view, a
		// docs page with two live editors — share this module. The id check cannot
		// tell them apart: it is the same entry, so the ids match. Only the owning
		// studio can.
		const studioA = makeHarness().studioCtx;
		const studioB = makeHarness().studioCtx;
		const dragged = entry({ id: "square" });

		beginElementDrag(studioA, dragged);

		expect(draggedElementEntry(studioA, "square")).toBe(dragged);
		expect(draggedElementEntry(studioB, "square")).toBeUndefined();
	});
});
