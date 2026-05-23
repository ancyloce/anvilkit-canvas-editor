import { describe, expect, it } from "vitest";
import { DOCK_IDS } from "../dock-ids.js";
import {
	createCanvasPanelRegistry,
	defaultCanvasPanelRegistry,
} from "../panel-registry.js";

describe("panel-registry", () => {
	it("registers a descriptor for every dock id", () => {
		for (const id of DOCK_IDS) {
			const descriptor = defaultCanvasPanelRegistry[id];
			expect(descriptor).toBeDefined();
			expect(descriptor?.id).toBe(id);
		}
	});

	it("wires layers/brand/elements as built-ins; elements is searchable", () => {
		expect(defaultCanvasPanelRegistry.layers?.kind).toBe("builtin");
		expect(defaultCanvasPanelRegistry.brand?.kind).toBe("builtin");
		expect(defaultCanvasPanelRegistry.elements?.kind).toBe("builtin");
		expect(defaultCanvasPanelRegistry.elements?.searchable).toBe(true);
	});

	it("leaves ai/templates/text/uploads as built-in stubs", () => {
		for (const id of ["ai", "templates", "text", "uploads"] as const) {
			expect(defaultCanvasPanelRegistry[id]?.kind).toBe("builtin");
		}
	});

	it("merges host overrides over the defaults", () => {
		const registry = createCanvasPanelRegistry({
			ai: { kind: "plugin", id: "ai", title: "AI Studio", slot: null },
		});
		expect(registry.ai?.kind).toBe("plugin");
		expect(registry.ai?.title).toBe("AI Studio");
		// Untouched entries fall through to the defaults.
		expect(registry.layers?.kind).toBe("builtin");
	});

	it("createCanvasPanelRegistry() without overrides keeps every dock", () => {
		const registry = createCanvasPanelRegistry();
		for (const id of DOCK_IDS) {
			expect(registry[id]).toBeDefined();
		}
	});
});
