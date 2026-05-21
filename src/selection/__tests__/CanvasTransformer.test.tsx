import type {
	CanvasIR,
	CanvasNodeResizeCommand,
	CanvasNodeRotateCommand,
} from "@anvilkit/canvas-core";
import {
	createCanvasIR,
	createGroup,
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
import { createSelectionStore } from "../../stores/selection-store.js";
import { createToolStore } from "../../stores/tool-store.js";
import { createViewportStore } from "../../stores/viewport-store.js";
import { CanvasTransformer } from "../CanvasTransformer.js";

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
		getIR: () => ir,
		commit: vi.fn((cmd) => {
			commits.push(cmd);
			return ir;
		}),
		pickAsset: () => Promise.resolve(""),
		stage,
		activePageId: "p1",
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
});
