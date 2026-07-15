import { describe, expect, it } from "vitest";
import { DOCK_IDS, HIDDEN_DOCK_IDS } from "../dock-ids.js";
import { DOCK_ITEMS } from "../workspace-config.js";

/**
 * M0-08 stub reconciliation: "coming soon" tabs whose features don't exist
 * are hidden from the default dock rail, while their ids stay in the union
 * for persisted-state migration and host overrides.
 */
describe("hidden stub docks (M0-08)", () => {
	it("ai and text are hidden; uploads/layers/templates/elements/brand render", () => {
		const rendered = DOCK_ITEMS.map((i) => i.id);
		expect(rendered).not.toContain("ai");
		expect(rendered).not.toContain("text");
		expect(rendered).toEqual(
			expect.arrayContaining([
				"templates",
				"elements",
				"brand",
				"uploads",
				"layers",
			]),
		);
	});

	it("hidden ids remain members of DOCK_IDS (type/migration stability)", () => {
		for (const hidden of HIDDEN_DOCK_IDS) {
			expect(DOCK_IDS).toContain(hidden);
		}
	});
});
