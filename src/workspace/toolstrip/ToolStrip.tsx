"use client";

import { Button } from "@anvilkit/ui/button";
import { cn } from "@anvilkit/ui/lib/utils";
import { Loader2 } from "lucide-react";
import { useSyncExternalStore } from "react";
import { TOOL_RAIL_ITEMS } from "../../chrome/icons.js";
import {
	useCanvasStudio,
	useCanvasT,
} from "../../context/canvas-studio-context.js";
import type { ToolId } from "../../stores/tool-store.js";
import {
	createCoreShortcutBindings,
	detectShortcutPlatform,
	formatShortcut,
} from "../shortcuts/shortcut-registry.js";

/**
 * FR-011: tools that show a busy spinner while any AI job is pending.
 * `aiJobStore` records jobs by the placeholder node they back, not by which
 * tool started them, so this is necessarily coarse — "AI is generating
 * somewhere" — rather than per-job attribution.
 */
const AI_LOADING_TOOL_IDS: ReadonlySet<ToolId> = new Set([
	"ai-image",
	"ai-brush",
]);
/** FR-011: tools that need `hasImagePicker` to be usable at all. */
const IMAGE_PICKER_TOOL_IDS: ReadonlySet<ToolId> = new Set(["image"]);

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
	const aiJobPending = useSyncExternalStore(
		ctx.aiJobStore.subscribe,
		() =>
			Object.values(ctx.aiJobStore.getState().jobs).some(
				(job) => job.status === "pending",
			),
		() => false,
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
				const isLoading = aiJobPending && AI_LOADING_TOOL_IDS.has(tool.id);
				const isDisabled =
					IMAGE_PICKER_TOOL_IDS.has(tool.id) && ctx.hasImagePicker === false;
				return (
					<Button
						key={tool.id as string}
						type="button"
						size="icon-sm"
						variant={isActive ? "default" : "ghost"}
						disabled={isDisabled}
						data-testid={`tool-strip-${tool.id}`}
						data-active={isActive ? "true" : "false"}
						data-loading={isLoading ? "true" : "false"}
						aria-pressed={isActive}
						aria-busy={isLoading || undefined}
						aria-label={label}
						aria-keyshortcuts={shortcut}
						title={shortcut ? `${label} (${shortcut})` : label}
						onClick={() => ctx.toolStore.getState().setActiveTool(tool.id)}
					>
						{isLoading ? (
							<Loader2 aria-hidden className="animate-spin" />
						) : (
							<Icon aria-hidden />
						)}
					</Button>
				);
			})}
		</div>
	);
}
