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
	Plus,
	Redo2,
	Send,
	Share2,
	Sparkles,
	Square,
	Trash2,
	Type,
	Undo2,
} from "lucide-react";
import type { ComponentType } from "react";
import type { ToolId } from "../stores/tool-store.js";

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
 * Default tool-rail order. Drawing tools first, then the AI tools. Hosts can
 * pass a narrower list to `<ToolRail tools=…>` (e.g. to hide pen/AI).
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
