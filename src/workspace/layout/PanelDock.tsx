"use client";

import { Button } from "@anvilkit/ui/button";
import { cn } from "@anvilkit/ui/lib/utils";
import { useActiveDock } from "../state/hooks.js";
import { DOCK_ITEMS, type DockItem } from "../workspace-config.js";

export interface PanelDockProps {
	/** Dock entries, in order. Defaults to {@link DOCK_ITEMS}. */
	items?: readonly DockItem[];
	className?: string;
}

/**
 * Vertical icon rail (Aside, col 1). Each entry switches the active Tab Panel
 * via `workspaceUi.activeDockId`; the active entry is highlighted and each
 * inactive icon can carry a configurable accent `color`.
 */
export function PanelDock({
	items = DOCK_ITEMS,
	className,
}: PanelDockProps): React.JSX.Element {
	const [activeDockId, setActiveDockId] = useActiveDock();

	return (
		<nav
			data-testid="panel-dock"
			aria-label="Panels"
			className={cn(
				"flex w-16 flex-col items-center gap-1 overflow-y-auto border-r border-border bg-card py-2",
				className,
			)}
		>
			{items.map(({ id, label, icon: Icon, color }) => {
				const active = activeDockId === id;
				return (
					<Button
						key={id}
						type="button"
						variant="ghost"
						data-testid={`panel-dock-${id}`}
						data-active={active ? "true" : "false"}
						aria-pressed={active}
						aria-label={label}
						title={label}
						onClick={() => setActiveDockId(id)}
						className={cn(
							"h-auto w-12 flex-col gap-1 rounded-lg px-0 py-2 text-[10px] leading-none font-medium",
							active ? "bg-muted text-foreground" : "text-muted-foreground",
						)}
					>
						<Icon
							className="size-[18px]"
							aria-hidden
							style={!active && color ? { color } : undefined}
						/>
						<span>{label}</span>
					</Button>
				);
			})}
		</nav>
	);
}
