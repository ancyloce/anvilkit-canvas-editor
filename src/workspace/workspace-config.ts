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
import { type DockId, HIDDEN_DOCK_IDS } from "./dock-ids.js";

export interface DockItem {
	readonly id: DockId;
	/** i18n key resolved by the consumer (`t(labelKey, label)`). */
	readonly labelKey: string;
	/** English fallback when no message catalog is injected. */
	readonly label: string;
	readonly icon: ChromeIcon;
	/** Accent color for the (inactive) dock icon — any CSS color. Optional. */
	readonly color?: string;
}

const ALL_DOCK_ITEMS: readonly DockItem[] = [
	{
		id: "ai",
		labelKey: "canvas.dock.ai",
		label: "AI",
		icon: Sparkles,
		color: "#7c3aed",
	},
	{
		id: "templates",
		labelKey: "canvas.dock.templates",
		label: "Templates",
		icon: LayoutTemplate,
		color: "#2563eb",
	},
	{
		id: "elements",
		labelKey: "canvas.dock.elements",
		label: "Elements",
		icon: Shapes,
		color: "#0891b2",
	},
	{ id: "text", labelKey: "canvas.dock.text", label: "Text", icon: Type },
	{
		id: "brand",
		labelKey: "canvas.dock.brand",
		label: "Brand",
		icon: Palette,
		color: "#f59e0b",
	},
	{
		id: "uploads",
		labelKey: "canvas.dock.uploads",
		label: "Uploads",
		icon: Upload,
		color: "#16a34a",
	},
	{
		id: "layers",
		labelKey: "canvas.dock.layers",
		label: "Layers",
		icon: Layers,
	},
] as const;

/**
 * Dock rail entries actually rendered — stub tabs whose features don't exist
 * yet are filtered out (M0-08); see {@link HIDDEN_DOCK_IDS} for the list and
 * the revival plan.
 */
export const DOCK_ITEMS: readonly DockItem[] = ALL_DOCK_ITEMS.filter(
	(item) => !HIDDEN_DOCK_IDS.has(item.id),
);
