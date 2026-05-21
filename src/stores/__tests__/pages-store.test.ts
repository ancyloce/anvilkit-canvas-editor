import { describe, expect, it } from "vitest";
import { createPagesStore } from "../pages-store.js";

describe("createPagesStore", () => {
	it("starts at the provided initialActivePageId", () => {
		const store = createPagesStore({ initialActivePageId: "p1" });
		expect(store.getState().activePageId).toBe("p1");
	});

	it("setActivePageId updates the active id", () => {
		const store = createPagesStore({ initialActivePageId: "p1" });
		store.getState().setActivePageId("p2");
		expect(store.getState().activePageId).toBe("p2");
	});

	it("two stores are independent", () => {
		const a = createPagesStore({ initialActivePageId: "p1" });
		const b = createPagesStore({ initialActivePageId: "p1" });
		a.getState().setActivePageId("p99");
		expect(a.getState().activePageId).toBe("p99");
		expect(b.getState().activePageId).toBe("p1");
	});

	it("notifies subscribers when active id changes", () => {
		const store = createPagesStore({ initialActivePageId: "p1" });
		let count = 0;
		const unsub = store.subscribe(() => {
			count++;
		});
		store.getState().setActivePageId("p2");
		expect(count).toBe(1);
		store.getState().setActivePageId("p3");
		expect(count).toBe(2);
		unsub();
		store.getState().setActivePageId("p4");
		expect(count).toBe(2);
	});
});
