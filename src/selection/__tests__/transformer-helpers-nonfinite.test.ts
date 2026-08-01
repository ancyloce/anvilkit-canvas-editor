import type { CanvasNode } from "@anvilkit/canvas-core";
import { createEllipse, createRect } from "@anvilkit/canvas-core";
import type Konva from "konva";
import { describe, expect, it } from "vitest";
import { collectTransformEndCommands } from "../transformer-helpers.js";

/**
 * A gesture frame whose live Konva transform is non-finite must never be
 * committed. Konva's numeric validators warn but STORE the bad value, so once
 * its Transformer's bounding-box inversion goes singular the values read back
 * off the stage ARE the corruption — committing them writes `NaN` geometry into
 * the document, which then warns on every later render
 * (`NaN is a not valid value for "rotation"`) and re-poisons every subsequent
 * gesture on that node.
 */

interface FakeKnode {
	id: () => string;
	x: (v?: number) => number | void;
	y: (v?: number) => number | void;
	rotation: (v?: number) => number | void;
	scaleX: (v?: number) => number | void;
	scaleY: (v?: number) => number | void;
	readonly state: {
		x: number;
		y: number;
		rotation: number;
		scaleX: number;
		scaleY: number;
	};
}

function fakeKnode(opts: {
	id: string;
	x?: number;
	y?: number;
	rotation?: number;
	scaleX?: number;
	scaleY?: number;
}): FakeKnode {
	const state = {
		x: opts.x ?? 0,
		y: opts.y ?? 0,
		rotation: opts.rotation ?? 0,
		scaleX: opts.scaleX ?? 1,
		scaleY: opts.scaleY ?? 1,
	};
	const accessor = (key: keyof typeof state) => (v?: number) => {
		if (v === undefined) return state[key];
		state[key] = v;
	};
	return {
		id: () => opts.id,
		x: accessor("x"),
		y: accessor("y"),
		rotation: accessor("rotation"),
		scaleX: accessor("scaleX"),
		scaleY: accessor("scaleY"),
		state,
	};
}

function fakeStage(knode: FakeKnode): Konva.Stage {
	return {
		findOne: (selector: (node: { id(): string }) => boolean) =>
			selector(knode) ? (knode as unknown as Konva.Node) : null,
	} as unknown as Konva.Stage;
}

describe("collectTransformEndCommands — non-finite gesture frames", () => {
	const node = (): CanvasNode =>
		createRect({
			id: "n1",
			transform: { x: 10, y: 20, rotation: 30 },
			bounds: { width: 100, height: 50 },
		});

	it.each([
		["scaleX", { scaleX: Number.NaN }],
		["scaleY", { scaleY: Number.NaN }],
		["x", { x: Number.NaN }],
		["y", { y: Number.NaN }],
		["rotation", { rotation: Number.NaN }],
		["infinite scaleX", { scaleX: Number.POSITIVE_INFINITY }],
	])("commits nothing when live %s is non-finite", (_label, overrides) => {
		const knode = fakeKnode({ id: "n1", x: 10, y: 20, ...overrides });
		const cmds = collectTransformEndCommands(
			fakeStage(knode),
			["n1"],
			new Map([["n1", node()]]),
		);
		expect(cmds).toEqual([]);
	});

	it("resets the live node to the IR transform so the stage stops showing NaN", () => {
		const knode = fakeKnode({ id: "n1", x: Number.NaN, scaleX: Number.NaN });
		collectTransformEndCommands(
			fakeStage(knode),
			["n1"],
			new Map([["n1", node()]]),
		);
		expect(knode.state).toEqual({
			x: 10,
			y: 20,
			rotation: 30,
			scaleX: 1,
			scaleY: 1,
		});
	});

	/**
	 * A centred kind (`Konva.Ellipse` positions by its CENTRE) must come back to
	 * `transform + bounds/2`, not to the bare IR transform, or discarding the
	 * gesture would itself shift the node by half its size.
	 */
	it("restores a centred kind through the render offset", () => {
		const knode = fakeKnode({ id: "e1", rotation: Number.NaN });
		const ellipse = createEllipse({
			id: "e1",
			transform: { x: 10, y: 20 },
			bounds: { width: 100, height: 50 },
		});
		collectTransformEndCommands(
			fakeStage(knode),
			["e1"],
			new Map([["e1", ellipse]]),
		);
		expect(knode.state.x).toBe(60);
		expect(knode.state.y).toBe(45);
	});

	/**
	 * The regression this guard exists for: with a layout-governed (Hug/Fill)
	 * node the elastic branch tests `plan.layoutItem` for truthiness rather than
	 * comparing numbers, so a `NaN` scale used to commit `NaN` bounds — every
	 * `Math.abs(NaN - x) > EPSILON` check around it silently passing as "no
	 * change".
	 */
	it("commits nothing for a layout-governed node on a NaN frame", () => {
		const knode = fakeKnode({ id: "n1", x: 10, y: 20, scaleX: Number.NaN });
		const hug = {
			...node(),
			layoutItem: { widthSizing: "hug" as const },
		} as CanvasNode;
		const cmds = collectTransformEndCommands(
			fakeStage(knode),
			["n1"],
			new Map([["n1", hug]]),
			() => ({ width: 120, height: 50 }),
		);
		expect(cmds).toEqual([]);
	});
});
