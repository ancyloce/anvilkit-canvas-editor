import { describe, expect, it } from "vitest";
import { createRulerGuideStore } from "../ruler-guide-store.js";

describe("ruler-guide-store (C-02)", () => {
	it("defaults: rulers hidden, guides visible+unlocked, aids visible, no pending", () => {
		const s = createRulerGuideStore().getState();
		expect(s.rulersVisible).toBe(false);
		expect(s.guidesVisible).toBe(true);
		expect(s.guidesLocked).toBe(false);
		expect(s.centerLinesVisible).toBe(false);
		expect(s.layoutAidsVisible).toBe(true);
		expect(s.pendingGuide).toBeNull();
	});

	it("honors creation options", () => {
		const s = createRulerGuideStore({
			rulersVisible: true,
			guidesVisible: false,
			guidesLocked: true,
			centerLinesVisible: true,
			layoutAidsVisible: false,
		}).getState();
		expect(s.rulersVisible).toBe(true);
		expect(s.guidesVisible).toBe(false);
		expect(s.guidesLocked).toBe(true);
		expect(s.centerLinesVisible).toBe(true);
		expect(s.layoutAidsVisible).toBe(false);
	});

	it("setters update state and pendingGuide round-trips", () => {
		const store = createRulerGuideStore();
		store.getState().setRulersVisible(true);
		store.getState().setGuidesVisible(false);
		store.getState().setGuidesLocked(true);
		store.getState().setCenterLinesVisible(true);
		store.getState().setLayoutAidsVisible(false);
		store.getState().setPendingGuide({ axis: "horizontal", position: 42 });
		expect(store.getState()).toMatchObject({
			rulersVisible: true,
			guidesVisible: false,
			guidesLocked: true,
			centerLinesVisible: true,
			layoutAidsVisible: false,
			pendingGuide: { axis: "horizontal", position: 42 },
		});
		store.getState().setPendingGuide(null);
		expect(store.getState().pendingGuide).toBeNull();
	});
});
