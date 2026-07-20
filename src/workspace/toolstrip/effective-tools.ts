import type { ChromeIcon } from "../../chrome/icons.js";
import { toolDescriptorsFromRegistry } from "../../chrome/icons.js";
import type { CanvasT } from "../../context/canvas-studio-context.js";
import type { ToolId } from "../../stores/tool-store.js";
import type { ToolRegistry } from "../../tools/tool-types.js";
import {
	createCoreShortcutBindings,
	detectShortcutPlatform,
	formatShortcut,
} from "../shortcuts/shortcut-registry.js";

/**
 * @file Effective tool descriptors (FR-010 tool-strip extensibility).
 *
 * ONE resolved, display-ready list per registry: the built-in rail items in
 * rail order, then every extension-registered tool. Feeds the tool strip, its
 * "More tools" overflow, and custom `toolStrip` renderers. The raw (un-
 * localized) merge lives in `chrome/icons.ts` (`toolDescriptorsFromRegistry`)
 * so lower-layer surfaces like the Elements panel can share it —
 * `check-layering.mjs` ranks `panels/` below `workspace/`.
 */

/** A display-ready tool entry: localized label, icon, shortcut label. */
export interface EffectiveToolDescriptor {
	readonly id: ToolId;
	/** Localized display label — `t(labelKey, label)` already applied. */
	readonly label: string;
	/** The tool's icon, or the generic fallback for icon-less extension tools. */
	readonly icon: ChromeIcon;
	/**
	 * Platform-formatted shortcut label. Derived from the core `tool-<id>`
	 * key bindings when one exists; otherwise an extension tool's own
	 * display-only `shortcut` hint. Absent when the tool has neither.
	 */
	readonly shortcutLabel?: string;
	/** `true` for built-in rail tools, `false` for extension-registered ones. */
	readonly builtin: boolean;
	/** Extension-declared disabled probe, consulted per render. */
	readonly disabled?: () => boolean;
}

/** toolId → formatted shortcut label, scanned from the `tool-*` bindings. */
function shortcutLabels(): ReadonlyMap<string, string> {
	const platform = detectShortcutPlatform();
	const out = new Map<string, string>();
	for (const binding of createCoreShortcutBindings()) {
		if (!binding.id.startsWith("tool-")) continue;
		const combo = binding.combos[0];
		if (combo) out.set(binding.id.slice(5), formatShortcut(combo, platform));
	}
	return out;
}

/**
 * Resolve the EFFECTIVE tool registry into display-ready descriptors:
 * built-ins (rail order) first, then extension tools (registry order) with a
 * fallback icon when they declare none. `registry` is normally
 * `useCanvasStudio().toolRegistry`; `undefined` (partial test contexts)
 * yields the built-in rail alone.
 */
export function effectiveToolDescriptors(
	registry: ToolRegistry | undefined,
	t: CanvasT,
): readonly EffectiveToolDescriptor[] {
	const shortcuts = shortcutLabels();
	return toolDescriptorsFromRegistry(registry).map((d) => {
		const shortcutLabel = shortcuts.get(d.id as string) ?? d.shortcut;
		return {
			id: d.id,
			label: d.labelKey !== undefined ? t(d.labelKey, d.label) : d.label,
			icon: d.icon,
			...(shortcutLabel !== undefined ? { shortcutLabel } : {}),
			builtin: d.builtin,
			...(d.disabled !== undefined ? { disabled: d.disabled } : {}),
		};
	});
}
