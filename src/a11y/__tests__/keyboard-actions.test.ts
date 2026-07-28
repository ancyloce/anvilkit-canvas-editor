import {
	createCanvasIR,
	createFrame,
	createGroup,
	createPage,
	createRect,
	findNode,
	insertNode,
} from "@anvilkit/canvas-core";
import { describe, expect, it } from "vitest";
import {
	flowReorderCommands,
	nextFocusId,
	nudgeCommand,
	resizeStepCommand,
	rotateStepCommand,
} from "../keyboard-actions.js";

const rect = (id: string, x = 0, y = 0, w = 100, h = 50) =>
	createRect({ id, transform: { x, y }, bounds: { width: w, height: h } });

describe("keyboard-actions — command builders", () => {
	it("nudgeCommand builds a node.move by (dx,dy)", () => {
		expect(nudgeCommand(rect("a", 10, 20), 5, -3)).toEqual({
			type: "node.move",
			nodeId: "a",
			from: { x: 10, y: 20 },
			to: { x: 15, y: 17 },
		});
	});

	it("resizeStepCommand grows bounds and clamps to >=1", () => {
		expect(resizeStepCommand(rect("a", 0, 0, 100, 50), 10, -5).to).toEqual({
			x: 0,
			y: 0,
			width: 110,
			height: 45,
		});
		expect(resizeStepCommand(rect("a", 0, 0, 100, 50), -200, -200).to).toEqual({
			x: 0,
			y: 0,
			width: 1,
			height: 1,
		});
	});

	it("rotateStepCommand adds degrees", () => {
		expect(rotateStepCommand(rect("a"), 15)).toEqual({
			type: "node.rotate",
			nodeId: "a",
			from: 0,
			to: 15,
		});
	});
});

describe("keyboard-actions — nextFocusId", () => {
	const page = {
		root: createGroup({
			id: "root",
			bounds: { width: 0, height: 0 },
			children: [
				rect("a"),
				createGroup({
					id: "g",
					bounds: { width: 0, height: 0 },
					children: [rect("b"), rect("c")],
				}),
				rect("d"),
			],
		}),
	};
	// pre-order: a, g, b, c, d

	it("enters from nothing on ArrowDown/ArrowUp", () => {
		expect(nextFocusId(page, null, "ArrowDown")).toBe("a");
		expect(nextFocusId(page, null, "ArrowUp")).toBe("d");
	});

	it("steps forward in pre-order (into groups)", () => {
		expect(nextFocusId(page, "a", "ArrowDown")).toBe("g");
		expect(nextFocusId(page, "g", "ArrowDown")).toBe("b");
		expect(nextFocusId(page, "c", "ArrowDown")).toBe("d");
	});

	it("steps backward and wraps", () => {
		expect(nextFocusId(page, "b", "ArrowUp")).toBe("g");
		expect(nextFocusId(page, "d", "ArrowDown")).toBe("a"); // wrap end→start
		expect(nextFocusId(page, "a", "ArrowUp")).toBe("d"); // wrap start→end
	});

	it("Escape clears, Enter keeps current", () => {
		expect(nextFocusId(page, "b", "Escape")).toBeNull();
		expect(nextFocusId(page, "b", "Enter")).toBe("b");
	});

	// Frames hold children just like groups; walking only into groups made every
	// node inside a frame unreachable by keyboard focus.
	it("steps into frame children in pre-order", () => {
		const framed = {
			root: createGroup({
				id: "root",
				bounds: { width: 0, height: 0 },
				children: [
					rect("a"),
					createFrame({
						id: "f",
						bounds: { width: 100, height: 100 },
						clip: true,
						children: [rect("b"), rect("c")],
					}),
					rect("d"),
				],
			}),
		};
		// pre-order: a, f, b, c, d
		expect(nextFocusId(framed, "a", "ArrowDown")).toBe("f");
		expect(nextFocusId(framed, "f", "ArrowDown")).toBe("b");
		expect(nextFocusId(framed, "b", "ArrowDown")).toBe("c");
		expect(nextFocusId(framed, "c", "ArrowDown")).toBe("d");
		expect(nextFocusId(framed, "b", "ArrowUp")).toBe("f");
	});
});

describe("keyboard-actions — flowReorderCommands (T-M4-08, TS-37)", () => {
	const LAYOUT = {
		version: 1,
		direction: "horizontal",
		padding: { top: 0, right: 0, bottom: 0, left: 0 },
		gap: 10,
		primaryAlign: "start",
		crossAlign: "start",
	} as const;

	function layoutIr(direction: "horizontal" | "vertical" = "horizontal") {
		const frame = {
			...createFrame({ id: "f1", bounds: { width: 200, height: 100 } }),
			autoLayout: { ...LAYOUT, direction },
			children: [rect("r1"), rect("r2"), rect("r3")],
		};
		const page = createPage({ id: "p1" });
		const ir = createCanvasIR({ id: "doc", pages: [page] });
		return insertNode(ir, { parentId: page.root.id, node: frame });
	}

	function nodeIn(ir: ReturnType<typeof layoutIr>, id: string) {
		const found = findNode(ir, id);
		if (!found) throw new Error(`missing ${id}`);
		return found.node;
	}

	it("primary-axis arrow emits the SAME single node.reorder the drag path commits", () => {
		const ir = layoutIr();
		expect(flowReorderCommands(ir, [nodeIn(ir, "r1")], "ArrowRight")).toEqual([
			{ type: "node.reorder", nodeId: "r1", toIndex: 1 },
		]);
		expect(flowReorderCommands(ir, [nodeIn(ir, "r2")], "ArrowLeft")).toEqual([
			{ type: "node.reorder", nodeId: "r2", toIndex: 0 },
		]);
	});

	it("vertical frames map ArrowUp/ArrowDown instead", () => {
		const ir = layoutIr("vertical");
		expect(flowReorderCommands(ir, [nodeIn(ir, "r1")], "ArrowDown")).toEqual([
			{ type: "node.reorder", nodeId: "r1", toIndex: 1 },
		]);
		expect(flowReorderCommands(ir, [nodeIn(ir, "r1")], "ArrowRight")).toEqual(
			[],
		);
	});

	it("cross-axis arrows are a handled no-op (never a stale nudge)", () => {
		const ir = layoutIr();
		expect(flowReorderCommands(ir, [nodeIn(ir, "r1")], "ArrowDown")).toEqual(
			[],
		);
	});

	it("boundary moves degrade to a handled no-op", () => {
		const ir = layoutIr();
		expect(flowReorderCommands(ir, [nodeIn(ir, "r1")], "ArrowLeft")).toEqual(
			[],
		);
		expect(flowReorderCommands(ir, [nodeIn(ir, "r3")], "ArrowRight")).toEqual(
			[],
		);
	});

	it("returns null for non-flow contexts so the nudge path takes over", () => {
		const ir = layoutIr();
		// Top-level node: parent is the page-root group, not a layout frame.
		const loose = insertNode(ir, {
			parentId: ir.pages[0]?.root.id ?? "",
			node: rect("loose"),
		});
		expect(
			flowReorderCommands(loose, [nodeIn(loose, "loose")], "ArrowRight"),
		).toBeNull();
		// Absolute children opt out of flow.
		const irAbs = (() => {
			const frame = {
				...createFrame({ id: "f1", bounds: { width: 200, height: 100 } }),
				autoLayout: LAYOUT,
				children: [
					{ ...rect("r1"), layoutItem: { positioning: "absolute" as const } },
				],
			};
			const page = createPage({ id: "p1" });
			return insertNode(createCanvasIR({ id: "doc", pages: [page] }), {
				parentId: page.root.id,
				node: frame,
			});
		})();
		expect(
			flowReorderCommands(irAbs, [nodeIn(irAbs, "r1")], "ArrowRight"),
		).toBeNull();
	});
});
