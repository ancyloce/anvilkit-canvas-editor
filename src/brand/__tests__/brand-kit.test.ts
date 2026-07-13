import type { BrandKitDefinition } from "@anvilkit/canvas-core";
import { describe, expect, it } from "vitest";
import { brandKitDefinitionToBrandKit } from "../brand-kit.js";

function makeDefinition(
	overrides: Partial<BrandKitDefinition> = {},
): BrandKitDefinition {
	return {
		id: "kit1",
		name: "Acme",
		logos: [],
		colors: [],
		fonts: [],
		typography: [],
		rules: [],
		...overrides,
	};
}

describe("brandKitDefinitionToBrandKit", () => {
	it("passes colors through unchanged", () => {
		const definition = makeDefinition({
			colors: [{ id: "c1", name: "Primary", value: "#2563eb" }],
		});
		const kit = brandKitDefinitionToBrandKit(definition);
		expect(kit.colors).toEqual(definition.colors);
	});

	it("flattens font tokens to plain family-name strings", () => {
		const definition = makeDefinition({
			fonts: [
				{ id: "f1", name: "Body", family: "Inter" },
				{ name: "Display", family: "Poppins" },
			],
		});
		const kit = brandKitDefinitionToBrandKit(definition);
		expect(kit.fonts).toEqual(["Inter", "Poppins"]);
	});

	it("loses nothing: logos/typography/imageStylePresets/toneOfVoice/rules/defaultExportPresets pass through", () => {
		const definition = makeDefinition({
			logos: [{ id: "logo1", name: "Wordmark", uri: "asset://logo1" }],
			typography: [{ id: "heading", name: "Heading", fontSize: 32 }],
			imageStylePresets: [{ id: "warm", name: "Warm" }],
			toneOfVoice: { voice: "friendly" },
			rules: [{ id: "r1", kind: "forbidden-color", value: "#ff0000" }],
			defaultExportPresets: ["png"],
		});
		const kit = brandKitDefinitionToBrandKit(definition);
		expect(kit.logos).toEqual(definition.logos);
		expect(kit.typography).toEqual(definition.typography);
		expect(kit.imageStylePresets).toEqual(definition.imageStylePresets);
		expect(kit.toneOfVoice).toEqual(definition.toneOfVoice);
		expect(kit.rules).toEqual(definition.rules);
		expect(kit.defaultExportPresets).toEqual(definition.defaultExportPresets);
	});

	it("carries id/name through", () => {
		const kit = brandKitDefinitionToBrandKit(makeDefinition());
		expect(kit.id).toBe("kit1");
		expect(kit.name).toBe("Acme");
	});
});
