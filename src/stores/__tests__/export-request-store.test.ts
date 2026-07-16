import { describe, expect, it } from "vitest";
import { createExportRequestStore } from "../export-request-store.js";

describe("export-request-store (FR-031/FR-032 export channel)", () => {
	it("starts unavailable with no pending request", () => {
		const store = createExportRequestStore();
		expect(store.getState().available).toBe(false);
		expect(store.getState().pending).toBeNull();
	});

	it("tracks availability", () => {
		const store = createExportRequestStore();
		store.getState().setAvailable(true);
		expect(store.getState().available).toBe(true);
	});

	it("queues a scoped request and consumes it once", () => {
		const store = createExportRequestStore();
		store.getState().request({ scope: "selection" });
		expect(store.getState().pending).toEqual({ scope: "selection" });
		expect(store.getState().consume()).toEqual({ scope: "selection" });
		// Consumed — cleared, second consume is null.
		expect(store.getState().pending).toBeNull();
		expect(store.getState().consume()).toBeNull();
	});
});
