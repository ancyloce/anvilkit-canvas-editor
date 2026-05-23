/**
 * @file Default Panel Dock configuration for the Canva-shell.
 *
 * One {@link DockItem} per {@link DockId}, in display order. Icons come from
 * `lucide-react` (the same set the editor chrome already ships). The `color`
 * accent is optional and per-item configurable; hosts can pass their own
 * `DockItem[]` to `<PanelDock items=…>` / `<CanvasWorkspace dockItems=…>`.
 */

import {
	Layers,
	LayoutTemplate,
	Palette,
	Shapes,
	Sparkles,
	Type,
	Upload,
} from "lucide-react";
import type { ChromeIcon } from "../chrome/icons.js";
import type { DockId } from "./dock-ids.js";

export interface DockItem {
	readonly id: DockId;
	readonly label: string;
	readonly icon: ChromeIcon;
	/** Accent color for the (inactive) dock icon — any CSS color. Optional. */
	readonly color?: string;
}

export const DOCK_ITEMS: readonly DockItem[] = [
	{ id: "ai", label: "AI", icon: Sparkles, color: "#7c3aed" },
	{
		id: "templates",
		label: "Templates",
		icon: LayoutTemplate,
		color: "#2563eb",
	},
	{ id: "elements", label: "Elements", icon: Shapes, color: "#0891b2" },
	{ id: "text", label: "Text", icon: Type },
	{ id: "brand", label: "Brand", icon: Palette, color: "#f59e0b" },
	{ id: "uploads", label: "Uploads", icon: Upload, color: "#16a34a" },
	{ id: "layers", label: "Layers", icon: Layers },
] as const;
