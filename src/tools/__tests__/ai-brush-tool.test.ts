import {
	type CanvasIR,
	createCanvasIR,
	createGroup,
	createImage,
	createPage,
	createRect,
} from "@anvilkit/canvas-core";
import type Konva from "konva";
import { describe, expect, it } from "vitest";
import type { AiBrushSelectIntent } from "../ai-intent.js";
import { aiBrushTool } from "../ai-brush-tool.js";
import { makeHarness, pointerEvent } from "./_tool-test-helpers.js";

const FIXED_TS = "2026-05-20T00:00:00.000Z";

function fixtureIR(): CanvasIR {
	const page = createPage({ id: "p1" });
	page.root = createGroup({
		id: "p1-root",
		bounds: page.root.bounds,
		children: [
			createImage({
				id: "imgA",
				bounds: { width: 120, height: 80 },
				transform: { x: 30, y: 40 },
				assetId: "asset-1",
			}),
			createRect({
				id: "rectB",
				bounds: { width: 80, height: 40 },
				transform: { x: 200, y: 300 },
			}),
		],
	});
	return createCanvasIR({ id: "ir-1", pages: [page], now: () => FIXED_TS });
}

function nodeNamed(id: string): Konva.Node {
	return { name: () => id, getParent: () => null } as unknown as Konva.Node;
}

const emptyTarget = nodeNamed("");

describe("aiBrushTool", () => {
	it("selects an image node under the pointer and emits ai-brush-select", () => {
		const h = makeHarness();
		h.ctx.getIR = () => fixtureIR();

		aiBrushTool.onPointerDown?.(
			pointerEvent(50, 60, { target: nodeNamed("imgA") }),
			h.ctx,
		);

		expect(h.ctx.selectionStore.getState().selectedIds).toEqual(["imgA"]);
		expect(h.aiIntents).toHaveLength(1);
		const intent = h.aiIntents[0] as AiBrushSelectIntent;
		expect(intent.kind).toBe("ai-brush-select");
		expect(intent.nodeId).toBe("imgA");
		expect(intent.context).toEqual({
			artboardId: "p1",
			selectedNodeId: "imgA",
			bounds: { x: 30, y: 40, width: 120, height: 80 },
		});
		expect(h.commits).toHaveLength(0); // intent is not a command
	});

	it("ignores non-image nodes (no intent, no selection change)", () => {
		const h = makeHarness();
		h.ctx.getIR = () => fixtureIR();

		aiBrushTool.onPointerDown?.(
			pointerEvent(220, 320, { target: nodeNamed("rectB") }),
			h.ctx,
		);

		expect(h.aiIntents).toHaveLength(0);
		expect(h.ctx.selectionStore.getState().selectedIds).toEqual([]);
	});

	it("ignores clicks on empty stage", () => {
		const h = makeHarness();
		h.ctx.getIR = () => fixtureIR();

		aiBrushTool.onPointerDown?.(
			pointerEvent(900, 900, { target: emptyTarget }),
			h.ctx,
		);

		expect(h.aiIntents).toHaveLength(0);
		expect(h.ctx.selectionStore.getState().selectedIds).toEqual([]);
	});

	it("does not throw when no AI host is wired (requestAiIntent absent)", () => {
		const h = makeHarness();
		h.ctx.getIR = () => fixtureIR();
		h.ctx.requestAiIntent = undefined;

		expect(() =>
			aiBrushTool.onPointerDown?.(
				pointerEvent(50, 60, { target: nodeNamed("imgA") }),
				h.ctx,
			),
		).not.toThrow();
		// Selection still updates even without an AI host.
		expect(h.ctx.selectionStore.getState().selectedIds).toEqual(["imgA"]);
	});
});
