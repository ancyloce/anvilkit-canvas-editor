// @vitest-environment node
// Pure logic test (fake Konva nodes, no DOM) — runs under the node environment.
import type Konva from "konva";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
	canvasNodeRef,
	findNodeById,
	resetCanvasNodeRegistryForTests,
} from "../find-node-by-id.js";

/**
 * Minimal Konva node: an id and a parent chain, which is all `findNodeById`
 * walks. `parent` is assignable so a test can detach a node the way `destroy()`
 * effectively does.
 */
function fakeNode(id: string, parent: unknown = null) {
	const node = {
		id: () => id,
		getParent: () => node.parent as Konva.Node | null,
		parent,
	};
	return node as typeof node & Konva.Node;
}

/** Container that records whether the fallback tree scan was reached. */
function fakeContainer(children: ReturnType<typeof fakeNode>[] = []) {
	const findOne = vi.fn((selector: (node: Konva.Node) => boolean) =>
		children.find((c) => selector(c as unknown as Konva.Node)),
	);
	return { findOne } as unknown as Pick<Konva.Container, "findOne"> & {
		findOne: ReturnType<typeof vi.fn>;
	};
}

beforeEach(() => {
	resetCanvasNodeRegistryForTests();
});

describe("findNodeById", () => {
	it("resolves through the registry without scanning the tree", () => {
		const stage = fakeContainer();
		const node = fakeNode("n1", stage);
		canvasNodeRef("n1")(node);

		expect(findNodeById(stage, "n1")).toBe(node);
		// The whole point of K-6: no `Container.findOne`, which is a full
		// depth-first walk (`_generalFind`) and used to run once per selected
		// node per pointermove.
		expect(stage.findOne).not.toHaveBeenCalled();
	});

	it("resolves a node nested several levels under the container", () => {
		const stage = fakeContainer();
		const layer = fakeNode("layer", stage);
		const group = fakeNode("group", layer);
		const leaf = fakeNode("leaf", group);
		canvasNodeRef("leaf")(leaf);

		expect(findNodeById(stage, "leaf")).toBe(leaf);
		expect(stage.findOne).not.toHaveBeenCalled();
	});

	it("falls back to the tree scan for an unregistered id", () => {
		const orphan = fakeNode("ghost");
		const stage = fakeContainer([orphan]);

		expect(findNodeById(stage, "ghost")).toBe(orphan);
		expect(stage.findOne).toHaveBeenCalledTimes(1);
	});

	// The reason the registry stores a LIST per id rather than one node.
	// `rasterizePage` mounts an off-screen stage for thumbnails and exports
	// while the live stage is showing the same page, so the same
	// `CanvasNode.id` is legitimately mounted twice at once. Resolving a
	// live-stage lookup to the off-screen instance would be a far worse bug
	// than the cost this registry removes.
	it("never returns a node belonging to a different stage", () => {
		const liveStage = fakeContainer();
		const offscreenStage = fakeContainer();
		const liveNode = fakeNode("shared", liveStage);
		const offscreenNode = fakeNode("shared", offscreenStage);
		// Off-screen registers FIRST, so a naive last-write-wins or first-hit
		// map would hand it to the live-stage lookup below.
		canvasNodeRef("shared")(offscreenNode);
		canvasNodeRef("shared")(liveNode);

		expect(findNodeById(liveStage, "shared")).toBe(liveNode);
		expect(findNodeById(offscreenStage, "shared")).toBe(offscreenNode);
	});

	it("stops resolving a node once its ref cleanup has run", () => {
		const stage = fakeContainer();
		const node = fakeNode("n1", stage);
		const cleanup = canvasNodeRef("n1")(node);
		expect(findNodeById(stage, "n1")).toBe(node);

		// React 19 calls the returned cleanup on detach.
		expect(typeof cleanup).toBe("function");
		(cleanup as () => void)();

		expect(findNodeById(stage, "n1")).toBeUndefined();
		expect(stage.findOne).toHaveBeenCalledTimes(1);
	});

	it("clears the id when detached the pre-cleanup way (ref called with null)", () => {
		const stage = fakeContainer();
		const node = fakeNode("n1", stage);
		canvasNodeRef("n1")(node);
		canvasNodeRef("n1")(null);

		expect(findNodeById(stage, "n1")).toBeUndefined();
	});

	// A node destroyed outside React's knowledge leaves a stale entry. It must
	// not be returned for a container it no longer belongs to — the parent-walk
	// proof is what makes the registry safe to treat as an index rather than
	// the source of truth.
	it("ignores a stale registration whose node is no longer attached", () => {
		const stage = fakeContainer();
		const node = fakeNode("n1", stage);
		canvasNodeRef("n1")(node);
		node.parent = null;

		expect(findNodeById(stage, "n1")).toBeUndefined();
		expect(stage.findOne).toHaveBeenCalledTimes(1);
	});

	it("hands back one stable callback per id so React never re-attaches", () => {
		expect(canvasNodeRef("same")).toBe(canvasNodeRef("same"));
		expect(canvasNodeRef("a")).not.toBe(canvasNodeRef("b"));
	});
});
