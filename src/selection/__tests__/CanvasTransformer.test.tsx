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
	createStar,
} from "@anvilkit/canvas-core";
import { act, render } from "@testing-library/react";
import type Konva from "konva";
import { describe, expect, it, vi } from "vitest";
import {
	CanvasStudioContext,
	type CanvasStudioContextValue,
} from "@/context/canvas-studio-context.js";
import { createDraftStore } from "@/stores/draft-store.js";
import { createEditingStore } from "@/stores/editing-store.js";
import { createGuidesStore } from "@/stores/guides-store.js";
import { createHistoryStore } from "@/stores/history-store.js";
import { createPagesStore } from "@/stores/pages-store.js";
import { createSelectionStore } from "@/stores/selection-store.js";
import { createToolStore } from "@/stores/tool-store.js";
import { createViewportStore } from "@/stores/viewport-store.js";
import { CanvasTransformer } from "../CanvasTransformer.js";
import {
	FALLBACK_CHROME_THEME,
	MIN_DIMENSION,
	normalizeAngle,
	selectionBox,
	setAnchorHovered,
} from "../transformer-helpers.js";

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
	// The rotate-icon + size-badge nodes render inside the same layer; stub them
	// out — the effects guard on the (null) refs, so they never touch a real
	// Konva node.
	Group: () => null,
	Path: () => null,
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
		commitBatch: vi.fn(
			(cmds: Parameters<CanvasStudioContextValue["commit"]>[0][]) => {
				for (const c of cmds) commits.push(c);
				return ir;
			},
		),
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

	it("boundBoxFunc rejects a drag that collapses the box below MIN_DIMENSION", () => {
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
		const transformerProps = transformerCalls[0]?.props as {
			boundBoxFunc: (
				oldBox: { x: number; y: number; width: number; height: number },
				newBox: { x: number; y: number; width: number; height: number },
			) => unknown;
		};
		const { boundBoxFunc } = transformerProps;
		const oldBox = { x: 0, y: 0, width: 100, height: 50 };
		// A drag that would collapse the box to 0 width — the singular-matrix
		// case that makes Konva's own transform inversion produce NaN — is
		// rejected outright, keeping the last valid box.
		const collapsed = { x: 0, y: 0, width: 0, height: 50 };
		expect(boundBoxFunc(oldBox, collapsed)).toBe(oldBox);
		// A box that stays at/above MIN_DIMENSION on both axes is let through.
		const shrunk = { x: 0, y: 0, width: MIN_DIMENSION, height: MIN_DIMENSION };
		expect(boundBoxFunc(oldBox, shrunk)).toBe(shrunk);
	});

	// Fake anchor that records setter calls and matches by name. `activeName`
	// stands in for the Transformer's `_movingAnchorName` (the dragged anchor);
	// `box` stands in for the parent Transformer's getWidth/getHeight (selection
	// size). Both are read via getParent() in anchorStyleFunc.
	const makeAnchor = (
		name: string,
		activeName: string | null = null,
		box: { w: number; h: number } = {
			w: Number.POSITIVE_INFINITY,
			h: Number.POSITIVE_INFINITY,
		},
	) => {
		const state: Record<string, unknown> = {};
		const setter = (key: string) => (v: unknown) => {
			state[key] = v;
		};
		return {
			state,
			name: () => `${name} _anchor`,
			hasName: (n: string) => n === name || n === "_anchor",
			getParent: () => ({
				_movingAnchorName: activeName,
				getWidth: () => box.w,
				getHeight: () => box.h,
			}),
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

	it("drives the selection chrome from the theme tokens (accent border, surface handles)", () => {
		const props = renderTransformer();
		const { accent, surface, border } = FALLBACK_CHROME_THEME;
		// No custom hex — colors come from the resolved theme.
		expect(props.borderStroke).toBe(accent);
		expect(props.anchorStroke).toBe(accent);
		expect(props.anchorFill).toBe(surface);
		expect(props.anchorCornerRadius).toBe(6);
		expect(props.anchorSize).toBe(12);
		expect(props.rotateLineVisible).toBe(false);
		// Rotate handle parked below the box.
		expect(props.rotateAnchorAngle).toBe(180);

		// Rotater → circular surface-filled icon button with a hairline border.
		const rotater = makeAnchor("rotater");
		props.anchorStyleFunc(rotater);
		expect(rotater.state.fill).toBe(surface);
		expect(rotater.state.stroke).toBe(border);
		expect(rotater.state.width).toBe(rotater.state.height); // circle

		// top/bottom-center → horizontal pill (wider than tall), surface at rest.
		const topCenter = makeAnchor("top-center");
		props.anchorStyleFunc(topCenter);
		expect(topCenter.state.fill).toBe(surface);
		expect(topCenter.state.width as number).toBeGreaterThan(
			topCenter.state.height as number,
		);

		// middle-left/right → vertical pill (taller than wide).
		const middleLeft = makeAnchor("middle-left");
		props.anchorStyleFunc(middleLeft);
		expect(middleLeft.state.height as number).toBeGreaterThan(
			middleLeft.state.width as number,
		);

		// Corners keep the circular global style (shape untouched), surface fill.
		const topLeft = makeAnchor("top-left");
		props.anchorStyleFunc(topLeft);
		expect(topLeft.state.width).toBeUndefined();
		expect(topLeft.state.cornerRadius).toBeUndefined();
		expect(topLeft.state.fill).toBe(surface);
	});

	it("hides every dragger but the one being dragged while transforming", () => {
		const props = renderTransformer();
		// Enter transform mode (sets the internal `transformingRef`).
		act(() => {
			props.onTransformStart();
		});

		// The active handle (matching the Transformer's _movingAnchorName) stays
		// visible and takes the accent fill…
		const active = makeAnchor("bottom-center", "bottom-center");
		props.anchorStyleFunc(active);
		expect(active.state.visible).toBe(true);
		expect(active.state.fill).toBe(FALLBACK_CHROME_THEME.accent);

		// …every other handle is hidden.
		const idle = makeAnchor("top-left", "bottom-center");
		props.anchorStyleFunc(idle);
		expect(idle.state.visible).toBe(false);
	});

	it("hides edge handles that don't fit or sit on a too-thin box, keeping corners", () => {
		const props = renderTransformer();

		// Wide and thick enough (height in [THICKNESS, SPAN)): top/bottom-center fit
		// the width and the box isn't too thin → shown.
		const topCenter = makeAnchor("top-center", null, { w: 400, h: 44 });
		props.anchorStyleFunc(topCenter);
		expect(topCenter.state.visible).toBe(true);
		// …left/right don't fit that short height (along-edge too small) → hidden.
		const middleRight = makeAnchor("middle-right", null, { w: 400, h: 44 });
		props.anchorStyleFunc(middleRight);
		expect(middleRight.state.visible).toBe(false);

		// Wide but VERY short: top/bottom still fit the width but the box is too
		// thin across → hidden (this is the reported case).
		const topCenterThin = makeAnchor("top-center", null, { w: 400, h: 24 });
		props.anchorStyleFunc(topCenterThin);
		expect(topCenterThin.state.visible).toBe(false);

		// Tiny box on both axes: every edge handle hidden…
		const topCenterTiny = makeAnchor("top-center", null, { w: 20, h: 20 });
		props.anchorStyleFunc(topCenterTiny);
		expect(topCenterTiny.state.visible).toBe(false);
		// …corners always stay.
		const corner = makeAnchor("top-left", null, { w: 20, h: 20 });
		props.anchorStyleFunc(corner);
		expect(corner.state.visible).toBe(true);
	});

	it("setAnchorHovered tints an anchor with the accent on hover and reverts on leave", () => {
		const { accent, surface } = FALLBACK_CHROME_THEME;
		const anchor = makeAnchor("middle-right");
		const a = anchor as unknown as Parameters<typeof setAnchorHovered>[0];
		setAnchorHovered(a, true, accent, surface);
		expect(anchor.state.fill).toBe(accent);
		setAnchorHovered(a, false, accent, surface);
		expect(anchor.state.fill).toBe(surface);
	});

	it("normalizeAngle maps rotations into the readable (-180, 180] range", () => {
		expect(normalizeAngle(0)).toBe(0);
		expect(normalizeAngle(45)).toBe(45);
		expect(normalizeAngle(180)).toBe(180);
		expect(normalizeAngle(229)).toBe(-131); // matches the reference figure
		expect(normalizeAngle(-200)).toBe(160);
		expect(normalizeAngle(360)).toBe(0);
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

	it("commits a resize for a node NESTED inside a group, not just top-level children (E-3)", () => {
		transformerCalls.length = 0;
		const page = createPage({ id: "p1" });
		page.root = createGroup({
			id: "p1-root",
			bounds: page.root.bounds,
			children: [
				createGroup({
					id: "g1",
					children: [
						createRect({
							id: "nestedRect",
							bounds: { width: 100, height: 50 },
							transform: { x: 10, y: 20 },
						}),
					],
				}),
			],
		});
		const ir = createCanvasIR({
			id: "ir-nested",
			pages: [page],
			now: () => FIXED_TS,
		});
		// Before the fix, `childById` only mapped `page.root.children` (just
		// "g1"), so this nested node's gesture silently produced zero commands
		// even though the transformer visually attached to it.
		const node = makeNode({ x: 10, y: 20, scaleX: 2, scaleY: 2 });
		const stage = makeFakeStage({ nestedRect: node });
		const { ctx, commits } = makeCtx(stage, ir);
		ctx.selectionStore.getState().setSelection(["nestedRect"]);
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
	});

	it("transformend with a near-zero scale floors the committed size at MIN_DIMENSION", () => {
		transformerCalls.length = 0;
		const ir = fixtureIR();
		// A scale this small would commit a near-0×0 size — the singular-box
		// case that makes Konva's transform inversion produce NaN corners on
		// the next selection. `collectTransformEndCommands` floors it instead.
		const node = makeNode({ x: 10, y: 20, scaleX: 0.0001, scaleY: 0.0001 });
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
		expect(cmd.to.width).toBe(MIN_DIMENSION);
		expect(cmd.to.height).toBe(MIN_DIMENSION);
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

	it("a rotate-only gesture on a non-square star does not corrupt its height (E-2)", () => {
		transformerCalls.length = 0;
		const page = createPage({ id: "p1" });
		page.root = createGroup({
			id: "p1-root",
			bounds: page.root.bounds,
			children: [
				createStar({
					id: "starA",
					bounds: { width: 100, height: 50 },
					transform: { x: 10, y: 20 },
				}),
			],
		});
		const ir = createCanvasIR({
			id: "ir-s",
			pages: [page],
			now: () => FIXED_TS,
		});
		// The renderer sets the live Konva scaleY to
		// transform.scaleY(1) * aspectFitScaleY(50/100=0.5) = 0.5 — unchanged by
		// a pure rotation, which never touches scale. Before the fix, reading
		// this composed 0.5 raw and baking it into bounds.height (50 * 0.5)
		// corrupted the committed height to 25 even though nothing was resized.
		// Konva.Star positions by its CENTER (nodeRenderOffset), so x/y are
		// the unchanged center of the 100×50 box: (10+50, 20+25).
		const node = makeNode({
			x: 60,
			y: 45,
			scaleX: 1,
			scaleY: 0.5,
			rotation: 30,
		});
		const stage = makeFakeStage({ starA: node });
		const { ctx, commits } = makeCtx(stage, ir);
		ctx.selectionStore.getState().setSelection(["starA"]);
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
		expect(resizeCmds).toHaveLength(0);
		const rotateCmds = commits.filter((c) => c.type === "node.rotate");
		expect(rotateCmds).toHaveLength(1);
		expect((rotateCmds[0] as CanvasNodeRotateCommand).to).toBe(30);
	});

	it("a real resize on a non-square star bakes the un-composed scale into height (E-2)", () => {
		transformerCalls.length = 0;
		const page = createPage({ id: "p1" });
		page.root = createGroup({
			id: "p1-root",
			bounds: page.root.bounds,
			children: [
				createStar({
					id: "starA",
					bounds: { width: 100, height: 50 },
					transform: { x: 10, y: 20 },
				}),
			],
		});
		const ir = createCanvasIR({
			id: "ir-s2",
			pages: [page],
			now: () => FIXED_TS,
		});
		// A genuine "make it twice as tall" drag: Konva multiplies its CURRENT
		// composed scaleY (0.5) by the drag ratio (2) => raw scaleY 1.0. A
		// symmetric grow-from-center resize keeps the center fixed at (60, 45);
		// the new 100×100 box's center offset is (50, 50), so the committed
		// top-left is (60-50, 45-50) = (10, -5).
		const node = makeNode({ x: 60, y: 45, scaleX: 1, scaleY: 1 });
		const stage = makeFakeStage({ starA: node });
		const { ctx, commits } = makeCtx(stage, ir);
		ctx.selectionStore.getState().setSelection(["starA"]);
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
		// Un-composed: effectiveScaleY = 1.0 / 0.5 = 2 => height 50*2 = 100.
		expect(cmd.to).toEqual({ x: 10, y: -5, width: 100, height: 100 });
	});
});
