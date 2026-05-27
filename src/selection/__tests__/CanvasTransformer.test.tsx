import type {
	CanvasAnyNodeUpdateCommand,
	CanvasIR,
	CanvasNodeResizeCommand,
	CanvasNodeRotateCommand,
} from "@anvilkit/canvas-core";
import {
	createCanvasIR,
	createEllipse,
	createGroup,
	createLine,
	createPage,
	createRect,
} from "@anvilkit/canvas-core";
import { act, render } from "@testing-library/react";
import type Konva from "konva";
import { describe, expect, it, vi } from "vitest";
import {
	CanvasStudioContext,
	type CanvasStudioContextValue,
} from "../../context/canvas-studio-context.js";
import { createDraftStore } from "../../stores/draft-store.js";
import { createEditingStore } from "../../stores/editing-store.js";
import { createGuidesStore } from "../../stores/guides-store.js";
import { createHistoryStore } from "../../stores/history-store.js";
import { createPagesStore } from "../../stores/pages-store.js";
import { createSelectionStore } from "../../stores/selection-store.js";
import { createToolStore } from "../../stores/tool-store.js";
import { createViewportStore } from "../../stores/viewport-store.js";
import {
	CanvasTransformer,
	selectionBox,
	setAnchorHovered,
} from "../CanvasTransformer.js";

type CapturedProps = {
	props: Record<string, unknown>;
	ref?: { current: unknown };
};

const transformerCalls: CapturedProps[] = [];

vi.mock("react-konva", () => ({
	Transformer: (props: Record<string, unknown> & { ref?: unknown }) => {
		const { ref, ...rest } = props;
		const refObj = ref as { current: unknown } | undefined;
		const fakeTransformer = {
			nodes: vi.fn(),
			getLayer: () => ({ batchDraw: vi.fn() }),
		};
		if (refObj && "current" in refObj) {
			refObj.current = fakeTransformer;
		}
		transformerCalls.push({ props: rest, ref: refObj });
		return null;
	},
	// The size-badge nodes render inside the same layer; stub them out — the
	// effects guard on the (null) refs, so they never touch a real Konva node.
	Label: () => null,
	Tag: () => null,
	Text: () => null,
}));

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
		],
	});
	return createCanvasIR({ id: "ir-1", pages: [page], now: () => FIXED_TS });
}

function makeFakeStage(nodes: Record<string, Konva.Node>): Konva.Stage {
	return {
		findOne: (sel: string) => nodes[sel.replace(/^\./, "")] ?? null,
	} as unknown as Konva.Stage;
}

function makeNode(initial: {
	x: number;
	y: number;
	scaleX?: number;
	scaleY?: number;
	rotation?: number;
}): Konva.Node {
	let x = initial.x;
	let y = initial.y;
	let scaleX = initial.scaleX ?? 1;
	let scaleY = initial.scaleY ?? 1;
	let rotation = initial.rotation ?? 0;
	return {
		x: (v?: number) => (v === undefined ? x : ((x = v), undefined)),
		y: (v?: number) => (v === undefined ? y : ((y = v), undefined)),
		scaleX: (v?: number) =>
			v === undefined ? scaleX : ((scaleX = v), undefined),
		scaleY: (v?: number) =>
			v === undefined ? scaleY : ((scaleY = v), undefined),
		rotation: (v?: number) =>
			v === undefined ? rotation : ((rotation = v), undefined),
	} as unknown as Konva.Node;
}

function makeCtx(stage: Konva.Stage | null, ir: CanvasIR) {
	const commits: Parameters<CanvasStudioContextValue["commit"]>[0][] = [];
	const ctx: CanvasStudioContextValue = {
		historyStore: createHistoryStore(),
		toolStore: createToolStore(),
		selectionStore: createSelectionStore(),
		viewportStore: createViewportStore(),
		guidesStore: createGuidesStore(),
		draftStore: createDraftStore(),
		editingStore: createEditingStore(),
		pagesStore: createPagesStore({ initialActivePageId: "p1" }),
		getIR: () => ir,
		commit: vi.fn((cmd) => {
			commits.push(cmd);
			return ir;
		}),
		pickAsset: () => Promise.resolve(""),
		stage,
		activePageId: "p1",
		ir,
	};
	return { ctx, commits };
}

describe("CanvasTransformer", () => {
	it("renders a <Transformer> and binds it to selected Konva nodes", () => {
		transformerCalls.length = 0;
		const ir = fixtureIR();
		const node = makeNode({ x: 10, y: 20 });
		const stage = makeFakeStage({ rectA: node });
		const { ctx } = makeCtx(stage, ir);
		ctx.selectionStore.getState().setSelection(["rectA"]);
		render(
			<CanvasStudioContext.Provider value={ctx}>
				<CanvasTransformer />
			</CanvasStudioContext.Provider>,
		);
		expect(transformerCalls).toHaveLength(1);
		const fakeTr = transformerCalls[0]?.ref?.current as {
			nodes: ReturnType<typeof vi.fn>;
		};
		// The effect should have called .nodes() with the selected node.
		expect(fakeTr.nodes).toHaveBeenCalled();
		const [args] = fakeTr.nodes.mock.calls[0];
		expect(args).toHaveLength(1);
		expect(args[0]).toBe(node);
	});

	// Fake anchor that records setter calls and matches by name.
	const makeAnchor = (name: string, dragging = false) => {
		const state: Record<string, unknown> = {};
		const setter = (key: string) => (v: unknown) => {
			state[key] = v;
		};
		return {
			state,
			name: () => `${name} _anchor`,
			hasName: (n: string) => n === name || n === "_anchor",
			isDragging: () => dragging,
			visible: setter("visible"),
			fill: setter("fill"),
			stroke: setter("stroke"),
			strokeWidth: setter("strokeWidth"),
			width: setter("width"),
			height: setter("height"),
			offsetX: setter("offsetX"),
			offsetY: setter("offsetY"),
			cornerRadius: setter("cornerRadius"),
		};
	};

	function renderTransformer() {
		transformerCalls.length = 0;
		const ir = fixtureIR();
		const node = makeNode({ x: 10, y: 20 });
		const stage = makeFakeStage({ rectA: node });
		const { ctx } = makeCtx(stage, ir);
		ctx.selectionStore.getState().setSelection(["rectA"]);
		render(
			<CanvasStudioContext.Provider value={ctx}>
				<CanvasTransformer />
			</CanvasStudioContext.Provider>,
		);
		return transformerCalls[0]?.props as Record<string, unknown> & {
			anchorStyleFunc: (a: unknown) => void;
			onTransformStart: () => void;
		};
	}

	it("applies the selection chrome (violet border, white circular corners, pill edges)", () => {
		const props = renderTransformer();
		expect(props.borderStroke).toBe("#7c3aed");
		expect(props.anchorStroke).toBe("#7c3aed");
		expect(props.anchorFill).toBe("#ffffff");
		expect(props.anchorCornerRadius).toBe(6);
		expect(props.anchorSize).toBe(12);
		expect(props.rotateLineVisible).toBe(false);

		// Rotater → white vertical pill (NOT a persistent purple block).
		const rotater = makeAnchor("rotater");
		props.anchorStyleFunc(rotater);
		expect(rotater.state.fill).toBe("#ffffff");
		expect(rotater.state.height as number).toBeGreaterThan(
			rotater.state.width as number,
		);

		// top/bottom-center → horizontal pill (wider than tall), white at rest.
		const topCenter = makeAnchor("top-center");
		props.anchorStyleFunc(topCenter);
		expect(topCenter.state.fill).toBe("#ffffff");
		expect(topCenter.state.width as number).toBeGreaterThan(
			topCenter.state.height as number,
		);

		// middle-left/right → vertical pill (taller than wide).
		const middleLeft = makeAnchor("middle-left");
		props.anchorStyleFunc(middleLeft);
		expect(middleLeft.state.height as number).toBeGreaterThan(
			middleLeft.state.width as number,
		);

		// Corners keep the circular global style (shape untouched), white fill.
		const topLeft = makeAnchor("top-left");
		props.anchorStyleFunc(topLeft);
		expect(topLeft.state.width).toBeUndefined();
		expect(topLeft.state.cornerRadius).toBeUndefined();
		expect(topLeft.state.fill).toBe("#ffffff");
	});

	it("hides every dragger but the one being dragged while transforming", () => {
		const props = renderTransformer();
		// Enter transform mode (sets the internal `transformingRef`).
		act(() => {
			props.onTransformStart();
		});

		// The grabbed handle stays visible and turns violet…
		const active = makeAnchor("bottom-center", true);
		props.anchorStyleFunc(active);
		expect(active.state.visible).toBe(true);
		expect(active.state.fill).toBe("#7c3aed");

		// …every other handle is hidden.
		const idle = makeAnchor("top-left", false);
		props.anchorStyleFunc(idle);
		expect(idle.state.visible).toBe(false);
	});

	it("setAnchorHovered tints an anchor violet on hover and reverts on leave", () => {
		const anchor = makeAnchor("middle-right");
		const a = anchor as unknown as Parameters<typeof setAnchorHovered>[0];
		setAnchorHovered(a, true);
		expect(anchor.state.fill).toBe("#7c3aed");
		setAnchorHovered(a, false);
		expect(anchor.state.fill).toBe("#ffffff");
	});

	it("selectionBox unions the selected nodes' client rects in layer space", () => {
		const rects: Record<
			string,
			{ x: number; y: number; w: number; h: number }
		> = {
			a: { x: 10, y: 20, w: 100, h: 40 },
			b: { x: 80, y: 10, w: 60, h: 80 },
		};
		const stage = {
			findOne: (sel: string) => {
				const r = rects[sel.replace(/^\./, "")];
				return r
					? {
							getClientRect: () => ({
								x: r.x,
								y: r.y,
								width: r.w,
								height: r.h,
							}),
						}
					: null;
			},
		} as unknown as Konva.Stage;
		const box = selectionBox(stage, ["a", "b"], null);
		// union: x∈[10,140], y∈[10,90] → 130×80 at (10,10).
		expect(box).toEqual({ x: 10, y: 10, width: 130, height: 80 });
	});

	it("re-points the transformer at the live node on a move-draft change (selection follows the drag)", () => {
		transformerCalls.length = 0;
		const ir = fixtureIR();
		const nodeA = makeNode({ x: 10, y: 20 });
		// Mutable node map: simulate the drag-layer optimization swapping the
		// Konva node instance out from under the transformer mid-drag.
		const nodeMap: Record<string, Konva.Node> = { rectA: nodeA };
		const stage = {
			findOne: (sel: string) => nodeMap[sel.replace(/^\./, "")] ?? null,
		} as unknown as Konva.Stage;
		const { ctx } = makeCtx(stage, ir);
		ctx.selectionStore.getState().setSelection(["rectA"]);
		render(
			<CanvasStudioContext.Provider value={ctx}>
				<CanvasTransformer />
			</CanvasStudioContext.Provider>,
		);
		// Begin a drag: nodeStarts changes draggedKey → the rebind effect runs
		// and re-renders (the mock builds a fresh transformer each render).
		act(() => {
			ctx.draftStore.getState().setDraft({
				type: "move",
				startX: 0,
				startY: 0,
				currentX: 0,
				currentY: 0,
				nodeStarts: [{ id: "rectA", x: 10, y: 20 }],
			});
		});
		// The transformer ref points at the latest mounted instance; the draft
		// subscription reads `transformerRef.current` fresh on each move.
		const liveTr = transformerCalls.at(-1)?.ref?.current as {
			nodes: ReturnType<typeof vi.fn>;
		};
		const callsAfterStart = liveTr.nodes.mock.calls.length;

		// The drag-layer remount swaps the node instance; the next pointermove
		// (currentX/Y only) does NOT change draggedKey, so it triggers no React
		// re-render — only the synchronous draft subscription can re-point.
		const nodeB = makeNode({ x: 10, y: 20 });
		nodeMap.rectA = nodeB;
		act(() => {
			ctx.draftStore.getState().setDraft({
				type: "move",
				startX: 0,
				startY: 0,
				currentX: 25,
				currentY: 40,
				nodeStarts: [{ id: "rectA", x: 10, y: 20 }],
			});
		});

		// Without the fix, no further .nodes() call happens on a move and the
		// transformer stays bound to the stale nodeA. With the fix it re-points.
		expect(liveTr.nodes.mock.calls.length).toBeGreaterThan(callsAfterStart);
		expect(liveTr.nodes.mock.calls.at(-1)?.[0]).toEqual([nodeB]);
	});

	it("transformend with scale ≠ 1 commits a node.resize", () => {
		transformerCalls.length = 0;
		const ir = fixtureIR();
		// Simulate Konva applying scale 2x to rectA after a transform drag.
		const node = makeNode({ x: 10, y: 20, scaleX: 2, scaleY: 2 });
		const stage = makeFakeStage({ rectA: node });
		const { ctx, commits } = makeCtx(stage, ir);
		ctx.selectionStore.getState().setSelection(["rectA"]);
		render(
			<CanvasStudioContext.Provider value={ctx}>
				<CanvasTransformer />
			</CanvasStudioContext.Provider>,
		);
		const transformerProps = transformerCalls[0]?.props as {
			onTransformEnd: () => void;
		};
		act(() => {
			transformerProps.onTransformEnd();
		});
		const resizeCmds = commits.filter((c) => c.type === "node.resize");
		expect(resizeCmds).toHaveLength(1);
		const cmd = resizeCmds[0] as CanvasNodeResizeCommand;
		expect(cmd.to).toEqual({ x: 10, y: 20, width: 200, height: 100 });
		// Scale must be reset on the Konva node after commit.
		expect((node as unknown as { scaleX: () => number }).scaleX()).toBe(1);
	});

	it("transformend with rotation change commits a node.rotate", () => {
		transformerCalls.length = 0;
		const ir = fixtureIR();
		const node = makeNode({ x: 10, y: 20, rotation: 45 });
		const stage = makeFakeStage({ rectA: node });
		const { ctx, commits } = makeCtx(stage, ir);
		ctx.selectionStore.getState().setSelection(["rectA"]);
		render(
			<CanvasStudioContext.Provider value={ctx}>
				<CanvasTransformer />
			</CanvasStudioContext.Provider>,
		);
		const transformerProps = transformerCalls[0]?.props as {
			onTransformEnd: () => void;
		};
		act(() => {
			transformerProps.onTransformEnd();
		});
		const rotateCmds = commits.filter((c) => c.type === "node.rotate");
		expect(rotateCmds).toHaveLength(1);
		const cmd = rotateCmds[0] as CanvasNodeRotateCommand;
		expect(cmd.to).toBe(45);
	});

	it("transformend with no meaningful change commits nothing", () => {
		transformerCalls.length = 0;
		const ir = fixtureIR();
		const node = makeNode({ x: 10, y: 20 });
		const stage = makeFakeStage({ rectA: node });
		const { ctx, commits } = makeCtx(stage, ir);
		ctx.selectionStore.getState().setSelection(["rectA"]);
		render(
			<CanvasStudioContext.Provider value={ctx}>
				<CanvasTransformer />
			</CanvasStudioContext.Provider>,
		);
		const transformerProps = transformerCalls[0]?.props as {
			onTransformEnd: () => void;
		};
		act(() => {
			transformerProps.onTransformEnd();
		});
		expect(commits).toHaveLength(0);
	});

	it("ellipse resize commits the top-left (Konva center → IR transform), no drift", () => {
		transformerCalls.length = 0;
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
		const ir = createCanvasIR({
			id: "ir-e",
			pages: [page],
			now: () => FIXED_TS,
		});
		// Konva.Ellipse position is its CENTER. After a 2× resize the center sits
		// at (110, 70); the top-left of the 200×100 box is (10, 20).
		const node = makeNode({ x: 110, y: 70, scaleX: 2, scaleY: 2 });
		const stage = makeFakeStage({ ellA: node });
		const { ctx, commits } = makeCtx(stage, ir);
		ctx.selectionStore.getState().setSelection(["ellA"]);
		render(
			<CanvasStudioContext.Provider value={ctx}>
				<CanvasTransformer />
			</CanvasStudioContext.Provider>,
		);
		const transformerProps = transformerCalls[0]?.props as {
			onTransformEnd: () => void;
		};
		act(() => {
			transformerProps.onTransformEnd();
		});
		const resizeCmds = commits.filter((c) => c.type === "node.resize");
		expect(resizeCmds).toHaveLength(1);
		const cmd = resizeCmds[0] as CanvasNodeResizeCommand;
		// Without the center→top-left correction this would be {x:110,y:70,...}.
		expect(cmd.to).toEqual({ x: 10, y: 20, width: 200, height: 100 });
	});

	it("line/path resize persists scale via node.update (bounds-baking would revert)", () => {
		transformerCalls.length = 0;
		const page = createPage({ id: "p1" });
		page.root = createGroup({
			id: "p1-root",
			bounds: page.root.bounds,
			children: [
				createLine({
					id: "lineA",
					points: [0, 0, 100, 0],
					transform: { x: 10, y: 20 },
				}),
			],
		});
		const ir = createCanvasIR({
			id: "ir-l",
			pages: [page],
			now: () => FIXED_TS,
		});
		const node = makeNode({ x: 10, y: 20, scaleX: 2, scaleY: 2 });
		const stage = makeFakeStage({ lineA: node });
		const { ctx, commits } = makeCtx(stage, ir);
		ctx.selectionStore.getState().setSelection(["lineA"]);
		render(
			<CanvasStudioContext.Provider value={ctx}>
				<CanvasTransformer />
			</CanvasStudioContext.Provider>,
		);
		const transformerProps = transformerCalls[0]?.props as {
			onTransformEnd: () => void;
		};
		act(() => {
			transformerProps.onTransformEnd();
		});
		// Geometry-sized nodes persist the scale (the renderer ignores bounds), so
		// the resize is a node.update on the transform — not a node.resize.
		expect(commits.some((c) => c.type === "node.resize")).toBe(false);
		const updates = commits.filter((c) => c.type === "node.update");
		expect(updates).toHaveLength(1);
		const cmd = updates[0] as CanvasAnyNodeUpdateCommand;
		expect(cmd.kind).toBe("line");
		const transform = (cmd.patch as { transform?: Record<string, number> })
			.transform;
		expect(transform).toMatchObject({ x: 10, y: 20, scaleX: 2, scaleY: 2 });
	});
});
