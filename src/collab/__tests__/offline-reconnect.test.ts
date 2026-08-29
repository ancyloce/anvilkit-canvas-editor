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
import {
	type CanvasCollabConnectionSource,
	type CanvasCollabConnectionStatus,
	createCanvasYjsBinding,
} from "../binding.js";
import { encodeCanvasIR } from "../encode.js";

function fixture(): CanvasIR {
	return createCanvasIR({
		id: "offline-doc",
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

function rootOf(ir: CanvasIR): CanvasGroupNode {
	return ir.pages[0]?.root as CanvasGroupNode;
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

function controlledConnection(): {
	readonly source: CanvasCollabConnectionSource;
	readonly emit: (status: CanvasCollabConnectionStatus) => void;
	readonly unsubscribed: ReturnType<typeof vi.fn>;
} {
	let drive: (status: CanvasCollabConnectionStatus) => void = () => undefined;
	const unsubscribed = vi.fn();
	return {
		source(emit) {
			drive = emit;
			return unsubscribed;
		},
		emit(status) {
			drive(status);
		},
		unsubscribed,
	};
}

function mergePartition(a: Y.Doc, b: Y.Doc): void {
	const forA = Y.encodeStateAsUpdateV2(b, Y.encodeStateVector(a));
	const forB = Y.encodeStateAsUpdateV2(a, Y.encodeStateVector(b));
	Y.applyUpdateV2(a, forA, "reconnect");
	Y.applyUpdateV2(b, forB, "reconnect");
}

describe("Canvas offline and reconnect behavior", () => {
	it("retains offline work, merges on reconnect, and reports queue state", () => {
		const docA = new Y.Doc();
		const docB = new Y.Doc();
		const connectionA = controlledConnection();
		const connectionB = controlledConnection();
		const storeA = createSceneStore({ initialIR: fixture() });
		const storeB = createSceneStore({ initialIR: createCanvasIR({ id: "b" }) });
		const bindingA = createCanvasYjsBinding({
			doc: docA,
			sceneStore: storeA,
			peer: { id: "alice" },
			connectionSource: connectionA.source,
		});
		Y.applyUpdateV2(docB, Y.encodeStateAsUpdateV2(docA), "initial-sync");
		const bindingB = createCanvasYjsBinding({
			doc: docB,
			sceneStore: storeB,
			peer: { id: "bob" },
			connectionSource: connectionB.source,
		});
		const statesA: string[] = [];
		bindingA.onSyncStateChange((state) => statesA.push(state.kind));

		connectionA.emit({ kind: "synced", since: "2026-08-28T01:00:00Z" });
		connectionB.emit({ kind: "synced", since: "2026-08-28T01:00:00Z" });
		connectionA.emit({ kind: "offline", since: "2026-08-28T01:01:00Z" });
		connectionB.emit({ kind: "offline", since: "2026-08-28T01:01:00Z" });

		const offlineA = structuredClone(storeA.getState().ir);
		rootOf(offlineA).children.push(
			createRect({
				id: "rect-offline-a",
				bounds: { width: 50, height: 25 },
				fill: "#0000ff",
			}),
		);
		storeA.getState().setIR(offlineA);
		const offlineB = structuredClone(storeB.getState().ir);
		const remoteRect = findNode(offlineB, "rect-b") as CanvasNode & {
			opacity?: number;
		};
		remoteRect.opacity = 0.5;
		storeB.getState().setIR(offlineB);

		expect(bindingA.getSyncState()).toMatchObject({
			kind: "offline",
			pendingLocalTransactions: 1,
		});
		expect(bindingB.getSyncState()).toMatchObject({
			kind: "offline",
			pendingLocalTransactions: 1,
		});
		connectionA.emit({ kind: "reconnecting", attempt: 1, backoffMs: 250 });
		connectionB.emit({ kind: "reconnecting", attempt: 1, backoffMs: 250 });

		mergePartition(docA, docB);
		connectionA.emit({ kind: "synced", since: "2026-08-28T01:02:00Z" });
		connectionB.emit({ kind: "synced", since: "2026-08-28T01:02:00Z" });

		const a = bindingA.current() as CanvasIR;
		const b = bindingB.current() as CanvasIR;
		expect(encodeCanvasIR(a)).toBe(encodeCanvasIR(b));
		expect(findNode(a, "rect-offline-a")).toBeDefined();
		expect(findNode(a, "rect-b")).toMatchObject({ opacity: 0.5 });
		const ids = rootOf(a).children.map((node) => node.id);
		expect(new Set(ids).size).toBe(ids.length);
		expect(bindingA.getSyncState()).toMatchObject({
			kind: "synced",
			pendingLocalTransactions: 0,
		});
		expect(statesA).toEqual([
			"connecting",
			"synced",
			"offline",
			"offline",
			"reconnecting",
			"synced",
		]);

		bindingA.destroy();
		bindingB.destroy();
		expect(connectionA.unsubscribed).toHaveBeenCalledOnce();
		expect(connectionB.unsubscribed).toHaveBeenCalledOnce();
	});
});
