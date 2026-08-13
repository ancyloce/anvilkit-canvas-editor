// @vitest-environment node
// Pure set computation — no DOM, no Konva. The imperative application (and
// its restore discipline) is exercised in ViewportCullingController.test.tsx.
import type { Aabb } from "@anvilkit/canvas-core";
import { describe, expect, it } from "vitest";
import type { StageWindow } from "../stage-window.js";
import {
	CULL_SCREEN_MARGIN,
	computeCulledIds,
	culledSetsEqual,
	stageWindowWorldRect,
} from "../viewport-culling.js";

const WINDOW: StageWindow = { x: 512, y: 1024, width: 1024, height: 768 };

function aabb(minX: number, minY: number, maxX: number, maxY: number): Aabb {
	return { minX, minY, maxX, maxY };
}

describe("stageWindowWorldRect (K-12)", () => {
	it("maps the window box through the inverse stage transform", () => {
		// zoom 2, no pan: stage.x = 0 − 512 = −512, so window-local 0 is
		// world (0 − (−512)) / 2 = 256.
		const rect = stageWindowWorldRect(WINDOW, 0, 0, 2, 0);
		expect(rect).toEqual({
			minX: 256,
			minY: 512,
			maxX: (512 + 1024) / 2,
			maxY: (1024 + 768) / 2,
		});
	});

	it("applies pan and the screen margin", () => {
		const rect = stageWindowWorldRect(WINDOW, 100, -50, 1, CULL_SCREEN_MARGIN);
		// stageX = 100 − 512 = −412 → world minX = (−64 − (−412)) / 1 = 348.
		expect(rect).toEqual({
			minX: 348,
			minY: 1024 + 50 - CULL_SCREEN_MARGIN,
			maxX: 412 + 1024 + CULL_SCREEN_MARGIN,
			maxY: 1024 + 50 + 768 + CULL_SCREEN_MARGIN,
		});
	});

	it("refuses degenerate zoom or pan — no transform, no culling", () => {
		expect(stageWindowWorldRect(WINDOW, 0, 0, 0)).toBe(null);
		expect(stageWindowWorldRect(WINDOW, 0, 0, Number.NaN)).toBe(null);
		expect(stageWindowWorldRect(WINDOW, Number.NaN, 0, 1)).toBe(null);
	});
});

describe("computeCulledIds (K-12)", () => {
	const worldRect = { minX: 0, minY: 0, maxX: 1000, maxY: 1000 };
	const boxes = new Map<string, Aabb>([
		["inside", aabb(100, 100, 200, 200)],
		["straddling", aabb(900, 900, 1100, 1100)],
		["outside", aabb(2000, 2000, 2100, 2100)],
		["far-negative", aabb(-500, -500, -100, -100)],
	]);
	const aabbOf = (id: string) => boxes.get(id);

	it("culls only fully-outside nodes", () => {
		const culled = computeCulledIds({
			nodeIds: ["inside", "straddling", "outside", "far-negative"],
			aabbOf,
			worldRect,
		});
		expect([...culled].sort()).toEqual(["far-negative", "outside"]);
	});

	it("never culls kept ids (selection / drag / editing)", () => {
		const culled = computeCulledIds({
			nodeIds: ["outside", "far-negative"],
			aabbOf,
			worldRect,
			keepIds: new Set(["outside"]),
		});
		expect([...culled]).toEqual(["far-negative"]);
	});

	it("never culls a node with unknown or non-finite geometry", () => {
		const culled = computeCulledIds({
			nodeIds: ["mystery", "poisoned", "outside"],
			aabbOf: (id) =>
				id === "poisoned"
					? aabb(Number.NaN, 0, 10, 10)
					: id === "outside"
						? boxes.get("outside")
						: undefined,
			worldRect,
		});
		expect([...culled]).toEqual(["outside"]);
	});

	it("returns a shared empty set when nothing is culled", () => {
		const a = computeCulledIds({ nodeIds: ["inside"], aabbOf, worldRect });
		const b = computeCulledIds({ nodeIds: [], aabbOf, worldRect });
		expect(a.size).toBe(0);
		// Same reference — callers rely on this for cheap equality.
		expect(a).toBe(b);
	});
});

describe("culledSetsEqual", () => {
	it("compares membership, not identity", () => {
		expect(culledSetsEqual(new Set(["a", "b"]), new Set(["b", "a"]))).toBe(
			true,
		);
		expect(culledSetsEqual(new Set(["a"]), new Set(["a", "b"]))).toBe(false);
		expect(culledSetsEqual(new Set(), new Set())).toBe(true);
	});
});
