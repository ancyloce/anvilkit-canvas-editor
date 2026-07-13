import {
	type CanvasFrameNode,
	type CanvasGroupNode,
	type CanvasNode,
	createFrame,
	createGroup,
	createPage,
	createRect,
} from "@anvilkit/canvas-core";
import { describe, expect, it } from "vitest";
import { clonePage, regenerateIds } from "../clone-page.js";

describe("regenerateIds", () => {
	it("rewrites id on a leaf node", () => {
		const node: CanvasNode = createRect({
			id: "rectA",
			bounds: { width: 10, height: 10 },
		});
		const oldId = node.id;
		const result = regenerateIds(node);
		expect(result.id).not.toBe(oldId);
		expect(result.id).toBeTruthy();
	});

	it("recursively rewrites ids on group children", () => {
		const child1 = createRect({
			id: "c1",
			bounds: { width: 5, height: 5 },
		});
		const child2 = createRect({
			id: "c2",
			bounds: { width: 5, height: 5 },
		});
		const group = createGroup({
			id: "g",
			bounds: { width: 50, height: 50 },
			children: [child1, child2],
		});
		const oldGroupId = group.id;
		const oldChildIds = [child1.id, child2.id];
		regenerateIds(group);
		expect(group.id).not.toBe(oldGroupId);
		expect(group.children[0]?.id).not.toBe(oldChildIds[0]);
		expect(group.children[1]?.id).not.toBe(oldChildIds[1]);
	});

	// A frame is a container too. Recursing only into groups left every node
	// inside a frame carrying its ORIGINAL id, so cloning a page produced
	// duplicate ids across two pages.
	it("recursively rewrites ids on frame children", () => {
		const child = createRect({ id: "fc1", bounds: { width: 5, height: 5 } });
		const frame = createFrame({
			id: "f",
			bounds: { width: 50, height: 50 },
			clip: true,
			children: [child],
		});
		regenerateIds(frame);
		expect(frame.id).not.toBe("f");
		expect(frame.children[0]?.id).not.toBe("fc1");
	});

	it("recurses through a frame nested inside a group", () => {
		const leaf = createRect({ id: "deep", bounds: { width: 1, height: 1 } });
		const group = createGroup({
			id: "g",
			bounds: { width: 50, height: 50 },
			children: [
				createFrame({
					id: "f",
					bounds: { width: 20, height: 20 },
					children: [leaf],
				}),
			],
		});
		regenerateIds(group);
		const frame = group.children[0] as CanvasFrameNode;
		expect(frame.id).not.toBe("f");
		expect(frame.children[0]?.id).not.toBe("deep");
	});
});

describe("clonePage", () => {
	function fixture() {
		const page = createPage({ id: "p1", name: "First" });
		page.root = createGroup({
			id: "p1-root",
			bounds: page.root.bounds,
			children: [
				createRect({
					id: "r1",
					bounds: { width: 10, height: 10 },
					transform: { x: 100, y: 200 },
					fill: "#abc",
				}),
				createRect({
					id: "r2",
					bounds: { width: 20, height: 20 },
				}),
			],
		});
		return page;
	}

	it("returns a new page with a fresh id", () => {
		const original = fixture();
		const cloned = clonePage(original);
		expect(cloned.id).not.toBe(original.id);
		expect(cloned).not.toBe(original);
	});

	it("defaults the name to `<original.name> copy`", () => {
		const original = fixture();
		const cloned = clonePage(original);
		expect(cloned.name).toBe("First copy");
	});

	it("falls back to `Page copy` when original has no name", () => {
		const original = createPage({ id: "p1" });
		const cloned = clonePage(original);
		expect(cloned.name).toBe("Page copy");
	});

	it("honors explicit name override", () => {
		const original = fixture();
		const cloned = clonePage(original, { name: "Override" });
		expect(cloned.name).toBe("Override");
	});

	it("regenerates ids for every descendant node", () => {
		const original = fixture();
		const originalChildIds = original.root.children.map((c) => c.id);
		const cloned = clonePage(original);
		expect(cloned.root.id).not.toBe(original.root.id);
		const clonedChildIds = (cloned.root as CanvasGroupNode).children.map(
			(c) => c.id,
		);
		expect(clonedChildIds[0]).not.toBe(originalChildIds[0]);
		expect(clonedChildIds[1]).not.toBe(originalChildIds[1]);
		expect(clonedChildIds[0]).not.toBe(clonedChildIds[1]);
	});

	it("preserves transforms, bounds, and other node fields", () => {
		const original = fixture();
		const cloned = clonePage(original);
		const clonedRect = (cloned.root as CanvasGroupNode).children[0] as {
			transform: { x: number; y: number };
			bounds: { width: number; height: number };
			fill?: string;
		};
		expect(clonedRect.transform).toEqual({
			x: 100,
			y: 200,
			rotation: 0,
			scaleX: 1,
			scaleY: 1,
		});
		expect(clonedRect.bounds).toEqual({ width: 10, height: 10 });
		expect(clonedRect.fill).toBe("#abc");
	});

	it("does not mutate the original page", () => {
		const original = fixture();
		const snapshot = structuredClone(original);
		clonePage(original);
		expect(original).toEqual(snapshot);
	});
});
