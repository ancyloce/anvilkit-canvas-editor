import { createCanvasIR } from "@anvilkit/canvas-core";
import { describe, expect, it } from "vitest";
import { createSceneStore } from "../scene-store.js";

describe("createSceneStore", () => {
	it("starts at the provided initialIR", () => {
		const ir = createCanvasIR({ id: "ir-1" });
		const store = createSceneStore({ initialIR: ir });
		expect(store.getState().ir).toBe(ir);
	});

	it("setIR replaces the scene", () => {
		const first = createCanvasIR({ id: "ir-1" });
		const next = createCanvasIR({ id: "ir-2" });
		const store = createSceneStore({ initialIR: first });
		store.getState().setIR(next);
		expect(store.getState().ir).toBe(next);
		expect(store.getState().ir.id).toBe("ir-2");
	});

	it("two stores are independent", () => {
		const a = createSceneStore({ initialIR: createCanvasIR({ id: "a" }) });
		const b = createSceneStore({ initialIR: createCanvasIR({ id: "b" }) });
		a.getState().setIR(createCanvasIR({ id: "a2" }));
		expect(a.getState().ir.id).toBe("a2");
		expect(b.getState().ir.id).toBe("b");
	});

	it("notifies subscribers when the scene changes", () => {
		const store = createSceneStore({
			initialIR: createCanvasIR({ id: "ir-1" }),
		});
		let count = 0;
		const unsub = store.subscribe(() => {
			count++;
		});
		store.getState().setIR(createCanvasIR({ id: "ir-2" }));
		expect(count).toBe(1);
		store.getState().setIR(createCanvasIR({ id: "ir-3" }));
		expect(count).toBe(2);
		unsub();
		store.getState().setIR(createCanvasIR({ id: "ir-4" }));
		expect(count).toBe(2);
	});
});
