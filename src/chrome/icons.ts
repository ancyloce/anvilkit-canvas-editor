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
	label: string;
	icon: ChromeIcon;
}

/**
 * Default tool-rail order. Drawing tools first, then the AI tools. Hosts can
 * pass a narrower list to `<ToolRail tools=…>` (e.g. to hide pen/AI).
 */
export const TOOL_RAIL_ITEMS: readonly ToolDescriptor[] = [
	{ id: "select", label: "Select", icon: MousePointer2 },
	{ id: "text", label: "Text", icon: Type },
	{ id: "rect", label: "Rectangle", icon: Square },
	{ id: "ellipse", label: "Ellipse", icon: Circle },
	{ id: "line", label: "Line", icon: Minus },
	{ id: "path", label: "Pen", icon: PenTool },
	{ id: "image", label: "Image", icon: Image },
	{ id: "hand", label: "Hand", icon: Hand },
	{ id: "ai-image", label: "AI Image", icon: Sparkles },
	{ id: "ai-brush", label: "AI Brush", icon: Brush },
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
