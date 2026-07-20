/**
 * @file Single source of truth for the editor chrome's iconography.
 *
 * Icons come from `lucide-react` — the same set `@anvilkit/ui` and
 * `@anvilkit/core` already ship. The tool-rail descriptor maps each editor
 * {@link ToolId} to a label + icon so the rail (and any host tool palette)
 * render from one list.
 */

import {
	AlignLeft,
	Brush,
	Circle,
	Copy,
	Frame,
	Hand,
	Image,
	Layers,
	type LucideProps,
	Minus,
	MousePointer2,
	PaintBucket,
	Palette,
	PenTool,
	Pentagon,
	Pilcrow,
	Plus,
	Puzzle,
	Redo2,
	Send,
	Share2,
	Sparkles,
	Square,
	Star as StarIcon,
	Trash2,
	Type,
	Undo2,
} from "lucide-react";
import type { ComponentType } from "react";
import type { ToolId } from "../stores/tool-store.js";
import type { ToolRegistry } from "../tools/tool-types.js";

/** A lucide icon component (props-compatible with `<svg>`). */
export type ChromeIcon = ComponentType<LucideProps>;

export interface ToolDescriptor {
	id: ToolId;
	/** i18n key resolved by the consumer (`t(labelKey, label)`). */
	labelKey: string;
	/** English fallback when no message catalog is injected. */
	label: string;
	icon: ChromeIcon;
}

/**
 * Default tool order. Drawing tools first, then the AI tools. Consumed today
 * by the Elements dock panel; the floating tool strip (PRD 0012 FR-010,
 * Phase 1b) will reuse this same list. Hosts can consume a narrower slice
 * (e.g. to hide pen/AI). NOTE: no `<ToolRail>` component exists (M0-08 doc
 * fix — an earlier draft referenced one that was never built).
 */
export const TOOL_RAIL_ITEMS: readonly ToolDescriptor[] = [
	{
		id: "select",
		labelKey: "canvas.tool.select",
		label: "Select",
		icon: MousePointer2,
	},
	{ id: "text", labelKey: "canvas.tool.text", label: "Text", icon: Type },
	{
		id: "rich-text",
		labelKey: "canvas.tool.richText",
		label: "Rich Text",
		icon: Pilcrow,
	},
	{
		id: "frame",
		labelKey: "canvas.tool.frame",
		label: "Frame",
		icon: Frame,
	},
	{
		id: "rect",
		labelKey: "canvas.tool.rect",
		label: "Rectangle",
		icon: Square,
	},
	{
		id: "ellipse",
		labelKey: "canvas.tool.ellipse",
		label: "Ellipse",
		icon: Circle,
	},
	{
		id: "polygon",
		labelKey: "canvas.tool.polygon",
		label: "Polygon",
		icon: Pentagon,
	},
	{
		id: "star",
		labelKey: "canvas.tool.star",
		label: "Star",
		icon: StarIcon,
	},
	{ id: "line", labelKey: "canvas.tool.line", label: "Line", icon: Minus },
	{ id: "path", labelKey: "canvas.tool.path", label: "Pen", icon: PenTool },
	{ id: "image", labelKey: "canvas.tool.image", label: "Image", icon: Image },
	{ id: "hand", labelKey: "canvas.tool.hand", label: "Hand", icon: Hand },
	{
		id: "ai-image",
		labelKey: "canvas.tool.aiImage",
		label: "AI Image",
		icon: Sparkles,
	},
	{
		id: "ai-brush",
		labelKey: "canvas.tool.aiBrush",
		label: "AI Brush",
		icon: Brush,
	},
] as const;

/**
 * Fallback icon for extension tools that register no `icon` of their own
 * (FR-010): a generic "plug-in" glyph, never used by a built-in tool.
 */
export const FALLBACK_TOOL_ICON: ChromeIcon = Puzzle;

/**
 * A {@link ToolDescriptor} derived from the EFFECTIVE tool registry (FR-010):
 * built-ins keep their rail metadata; extension-registered tools carry the
 * presentation metadata declared on their `Tool` (or fallbacks). `labelKey`
 * is optional here — an extension tool may register a plain `label` only.
 */
export interface RegistryToolDescriptor {
	readonly id: ToolId;
	/** i18n key when one exists (always for built-ins). `t(labelKey, label)`. */
	readonly labelKey?: string;
	/** English fallback label (the tool id when a tool declares nothing). */
	readonly label: string;
	readonly icon: ChromeIcon;
	/** `true` for {@link TOOL_RAIL_ITEMS} entries, `false` for extension tools. */
	readonly builtin: boolean;
	/** Extension-declared display shortcut hint (`Tool.shortcut`). */
	readonly shortcut?: string;
	/** Extension-declared disabled probe (`Tool.disabled`). */
	readonly disabled?: () => boolean;
}

/**
 * Merge {@link TOOL_RAIL_ITEMS} (built-ins, in rail order) with the
 * extension-registered tools of the effective registry (registry order) into
 * ONE descriptor list — the single source for the tool strip, its "More
 * tools" overflow, and the Elements panel. `registry` is normally
 * `useCanvasStudio().toolRegistry`; `undefined` (e.g. a partial test context)
 * yields the built-ins alone. A registry override of a BUILT-IN id keeps the
 * rail's own metadata — overriding behavior must not reshuffle the chrome.
 */
export function toolDescriptorsFromRegistry(
	registry: ToolRegistry | undefined,
): readonly RegistryToolDescriptor[] {
	const builtins: RegistryToolDescriptor[] = TOOL_RAIL_ITEMS.map((item) => ({
		id: item.id,
		labelKey: item.labelKey,
		label: item.label,
		icon: item.icon,
		builtin: true,
	}));
	if (!registry) return builtins;
	const builtinIds = new Set<ToolId>(TOOL_RAIL_ITEMS.map((item) => item.id));
	const extensions: RegistryToolDescriptor[] = [];
	for (const tool of Object.values(registry)) {
		if (!tool || builtinIds.has(tool.id)) continue;
		extensions.push({
			id: tool.id,
			...(tool.labelKey !== undefined ? { labelKey: tool.labelKey } : {}),
			label: tool.label ?? tool.id,
			icon: tool.icon ?? FALLBACK_TOOL_ICON,
			builtin: false,
			...(tool.shortcut !== undefined ? { shortcut: tool.shortcut } : {}),
			...(tool.disabled !== undefined ? { disabled: tool.disabled } : {}),
		});
	}
	return [...builtins, ...extensions];
}

/** Action icons shared by the stage bar, floating toolbar, and zoom control. */
export const ChromeIcons = {
	undo: Undo2,
	redo: Redo2,
	zoomIn: Plus,
	zoomOut: Minus,
	delete: Trash2,
	duplicate: Copy,
	share: Share2,
	publish: Send,
	sparkles: Sparkles,
	fill: PaintBucket,
	palette: Palette,
	align: AlignLeft,
	layers: Layers,
} as const;
