import type { CanvasNode } from "@anvilkit/canvas-core";
import { createRect } from "@anvilkit/canvas-core";
import type Konva from "konva";
import { describe, expect, it } from "vitest";
import { collectTransformEndCommands } from "../transformer-helpers.js";

/**
 * T-M4-07 (TS-36) — resize semantics for layout-governed nodes: a resized
 * Hug/Fill axis converts to Fixed at the gesture size measured against the
 * RESOLVED baseline; the untouched axis keeps its mode; no resolved provider
 * (or an all-Fixed item) keeps the legacy `node.resize` path bit-for-bit.
 */

function fakeKnode(opts: {
	id: string;
	x: number;
	y: number;
	scaleX: number;
	scaleY: number;
}) {
	let sx = opts.scaleX;
	let sy = opts.scaleY;
	return {
		id: () => opts.id,
		name: () => opts.id,
		x: () => opts.x,
		y: () => opts.y,
		rotation: () => 0,
		scaleX: (v?: number) => (v === undefined ? sx : (sx = v)),
		scaleY: (v?: number) => (v === undefined ? sy : (sy = v)),
	};
}

function fakeStage(knode: ReturnType<typeof fakeKnode>): Konva.Stage {
	return {
		findOne: (selector: (node: { id(): string }) => boolean) =>
			selector(knode) ? (knode as unknown as Konva.Node) : null,
	} as unknown as Konva.Stage;
}

function hugNode(): CanvasNode {
	return {
		...createRect({
			id: "n1",
			transform: { x: 10, y: 20 },
			bounds: { width: 100, height: 50 },
		}),
		layoutItem: { widthSizing: "hug" as const },
	} as CanvasNode;
}

describe("collectTransformEndCommands — layout resize (TS-36)", () => {
	it("converts a resized Hug width to Fixed at the resolved-baseline size, height untouched", () => {
		const knode = fakeKnode({ id: "n1", x: 10, y: 20, scaleX: 1.5, scaleY: 1 });
		const node = hugNode();
		const cmds = collectTransformEndCommands(
			fakeStage(knode),
			["n1"],
			new Map([["n1", node]]),
			// Resolved (on-screen) width is 120, not the stale stored 100.
			() => ({ width: 120, height: 50 }),
		);
		expect(cmds).toEqual([
			{
				type: "node.update",
				nodeId: "n1",
				kind: "rect",
				patch: {
					bounds: { width: 180, height: 50 },
					transform: { x: 10, y: 20, rotation: 0, scaleX: 1, scaleY: 1 },
					layoutItem: { widthSizing: "fixed" },
				},
			},
		]);
		// The Konva scale was baked and reset for the next gesture.
		expect(knode.scaleX()).toBe(1);
	});

	it("an untouched Hug axis emits no conversion when only the Fixed axis resizes", () => {
		const knode = fakeKnode({ id: "n1", x: 10, y: 20, scaleX: 1, scaleY: 2 });
		const node = hugNode();
		const cmds = collectTransformEndCommands(
			fakeStage(knode),
			["n1"],
			new Map([["n1", node]]),
			() => ({ width: 120, height: 50 }),
		);
		expect(cmds).toEqual([
			{
				type: "node.update",
				nodeId: "n1",
				kind: "rect",
				patch: {
					bounds: { width: 120, height: 100 },
					transform: { x: 10, y: 20, rotation: 0, scaleX: 1, scaleY: 1 },
				},
			},
		]);
	});

	it("falls back to the legacy node.resize path without a resolved provider", () => {
		const knode = fakeKnode({ id: "n1", x: 10, y: 20, scaleX: 1.5, scaleY: 1 });
		const node = hugNode();
		const cmds = collectTransformEndCommands(
			fakeStage(knode),
			["n1"],
			new Map([["n1", node]]),
		);
		expect(cmds).toEqual([
			{
				type: "node.resize",
				nodeId: "n1",
				from: { x: 10, y: 20, width: 100, height: 50 },
				to: { x: 10, y: 20, width: 150, height: 50 },
			},
		]);
	});

	it("an all-Fixed layoutItem keeps the legacy path even with a resolved provider", () => {
		const knode = fakeKnode({ id: "n1", x: 10, y: 20, scaleX: 2, scaleY: 1 });
		const node = {
			...hugNode(),
			layoutItem: { widthSizing: "fixed" as const },
		} as CanvasNode;
		const cmds = collectTransformEndCommands(
			fakeStage(knode),
			["n1"],
			new Map([["n1", node]]),
			() => ({ width: 120, height: 50 }),
		);
		expect(cmds).toEqual([
			{
				type: "node.resize",
				nodeId: "n1",
				from: { x: 10, y: 20, width: 100, height: 50 },
				to: { x: 10, y: 20, width: 200, height: 50 },
			},
		]);
	});
});
