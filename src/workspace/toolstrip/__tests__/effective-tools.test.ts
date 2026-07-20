import { describe, expect, it } from "vitest";
import { FALLBACK_TOOL_ICON, TOOL_RAIL_ITEMS } from "@/chrome/icons.js";
import type { CanvasT } from "@/context/canvas-studio-context.js";
import { defaultToolRegistry } from "@/tools/tool-registry.js";
import type { Tool, ToolRegistry } from "@/tools/tool-types.js";
import { effectiveToolDescriptors } from "../effective-tools.js";

/** Inline-English resolver, like the context default. */
const t: CanvasT = (key, fallback) => fallback ?? key;

/** Behavior-only extension tool — no presentation metadata at all. */
const bareTool: Tool = { id: "custom.bare", cursor: "crosshair" };

/** Fully-described extension tool. */
const probeTool: Tool = {
	id: "custom.probe",
	cursor: "crosshair",
	label: "Probe",
	labelKey: "canvas.tool.select", // any catalog key: proves t() resolution
	shortcut: "K",
};

function registryWith(...tools: readonly Tool[]): ToolRegistry {
	const registry: ToolRegistry = { ...defaultToolRegistry };
	for (const tool of tools) registry[tool.id] = tool;
	return registry;
}

describe("effectiveToolDescriptors (FR-010)", () => {
	it("yields the built-in rail alone for an absent registry", () => {
		const out = effectiveToolDescriptors(undefined, t);
		expect(out.map((d) => d.id)).toEqual(TOOL_RAIL_ITEMS.map((i) => i.id));
		expect(out.every((d) => d.builtin)).toBe(true);
	});

	it("keeps built-ins first in rail order, extensions appended", () => {
		const out = effectiveToolDescriptors(
			registryWith(probeTool, bareTool),
			t,
		);
		expect(out.map((d) => d.id)).toEqual([
			...TOOL_RAIL_ITEMS.map((i) => i.id),
			"custom.probe",
			"custom.bare",
		]);
		expect(out.filter((d) => !d.builtin).map((d) => d.id)).toEqual([
			"custom.probe",
			"custom.bare",
		]);
	});

	it("falls back to the tool id + generic icon for bare extension tools", () => {
		const out = effectiveToolDescriptors(registryWith(bareTool), t);
		const bare = out.find((d) => d.id === "custom.bare");
		expect(bare?.label).toBe("custom.bare");
		expect(bare?.icon).toBe(FALLBACK_TOOL_ICON);
		expect(bare?.shortcutLabel).toBeUndefined();
	});

	it("resolves extension labelKey through t() with the label as fallback", () => {
		const messages: Record<string, string> = {
			"canvas.tool.select": "Auswählen",
		};
		const withCatalog: CanvasT = (key, fallback) =>
			messages[key] ?? fallback ?? key;
		const out = effectiveToolDescriptors(registryWith(probeTool), withCatalog);
		expect(out.find((d) => d.id === "custom.probe")?.label).toBe("Auswählen");
	});

	it("uses the display-only shortcut hint when no tool-* binding exists", () => {
		const out = effectiveToolDescriptors(registryWith(probeTool), t);
		expect(out.find((d) => d.id === "custom.probe")?.shortcutLabel).toBe("K");
	});

	it("derives built-in shortcut labels from the core bindings", () => {
		const out = effectiveToolDescriptors(defaultToolRegistry, t);
		// jsdom's UA is non-mac → plain letters.
		expect(out.find((d) => d.id === "rect")?.shortcutLabel).toBe("R");
		expect(out.find((d) => d.id === "select")?.shortcutLabel).toBe("V");
	});

	it("a registry override of a BUILT-IN id keeps the rail metadata", () => {
		const out = effectiveToolDescriptors(
			registryWith({ id: "select", cursor: "default", label: "Hijacked" }),
			t,
		);
		const selects = out.filter((d) => d.id === "select");
		expect(selects).toHaveLength(1);
		expect(selects[0]?.label).toBe("Select");
		expect(selects[0]?.builtin).toBe(true);
	});

	it("passes the disabled probe through for extension tools", () => {
		const disabled = (): boolean => true;
		const out = effectiveToolDescriptors(
			registryWith({ id: "custom.off", cursor: "default", disabled }),
			t,
		);
		expect(out.find((d) => d.id === "custom.off")?.disabled).toBe(disabled);
	});
});
