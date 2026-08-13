// @vitest-environment jsdom
import { renderHook } from "@testing-library/react";
import type Konva from "konva";
import { act } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { resetCanvasNodeRegistryForTests } from "@/stage/find-node-by-id.js";
import { createDraftStore } from "@/stores/draft-store.js";
import { useDragLayerPromotion } from "../drag-layer.js";

/**
 * Minimal Konva container: children in z-order, with the `add` / `moveTo` /
 * `setZIndex` semantics `useDragLayerPromotion` depends on. `moveTo` appends —
 * which is exactly why the hook has to restore z-index itself.
 */
function fakeContainer(name: string, stage?: unknown) {
	const container = {
		name: () => name,
		children: [] as FakeNode[],
		getStage: () => (stage ?? container) as Konva.Stage,
		getParent: () => null,
	};
	return container;
}
type FakeContainer = ReturnType<typeof fakeContainer>;

function fakeNode(id: string, parent: FakeContainer) {
	const node = {
		id: () => id,
		getParent: () => node.parent,
		parent: parent as FakeContainer | null,
		getZIndex: () => node.parent?.children.indexOf(node) ?? -1,
		moveTo: vi.fn((next: FakeContainer) => {
			const from = node.parent;
			if (from) from.children.splice(from.children.indexOf(node), 1);
			next.children.push(node);
			node.parent = next;
		}),
		setZIndex: vi.fn((index: number) => {
			const p = node.parent;
			if (!p) return;
			p.children.splice(p.children.indexOf(node), 1);
			p.children.splice(index, 0, node);
		}),
	};
	parent.children.push(node);
	return node;
}
type FakeNode = ReturnType<typeof fakeNode>;

function setup(ids: string[]) {
	const objects = fakeContainer("objects");
	const dragLayer = fakeContainer("drag");
	const nodes = ids.map((id) => fakeNode(id, objects));
	const stage = {
		getLayers: () => [dragLayer],
		batchDraw: vi.fn(),
		findOne: (selector: (n: Konva.Node) => boolean) =>
			[...objects.children, ...dragLayer.children].find((n) =>
				selector(n as unknown as Konva.Node),
			),
	} as unknown as Konva.Stage;
	// The containers report this stage so the hook's liveness checks pass.
	objects.getStage = () => stage;
	dragLayer.getStage = () => stage;
	return { stage, objects, dragLayer, nodes };
}

const moveDraft = (ids: string[], travelled = true) => ({
	type: "move" as const,
	startX: 0,
	startY: 0,
	currentX: travelled ? 25 : 0,
	currentY: travelled ? 40 : 0,
	nodeStarts: ids.map((id) => ({ id, x: 0, y: 0 })),
});

beforeEach(() => {
	resetCanvasNodeRegistryForTests();
});

describe("useDragLayerPromotion (K-4)", () => {
	it("moves a dragged node onto the drag layer and back, without destroying it", () => {
		const { stage, objects, dragLayer, nodes } = setup(["a", "b"]);
		const draftStore = createDraftStore();
		renderHook(() => useDragLayerPromotion(stage, draftStore));

		act(() => {
			draftStore.getState().setDraft(moveDraft(["b"]));
		});
		expect(dragLayer.children.map((n) => n.id())).toEqual(["b"]);
		expect(objects.children.map((n) => n.id())).toEqual(["a"]);

		act(() => {
			draftStore.getState().clearDraft();
		});
		expect(dragLayer.children).toHaveLength(0);
		expect(objects.children.map((n) => n.id())).toEqual(["a", "b"]);
		// The SAME instance came back — that is the whole point of K-4.
		expect(objects.children[1]).toBe(nodes[1]);
	});

	it("restores the original z-index rather than stacking on top", () => {
		// `moveTo` appends, so a node dragged out of the MIDDLE would come back
		// on top and silently reorder the document.
		const { stage, objects, dragLayer } = setup(["a", "b", "c"]);
		const draftStore = createDraftStore();
		renderHook(() => useDragLayerPromotion(stage, draftStore));

		act(() => {
			draftStore.getState().setDraft(moveDraft(["b"]));
		});
		expect(dragLayer.children.map((n) => n.id())).toEqual(["b"]);

		act(() => {
			draftStore.getState().clearDraft();
		});
		expect(objects.children.map((n) => n.id())).toEqual(["a", "b", "c"]);
	});

	it("preserves relative stacking for a multi-node drag", () => {
		const { stage, objects, dragLayer } = setup(["a", "b", "c", "d"]);
		const draftStore = createDraftStore();
		renderHook(() => useDragLayerPromotion(stage, draftStore));

		// Requested out of z-order on purpose: the hook sorts before promoting.
		act(() => {
			draftStore.getState().setDraft(moveDraft(["c", "a"]));
		});
		expect(dragLayer.children.map((n) => n.id())).toEqual(["a", "c"]);

		act(() => {
			draftStore.getState().clearDraft();
		});
		expect(objects.children.map((n) => n.id())).toEqual(["a", "b", "c", "d"]);
	});

	it("does not promote a click that has not travelled past the drag threshold", () => {
		// `selectTool.onPointerDown` opens a move draft on EVERY click, including
		// a pure selection click.
		const { stage, dragLayer } = setup(["a"]);
		const draftStore = createDraftStore();
		renderHook(() => useDragLayerPromotion(stage, draftStore));

		act(() => {
			draftStore.getState().setDraft(moveDraft(["a"], false));
		});
		expect(dragLayer.children).toHaveLength(0);
	});

	it("promotes once per gesture, not once per pointermove", () => {
		const { stage, nodes } = setup(["a"]);
		const draftStore = createDraftStore();
		renderHook(() => useDragLayerPromotion(stage, draftStore));

		act(() => {
			draftStore.getState().setDraft(moveDraft(["a"]));
		});
		const afterStart = nodes[0]?.moveTo.mock.calls.length;
		for (const currentX of [30, 35, 40]) {
			act(() => {
				draftStore
					.getState()
					.setDraft({ ...moveDraft(["a"]), currentX, currentY: 40 });
			});
		}
		expect(nodes[0]?.moveTo.mock.calls.length).toBe(afterStart);
	});

	it("puts promoted nodes back when the hook unmounts mid-drag", () => {
		const { stage, objects, dragLayer } = setup(["a", "b"]);
		const draftStore = createDraftStore();
		const { unmount } = renderHook(() =>
			useDragLayerPromotion(stage, draftStore),
		);

		act(() => {
			draftStore.getState().setDraft(moveDraft(["a"]));
		});
		expect(dragLayer.children).toHaveLength(1);

		unmount();
		// Never leave the scene graph rearranged behind us.
		expect(dragLayer.children).toHaveLength(0);
		expect(objects.children.map((n) => n.id())).toEqual(["a", "b"]);
	});

	it("skips a node destroyed mid-drag instead of throwing", () => {
		// An undo or a remote collab write can destroy the dragged node while the
		// pointer is still down; Konva clears `parent` on destroy.
		const { stage, dragLayer, nodes } = setup(["a"]);
		const draftStore = createDraftStore();
		renderHook(() => useDragLayerPromotion(stage, draftStore));

		act(() => {
			draftStore.getState().setDraft(moveDraft(["a"]));
		});
		const dragged = nodes[0];
		if (!dragged) throw new Error("fixture");
		dragLayer.children.length = 0;
		dragged.parent = null;

		expect(() => {
			act(() => {
				draftStore.getState().clearDraft();
			});
		}).not.toThrow();
	});
});
