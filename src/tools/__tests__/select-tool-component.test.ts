import type {
	CanvasComponentDefinition,
	CanvasIR,
	CanvasNode,
} from "@anvilkit/canvas-core";
import {
	createCanvasIR,
	createFrame,
	createPage,
	createRect,
	encodeResolvedNodeId,
	insertNode,
} from "@anvilkit/canvas-core";
import type Konva from "konva";
import { describe, expect, it } from "vitest";
import { createFieldPreviewStore } from "@/stores/field-preview-store.js";
import { createResolvedDocumentStore } from "@/stores/resolved-document-store.js";
import { createSceneStore } from "@/stores/scene-store.js";
import { selectTool } from "../select-tool.js";
import type { ToolPointerEvent } from "../tool-types.js";
import { makeFakeStage, makeHarness } from "./_tool-test-helpers.js";

/**
 * @file M4-06 / AC-007 gesture integration — single click selects the instance
 * ROOT however deep the pointer landed; double-click opens Instance Scope on the
 * deepest virtual node. Never container isolation: an instance is not a
 * container in the page tree, so `validateIsolationPath` would discard it.
 */

function definition(): CanvasComponentDefinition {
	return {
		id: "cmp-card",
		name: "Card",
		revision: 1,
		properties: [],
		root: {
			...createFrame({ id: "src-root", bounds: { width: 200, height: 80 } }),
			children: [
				createRect({ id: "src-title", bounds: { width: 100, height: 20 } }),
			],
		} as CanvasNode,
	};
}

function doc(): CanvasIR {
	const page = createPage({ id: "p1" });
	let ir = createCanvasIR({ id: "doc", title: "t", pages: [page] });
	ir = insertNode(ir, {
		parentId: page.root.id,
		node: {
			type: "component-instance",
			id: "inst-1",
			source: { kind: "local", componentId: "cmp-card" },
			transform: { x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1 },
			bounds: { width: 200, height: 80 },
		} as CanvasNode,
	});
	return { ...ir, components: { "cmp-card": definition() } };
}

const TITLE_ID = encodeResolvedNodeId({ segments: ["inst-1", "src-title"] });

/** Fake stage chain: the hit shape is the virtual title inside the instance. */
function hitTarget(...deepestFirst: readonly string[]): Konva.Node {
	let node: unknown = null;
	for (const name of [...deepestFirst].reverse()) {
		const parent = node;
		node = { name: () => name, getParent: () => parent };
	}
	return node as Konva.Node;
}

/** A pointer event with an explicit timestamp, so double-click is deterministic. */
function clickAt(target: Konva.Node, timeStamp: number): ToolPointerEvent {
	return {
		evt: { shiftKey: false, timeStamp } as unknown as PointerEvent,
		point: { x: 5, y: 5 },
		screenPoint: { x: 5, y: 5 },
		stage: makeFakeStage(),
		target,
		shiftKey: false,
	};
}

function harnessWithResolution() {
	const ir = doc();
	const h = makeHarness({ ir });
	const sceneStore = createSceneStore({ initialIR: ir });
	const fieldPreviewStore = createFieldPreviewStore();
	const resolvedDocumentStore = createResolvedDocumentStore({
		sceneStore,
		fieldPreviewStore,
	});
	const disconnect = resolvedDocumentStore.connect();
	h.ctx.resolvedDocumentStore = resolvedDocumentStore;
	return { h, disconnect };
}

/**
 * The tool's repeat-click detector is MODULE-level state ("the select tool is a
 * singleton"), so it survives between tests in this file. Each test therefore
 * clicks in its own time window, far enough apart that one test's last click can
 * never read as the next test's first — otherwise the second test's opening
 * click silently counts as a double-click of the first test's.
 */
const WINDOW = 5000;

describe("selectTool — component instances (M4-06)", () => {
	it("single click on a virtual descendant selects the INSTANCE root", () => {
		const { h, disconnect } = harnessWithResolution();
		try {
			selectTool.onPointerDown?.(
				clickAt(hitTarget(TITLE_ID, "inst-1"), WINDOW),
				h.ctx,
			);
			const sel = h.ctx.selectionStore.getState();
			// The instance reads as ONE object: no virtual id anywhere near the
			// persistent selection.
			expect(sel.selectedIds).toEqual(["inst-1"]);
			expect(sel.targets).toEqual([{ kind: "node", nodeId: "inst-1" }]);
		} finally {
			disconnect();
		}
	});

	it("double click opens Instance Scope on the deepest virtual node", () => {
		const { h, disconnect } = harnessWithResolution();
		try {
			const target = hitTarget(TITLE_ID, "inst-1");
			selectTool.onPointerDown?.(clickAt(target, WINDOW * 2), h.ctx);
			selectTool.onPointerDown?.(clickAt(target, WINDOW * 2 + 100), h.ctx);

			const sel = h.ctx.selectionStore.getState();
			expect(sel.targets).toEqual([
				{
					kind: "instance-node",
					instanceId: "inst-1",
					resolvedNodeId: TITLE_ID,
					sourceNodeId: "src-title",
				},
			]);
			// The persistent projection is still the instance — every pre-component
			// consumer sees an ordinary single-node selection.
			expect(sel.selectedIds).toEqual(["inst-1"]);
			// No move draft survives entering scope.
			expect(h.ctx.draftStore.getState().draft).toBeNull();
		} finally {
			disconnect();
		}
	});

	it("does not enter container isolation for an instance", () => {
		const { h, disconnect } = harnessWithResolution();
		try {
			const isolationCalls: string[] = [];
			h.ctx.isolationStore = {
				getState: () => ({
					path: [],
					enter: (id: string) => isolationCalls.push(id),
					exitOne: () => false,
					exitAll: () => undefined,
					setPath: () => undefined,
				}),
				subscribe: () => () => undefined,
				setState: () => undefined,
				getInitialState: () => ({}),
			} as unknown as NonNullable<typeof h.ctx.isolationStore>;

			const target = hitTarget(TITLE_ID, "inst-1");
			selectTool.onPointerDown?.(clickAt(target, WINDOW * 3), h.ctx);
			selectTool.onPointerDown?.(clickAt(target, WINDOW * 3 + 100), h.ctx);

			expect(isolationCalls).toEqual([]);
			expect(h.ctx.selectionStore.getState().targets[0]?.kind).toBe(
				"instance-node",
			);
		} finally {
			disconnect();
		}
	});

	it("falls back to an ordinary instance selection without a resolution", () => {
		// No resolvedDocumentStore at all: the tool must not throw, and a
		// double-click degrades to selecting the instance.
		const h = makeHarness({ ir: doc() });
		const target = hitTarget(TITLE_ID, "inst-1");
		selectTool.onPointerDown?.(clickAt(target, WINDOW * 4), h.ctx);
		selectTool.onPointerDown?.(clickAt(target, WINDOW * 4 + 100), h.ctx);
		expect(h.ctx.selectionStore.getState().selectedIds).toEqual(["inst-1"]);
		expect(h.ctx.selectionStore.getState().targets).toEqual([
			{ kind: "node", nodeId: "inst-1" },
		]);
	});
});
