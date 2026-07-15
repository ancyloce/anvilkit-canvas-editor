import { describe, expect, it } from "vitest";
import {
	type CanvasShortcutBinding,
	detectShortcutPlatform,
	formatShortcut,
	matchesCombo,
	resolveShortcutBindings,
} from "../shortcut-registry.js";

function keyEvent(
	key: string,
	mods: Partial<
		Pick<KeyboardEvent, "metaKey" | "ctrlKey" | "shiftKey" | "altKey">
	> = {},
) {
	return {
		key,
		metaKey: false,
		ctrlKey: false,
		shiftKey: false,
		altKey: false,
		...mods,
	};
}

describe("matchesCombo", () => {
	it("matches ctrlOrMeta with either modifier, case-insensitively", () => {
		const combo = { key: "z", ctrlOrMeta: true };
		expect(matchesCombo(keyEvent("z", { ctrlKey: true }), combo)).toBe(true);
		expect(matchesCombo(keyEvent("Z", { metaKey: true }), combo)).toBe(true);
		expect(matchesCombo(keyEvent("z"), combo)).toBe(false);
	});

	it("requires EXACT modifiers — ⌘Z must not fire for ⌘⇧Z and vice versa", () => {
		const plain = { key: "z", ctrlOrMeta: true };
		const shifted = { key: "z", ctrlOrMeta: true, shift: true };
		const shiftEvent = keyEvent("z", { metaKey: true, shiftKey: true });
		const plainEvent = keyEvent("z", { metaKey: true });
		expect(matchesCombo(shiftEvent, plain)).toBe(false);
		expect(matchesCombo(shiftEvent, shifted)).toBe(true);
		expect(matchesCombo(plainEvent, shifted)).toBe(false);
		expect(
			matchesCombo(keyEvent("z", { metaKey: true, altKey: true }), plain),
		).toBe(false);
	});

	it("matches bare keys with no modifiers", () => {
		expect(matchesCombo(keyEvent("Delete"), { key: "Delete" })).toBe(true);
		expect(
			matchesCombo(keyEvent("Delete", { ctrlKey: true }), { key: "Delete" }),
		).toBe(false);
	});
});

describe("formatShortcut", () => {
	it("renders mac glyph order ⌥⇧⌘", () => {
		expect(
			formatShortcut({ key: "z", ctrlOrMeta: true, shift: true }, "mac"),
		).toBe("⇧⌘Z");
		expect(formatShortcut({ key: "Delete" }, "mac")).toBe("⌫");
	});

	it("renders win/linux plus-separated labels", () => {
		expect(
			formatShortcut({ key: "z", ctrlOrMeta: true, shift: true }, "other"),
		).toBe("Ctrl+Shift+Z");
		expect(formatShortcut({ key: "Delete" }, "other")).toBe("Delete");
	});
});

describe("detectShortcutPlatform", () => {
	it("detects mac-family platforms", () => {
		expect(detectShortcutPlatform({ platform: "MacIntel" })).toBe("mac");
		expect(detectShortcutPlatform({ userAgent: "iPhone Safari" })).toBe("mac");
		expect(detectShortcutPlatform({ platform: "Win32" })).toBe("other");
		expect(detectShortcutPlatform(undefined)).toBe("other");
	});
});

describe("resolveShortcutBindings", () => {
	it("ships the FR-040 core set", () => {
		const ids = resolveShortcutBindings().map((b) => b.id);
		expect(ids).toEqual([
			"undo",
			"redo",
			"copy",
			"cut",
			"paste",
			"duplicate",
			"delete",
			"group",
			"ungroup",
			"zoom-in",
			"zoom-out",
			"zoom-fit",
			"zoom-selection",
			"zoom-actual",
			"cancel",
			"tool-select",
			"tool-hand",
			"tool-frame",
			"tool-rect",
			"tool-ellipse",
			"tool-line",
			"tool-path",
			"tool-text",
			"tool-image",
			"lock",
		]);
	});

	it("appends host bindings and lets a matching id override a built-in", () => {
		const custom: CanvasShortcutBinding = {
			id: "undo",
			combos: [{ key: "u", ctrlOrMeta: true }],
			labelKey: "host.undo",
			label: "Host undo",
			category: "edit",
			run: () => {
				/* noop */
			},
		};
		const extra: CanvasShortcutBinding = {
			id: "host-action",
			combos: [{ key: "k", ctrlOrMeta: true }],
			labelKey: "host.k",
			label: "Host action",
			category: "host",
			run: () => {
				/* noop */
			},
		};
		const resolved = resolveShortcutBindings({
			extraBindings: [custom, extra],
		});
		expect(resolved.filter((b) => b.id === "undo")).toHaveLength(1);
		expect(resolved.find((b) => b.id === "undo")?.label).toBe("Host undo");
		expect(resolved.some((b) => b.id === "host-action")).toBe(true);
	});
});
