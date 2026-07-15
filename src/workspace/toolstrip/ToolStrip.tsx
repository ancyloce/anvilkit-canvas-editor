"use client";

import { Button } from "@anvilkit/ui/button";
import { cn } from "@anvilkit/ui/lib/utils";
import { useSyncExternalStore } from "react";
import { TOOL_RAIL_ITEMS } from "../../chrome/icons.js";
import {
	useCanvasStudio,
	useCanvasT,
} from "../../context/canvas-studio-context.js";
import {
	createCoreShortcutBindings,
	detectShortcutPlatform,
	formatShortcut,
} from "../shortcuts/shortcut-registry.js";

export interface ToolStripProps {
	className?: string;
}

/** toolId → formatted shortcut label, derived from the registry (FR-011). */
function shortcutLabels(): Record<string, string> {
	const platform = detectShortcutPlatform();
	const out: Record<string, string> = {};
	for (const binding of createCoreShortcutBindings()) {
		if (!binding.id.startsWith("tool-")) continue;
		const combo = binding.combos[0];
		if (combo) out[binding.id.slice(5)] = formatShortcut(combo, platform);
	}
	return out;
}

/**
 * The floating tool strip (B-06, PRD 0012 FR-010 — the v2 layout decision:
 * a floating cluster INSIDE the canvas section, not a new grid column).
 * Reuses the tool registry/store and `TOOL_RAIL_ITEMS`; tooltips carry the
 * registry-derived shortcut labels. Hidden or replaced via
 * `<CanvasWorkspace toolStrip>`.
 */
export function ToolStrip({ className }: ToolStripProps): React.JSX.Element {
	const ctx = useCanvasStudio();
	const t = useCanvasT();
	const activeTool = useSyncExternalStore(
		ctx.toolStore.subscribe,
		() => ctx.toolStore.getState().activeTool,
		() => ctx.toolStore.getState().activeTool,
	);
	const shortcuts = shortcutLabels();

	return (
		<div
			data-testid="tool-strip"
			role="toolbar"
			aria-orientation="vertical"
			aria-label={t("canvas.toolstrip.label", "Tools")}
			className={cn(
				"pointer-events-auto absolute top-1/2 left-3 z-30 flex max-h-[80%] -translate-y-1/2 flex-col gap-0.5 overflow-y-auto rounded-xl bg-card p-1 shadow-lg ring-1 ring-border",
				className,
			)}
		>
			{TOOL_RAIL_ITEMS.map((tool) => {
				const label = t(tool.labelKey, tool.label);
				const shortcut = shortcuts[tool.id as string];
				const Icon = tool.icon;
				const isActive = activeTool === tool.id;
				return (
					<Button
						key={tool.id as string}
						type="button"
						size="icon-sm"
						variant={isActive ? "default" : "ghost"}
						data-testid={`tool-strip-${tool.id}`}
						data-active={isActive ? "true" : "false"}
						aria-pressed={isActive}
						aria-label={label}
						aria-keyshortcuts={shortcut}
						title={shortcut ? `${label} (${shortcut})` : label}
						onClick={() => ctx.toolStore.getState().setActiveTool(tool.id)}
					>
						<Icon aria-hidden />
					</Button>
				);
			})}
		</div>
	);
}
