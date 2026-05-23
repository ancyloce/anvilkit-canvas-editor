"use client";

import { Button } from "@anvilkit/ui/button";
import { cn } from "@anvilkit/ui/lib/utils";
import { useSyncExternalStore } from "react";
import { useCanvasStudio } from "../context/canvas-studio-context.js";
import type { ToolId } from "../stores/tool-store.js";
import { TOOL_RAIL_ITEMS, type ToolDescriptor } from "./icons.js";

export interface ToolRailProps {
	/** Tools to show, in order. Defaults to {@link TOOL_RAIL_ITEMS}. */
	tools?: readonly ToolDescriptor[];
	/**
	 * Builds each tool button's `data-testid`. Defaults to `tool-rail-${id}`.
	 * Hosts can supply their own scheme (e.g. `host-tool-${id}`) so existing
	 * E2E selectors keep matching.
	 */
	toolTestId?: (id: ToolId) => string;
	/** `data-testid` for the rail container. */
	"data-testid"?: string;
	className?: string;
}

/**
 * Vertical tool rail (reference `.editor-tools`). Bound to `toolStore`: the
 * active tool renders inverted (foreground fill), the rest as muted ghost
 * buttons. Icon + label per tool, mirroring the reference's column layout.
 */
export function ToolRail({
	tools = TOOL_RAIL_ITEMS,
	toolTestId,
	className,
	...rest
}: ToolRailProps): React.JSX.Element {
	const ctx = useCanvasStudio();
	const activeTool = useSyncExternalStore(
		ctx.toolStore.subscribe,
		() => ctx.toolStore.getState().activeTool,
		() => ctx.toolStore.getState().activeTool,
	);
	const buildTestId = toolTestId ?? ((id: ToolId) => `tool-rail-${id}`);

	return (
		<aside
			role="toolbar"
			aria-label="Tools"
			aria-orientation="vertical"
			className={cn(
				"flex w-16 flex-col items-center gap-1 border-r border-border bg-card py-3.5",
				className,
			)}
			{...rest}
		>
			{tools.map(({ id, label, icon: Icon }) => {
				const active = activeTool === id;
				return (
					<Button
						key={id}
						type="button"
						variant="ghost"
						data-testid={buildTestId(id)}
						data-active={active ? "true" : "false"}
						aria-pressed={active}
						aria-label={label}
						title={label}
						onClick={() => ctx.toolStore.getState().setActiveTool(id)}
						className={cn(
							"h-auto w-11 flex-col gap-1 rounded-lg px-0 py-2 text-[10.5px] leading-none font-medium",
							active
								? "bg-foreground text-background hover:bg-foreground/90 hover:text-background"
								: "text-muted-foreground",
						)}
					>
						<Icon className="size-[18px]" aria-hidden />
						<span>{label}</span>
					</Button>
				);
			})}
		</aside>
	);
}
