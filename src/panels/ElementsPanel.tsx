"use client";

import { Button } from "@anvilkit/ui/button";
import { cn } from "@anvilkit/ui/lib/utils";
import { useSyncExternalStore } from "react";
import {
	type ToolDescriptor,
	toolDescriptorsFromRegistry,
} from "../chrome/icons.js";
import {
	useCanvasStudio,
	useCanvasT,
} from "../context/canvas-studio-context.js";

export interface ElementsPanelProps {
	/** Filter tools by label (driven by the Tab Panel search box). */
	search?: string;
	/**
	 * Tools to show, in order. Defaults to the EFFECTIVE tool set (FR-010):
	 * the built-in drawing tools plus every extension-registered tool from
	 * `useCanvasStudio().toolRegistry`.
	 */
	tools?: readonly ToolDescriptor[];
	className?: string;
}

/**
 * The Canva-shell "Elements" panel — the new home for the drawing tools.
 * Renders each effective tool (built-in rail + extension-registered tools,
 * FR-010) as a button bound to `toolStore`; the active tool is highlighted.
 * It is the drawing-tool surface for the `CanvasWorkspace` shell (decision
 * §1.3.2). The `tools` prop still overrides the list entirely.
 */
export function ElementsPanel({
	search = "",
	tools,
	className,
}: ElementsPanelProps): React.JSX.Element {
	const ctx = useCanvasStudio();
	const t = useCanvasT();
	const activeTool = useSyncExternalStore(
		ctx.toolStore.subscribe,
		() => ctx.toolStore.getState().activeTool,
		() => ctx.toolStore.getState().activeTool,
	);

	const query = search.trim().toLowerCase();
	// Resolve the localized label once per tool so the search filter, button
	// title, and visible caption all match what the user reads. Without a
	// `tools` override the list derives from the effective registry — an
	// absent registry (partial test contexts) yields the built-ins alone.
	const resolved = tools
		? tools.map((tool) => ({
				id: tool.id,
				icon: tool.icon,
				resolvedLabel: t(tool.labelKey, tool.label),
			}))
		: toolDescriptorsFromRegistry(ctx.toolRegistry).map((tool) => ({
				id: tool.id,
				icon: tool.icon,
				resolvedLabel:
					tool.labelKey !== undefined
						? t(tool.labelKey, tool.label)
						: tool.label,
			}));
	const visible = query
		? resolved.filter((tool) =>
				tool.resolvedLabel.toLowerCase().includes(query),
			)
		: resolved;

	return (
		<div
			data-testid="elements-panel"
			className={cn("flex flex-col gap-2 p-3", className)}
		>
			{visible.length === 0 ? (
				<div
					className="px-1 py-2 text-xs text-muted-foreground italic"
					data-testid="elements-panel-empty"
				>
					{t("canvas.elements.noMatch", "No tools match “{search}”.").replace(
						"{search}",
						search,
					)}
				</div>
			) : (
				<div
					className="grid grid-cols-3 gap-2"
					role="listbox"
					aria-label={t("canvas.elements.drawingTools", "Drawing tools")}
				>
					{visible.map(({ id, resolvedLabel, icon: Icon }) => {
						const active = activeTool === id;
						return (
							<Button
								key={id}
								type="button"
								variant="ghost"
								role="option"
								aria-selected={active}
								data-testid={`elements-tool-${id}`}
								data-active={active ? "true" : "false"}
								title={resolvedLabel}
								onClick={() => ctx.toolStore.getState().setActiveTool(id)}
								className={cn(
									"h-auto flex-col gap-1.5 rounded-lg px-0 py-3 text-[10.5px] font-medium",
									active
										? "bg-foreground text-background hover:bg-foreground/90 hover:text-background"
										: "text-muted-foreground",
								)}
							>
								<Icon className="size-5" aria-hidden />
								<span>{resolvedLabel}</span>
							</Button>
						);
					})}
				</div>
			)}
		</div>
	);
}
