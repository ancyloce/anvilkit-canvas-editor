import { type CanvasIR, createCanvasIR } from "@anvilkit/canvas-core";
import { applyUpdate, Doc as YDoc } from "yjs";
import { describe, expect, it, vi } from "vitest";
import { createSceneStore } from "../../stores/scene-store.js";
import { createCanvasYjsBinding } from "../binding.js";
import { CANVAS_IR_KEY, DEFAULT_CANVAS_MAP_NAME } from "../keys.js";

/** Wire two docs as a synchronous two-client session: each doc's local
 *  updates are applied to the other with a sentinel origin so they don't
 *  bounce back. Mirrors plugin-collab-yjs/src/__tests__/adapter.test.ts. */
function linkDocs(a: YDoc, b: YDoc): void {
	a.on("update", (u, o) => {
		if (o !== "replicate") applyUpdate(b, u, "replicate");
	});
	b.on("update", (u, o) => {
		if (o !== "replicate") applyUpdate(a, u, "replicate");
	});
}

describe("createCanvasYjsBinding", () => {
	it("converges a 2-client session with no UI", () => {
		const docA = new YDoc();
		const docB = new YDoc();
		linkDocs(docA, docB);

		const storeA = createSceneStore({ initialIR: createCanvasIR({ id: "a" }) });
		const storeB = createSceneStore({ initialIR: createCanvasIR({ id: "b" }) });

		const bindingA = createCanvasYjsBinding({
			doc: docA,
			sceneStore: storeA,
			peer: { id: "alice" },
		});
		// B joins after A seeded the shared doc → B converges to A's scene.
		const bindingB = createCanvasYjsBinding({
			doc: docB,
			sceneStore: storeB,
			peer: { id: "bob" },
		});
		expect(storeB.getState().ir.id).toBe("a");

		const received: Array<{ ir: CanvasIR; peer?: { id: string } }> = [];
		bindingB.subscribe((ir, peer) => received.push({ ir, peer }));

		const next = createCanvasIR({ id: "shared", title: "Edited on A" });
		storeA.getState().setIR(next);

		// B's store converged, and its subscriber saw alice's authored update.
		expect(storeB.getState().ir).toEqual(next);
		expect(received).toHaveLength(1);
		expect(received[0]?.peer).toEqual({ id: "alice" });
		expect(bindingB.current()).toEqual(next);

		bindingA.destroy();
		bindingB.destroy();
	});

	it("does not echo a remote update back to its author", () => {
		const docA = new YDoc();
		const docB = new YDoc();
		linkDocs(docA, docB);
		const storeA = createSceneStore({ initialIR: createCanvasIR({ id: "a" }) });
		const storeB = createSceneStore({ initialIR: createCanvasIR({ id: "b" }) });
		const bindingA = createCanvasYjsBinding({
			doc: docA,
			sceneStore: storeA,
			peer: { id: "alice" },
		});
		const bindingB = createCanvasYjsBinding({
			doc: docB,
			sceneStore: storeB,
			peer: { id: "bob" },
		});

		const aRemote = vi.fn();
		bindingA.subscribe(aRemote);

		// A initiates: B applies it but must NOT re-push, so A never hears back.
		storeA.getState().setIR(createCanvasIR({ id: "x" }));
		expect(aRemote).not.toHaveBeenCalled();

		bindingA.destroy();
		bindingB.destroy();
	});

	it("converges deterministically under interleaved local edits (LWW)", () => {
		const docA = new YDoc();
		const docB = new YDoc();
		linkDocs(docA, docB);
		const storeA = createSceneStore({ initialIR: createCanvasIR({ id: "a" }) });
		const storeB = createSceneStore({ initialIR: createCanvasIR({ id: "b" }) });
		const bindingA = createCanvasYjsBinding({
			doc: docA,
			sceneStore: storeA,
			peer: { id: "alice" },
		});
		const bindingB = createCanvasYjsBinding({
			doc: docB,
			sceneStore: storeB,
			peer: { id: "bob" },
		});

		storeA.getState().setIR(createCanvasIR({ id: "from-a" }));
		storeB.getState().setIR(createCanvasIR({ id: "from-b" }));

		// Both replicas agree on a single winner.
		expect(bindingA.current()).toEqual(bindingB.current());
		expect(storeA.getState().ir).toEqual(storeB.getState().ir);

		bindingA.destroy();
		bindingB.destroy();
	});

	it("drops a corrupt remote payload without throwing or mutating", () => {
		const docA = new YDoc();
		const docB = new YDoc();
		linkDocs(docA, docB);
		const storeA = createSceneStore({ initialIR: createCanvasIR({ id: "a" }) });
		const storeB = createSceneStore({ initialIR: createCanvasIR({ id: "b" }) });
		createCanvasYjsBinding({
			doc: docA,
			sceneStore: storeA,
			peer: { id: "alice" },
		});
		const bindingB = createCanvasYjsBinding({
			doc: docB,
			sceneStore: storeB,
			peer: { id: "bob" },
		});

		const before = storeB.getState().ir;
		const bRemote = vi.fn();
		bindingB.subscribe(bRemote);

		// A foreign peer writes garbage directly into the shared key.
		expect(() => {
			docA.transact(() => {
				docA
					.getMap<string>(DEFAULT_CANVAS_MAP_NAME)
					.set(CANVAS_IR_KEY, "{ not json");
			}, "intruder");
		}).not.toThrow();

		expect(bRemote).not.toHaveBeenCalled();
		expect(storeB.getState().ir).toBe(before);
	});

	it("destroy() stops applying updates and is idempotent", () => {
		const docA = new YDoc();
		const docB = new YDoc();
		linkDocs(docA, docB);
		const storeA = createSceneStore({ initialIR: createCanvasIR({ id: "a" }) });
		const storeB = createSceneStore({ initialIR: createCanvasIR({ id: "b" }) });
		const bindingA = createCanvasYjsBinding({
			doc: docA,
			sceneStore: storeA,
			peer: { id: "alice" },
		});
		const bindingB = createCanvasYjsBinding({
			doc: docB,
			sceneStore: storeB,
			peer: { id: "bob" },
		});

		bindingB.destroy();
		expect(() => bindingB.destroy()).not.toThrow();

		const frozen = storeB.getState().ir;
		storeA.getState().setIR(createCanvasIR({ id: "after-destroy" }));
		expect(storeB.getState().ir).toBe(frozen);

		bindingA.destroy();
	});
});
