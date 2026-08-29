import {
	type CanvasGroupNode,
	type CanvasIR,
	type CanvasNode,
	createCanvasIR,
	createGroup,
	createPage,
	createRect,
} from "@anvilkit/canvas-core";
import { describe, expect, it, vi } from "vitest";
import * as Y from "yjs";
import { createSceneStore } from "../../stores/scene-store.js";
import { createCanvasYjsBinding } from "../binding.js";

function fixture(): CanvasIR {
	return createCanvasIR({
		id: "undo-doc",
		pages: [
			createPage({
				id: "page-1",
				root: createGroup({
					id: "page-1-root",
					bounds: { width: 800, height: 600 },
					children: [
						createRect({
							id: "rect-a",
							bounds: { width: 80, height: 40 },
							fill: "#ff0000",
						}),
						createRect({
							id: "rect-b",
							bounds: { width: 90, height: 45 },
							fill: "#00ff00",
						}),
					],
				}),
			}),
		],
		now: () => "2026-08-28T00:00:00.000Z",
	});
}

function findNode(ir: CanvasIR, id: string): CanvasNode | undefined {
	const stack: CanvasNode[] = ir.pages.map((page) => page.root);
	while (stack.length > 0) {
		const node = stack.pop() as CanvasNode;
		if (node.id === id) return node;
		stack.push(...((node as CanvasGroupNode).children ?? []));
	}
	return undefined;
}

function linkDocs(a: Y.Doc, b: Y.Doc): void {
	a.on("updateV2", (update, origin) => {
		if (origin !== "replicate") Y.applyUpdateV2(b, update, "replicate");
	});
	b.on("updateV2", (update, origin) => {
		if (origin !== "replicate") Y.applyUpdateV2(a, update, "replicate");
	});
}

describe("Canvas collaborative undo/redo", () => {
	it("undoes only local-origin work and preserves unrelated remote changes", () => {
		const docA = new Y.Doc();
		const docB = new Y.Doc();
		linkDocs(docA, docB);
		const storeA = createSceneStore({ initialIR: fixture() });
		const storeB = createSceneStore({ initialIR: createCanvasIR({ id: "b" }) });
		const bindingA = createCanvasYjsBinding({
			doc: docA,
			sceneStore: storeA,
			peer: { id: "alice" },
			undo: { captureTimeout: 0 },
		});
		const bindingB = createCanvasYjsBinding({
			doc: docB,
			sceneStore: storeB,
			peer: { id: "bob" },
		});

		const stackChanged = vi.fn();
		const unsubscribe = bindingA.onUndoStackChange(stackChanged);
		const local = structuredClone(storeA.getState().ir);
		const localRect = findNode(local, "rect-a") as CanvasNode & {
			fill?: string;
		};
		localRect.fill = "#111111";
		storeA.getState().setIR(local);
		expect(bindingA.canUndo()).toBe(true);
		const stackEventsAfterLocal = stackChanged.mock.calls.length;

		const remote = structuredClone(storeB.getState().ir);
		const remoteRect = findNode(remote, "rect-b") as CanvasNode & {
			opacity?: number;
		};
		remoteRect.opacity = 0.5;
		storeB.getState().setIR(remote);
		expect(stackChanged).toHaveBeenCalledTimes(stackEventsAfterLocal);

		bindingA.undo();
		expect(findNode(storeA.getState().ir, "rect-a")).toMatchObject({
			fill: "#ff0000",
		});
		expect(findNode(storeA.getState().ir, "rect-b")).toMatchObject({
			opacity: 0.5,
		});
		expect(storeB.getState().ir).toEqual(storeA.getState().ir);
		expect(bindingA.canRedo()).toBe(true);

		bindingA.redo();
		expect(findNode(storeA.getState().ir, "rect-a")).toMatchObject({
			fill: "#111111",
		});
		expect(findNode(storeA.getState().ir, "rect-b")).toMatchObject({
			opacity: 0.5,
		});

		unsubscribe();
		bindingA.destroy();
		bindingB.destroy();
	});

	it("keeps the controller inert when undo is not enabled", () => {
		const binding = createCanvasYjsBinding({
			doc: new Y.Doc(),
			sceneStore: createSceneStore({ initialIR: fixture() }),
			peer: { id: "local" },
		});

		expect(binding.canUndo()).toBe(false);
		expect(binding.canRedo()).toBe(false);
		expect(() => {
			binding.undo();
			binding.redo();
			binding.clearUndo();
		}).not.toThrow();

		binding.destroy();
	});
});
