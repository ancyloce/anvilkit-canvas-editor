"use client";

import { Button, buttonVariants } from "@anvilkit/ui/button";
import {
	DropdownMenu,
	DropdownMenuCheckboxItem,
	DropdownMenuContent,
	DropdownMenuShortcut,
	DropdownMenuTrigger,
} from "@anvilkit/ui/dropdown-menu";
import { cn } from "@anvilkit/ui/lib/utils";
import { Loader2, MoreHorizontal } from "lucide-react";
import { type ReactNode, useMemo, useSyncExternalStore } from "react";
import {
	useCanvasStudio,
	useCanvasT,
} from "../../context/canvas-studio-context.js";
import type { ToolId } from "../../stores/tool-store.js";
import {
	type EffectiveToolDescriptor,
	effectiveToolDescriptors,
} from "./effective-tools.js";

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

/**
 * Where the workspace floats the tool cluster (the v2 layout decision: INSIDE
 * the canvas section, not a grid column). Shared by the default strip and the
 * custom-`renderer` wrapper so a replacement renders in the same spot.
 */
const STRIP_POSITION_CLASSES =
	"pointer-events-auto absolute top-1/2 left-3 z-30 -translate-y-1/2";

/** Props handed to a custom `toolStrip` renderer (FR-010). */
export interface CanvasToolStripRendererProps {
	/**
	 * Display-ready tool descriptors: built-ins in rail order, then extension
	 * tools — the same effective list the default strip renders.
	 */
	descriptors: readonly EffectiveToolDescriptor[];
	activeToolId: ToolId;
	setActiveTool: (id: ToolId) => void;
}

/**
 * `<CanvasWorkspace toolStrip>` options (FR-010), mirroring the `shortcuts`
 * boolean-or-options pattern.
 */
export interface CanvasToolStripOptions {
	/**
	 * Filters/reorders the visible rail. Ids resolve against the EFFECTIVE
	 * descriptors, so an extension tool id may be promoted into the rail (a
	 * promoted tool leaves the "More tools" overflow); unknown ids are
	 * dropped. Extension tools NOT listed stay in the overflow; built-ins not
	 * listed are hidden.
	 */
	items?: readonly ToolId[];
	/**
	 * Replaces the strip's rendering entirely — the workspace still positions
	 * the cluster over the canvas. Receives the effective descriptors plus
	 * live active-tool state.
	 */
	renderer?: (props: CanvasToolStripRendererProps) => ReactNode;
}

export interface ToolStripProps extends CanvasToolStripOptions {
	className?: string;
}

/**
 * The floating tool strip (B-06, PRD 0012 FR-010 — the v2 layout decision:
 * a floating cluster INSIDE the canvas section, not a new grid column).
 * The rail renders the built-in `TOOL_RAIL_ITEMS` (or the `items` selection);
 * extension-registered tools surface under a "More tools" overflow menu at
 * the strip's end. Tooltips carry the registry-derived shortcut labels.
 * Hidden or replaced via `<CanvasWorkspace toolStrip>`.
 */
export function ToolStrip({
	className,
	items,
	renderer,
}: ToolStripProps): React.JSX.Element {
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
	const descriptors = useMemo(
		() => effectiveToolDescriptors(ctx.toolRegistry, t),
		[ctx.toolRegistry, t],
	);
	const setActiveTool = (id: ToolId): void =>
		ctx.toolStore.getState().setActiveTool(id);

	/** FR-011 rail/overflow button state, identical for both surfaces. */
	const stateOf = (d: EffectiveToolDescriptor) => ({
		isActive: activeTool === d.id,
		isLoading: aiJobPending && AI_LOADING_TOOL_IDS.has(d.id),
		isDisabled:
			(IMAGE_PICKER_TOOL_IDS.has(d.id) && ctx.hasImagePicker === false) ||
			(d.disabled?.() ?? false),
	});

	if (renderer) {
		return (
			<div
				data-testid="tool-strip-custom"
				className={cn(STRIP_POSITION_CLASSES, className)}
			>
				{renderer({ descriptors, activeToolId: activeTool, setActiveTool })}
			</div>
		);
	}

	const byId = new Map(descriptors.map((d) => [d.id, d]));
	const rail = items
		? items.flatMap((id) => {
				const d = byId.get(id);
				return d ? [d] : [];
			})
		: descriptors.filter((d) => d.builtin);
	const railIds = new Set(rail.map((d) => d.id));
	const overflow = descriptors.filter((d) => !d.builtin && !railIds.has(d.id));
	const overflowActive = overflow.some((d) => activeTool === d.id);
	const moreLabel = t("canvas.toolstrip.moreTools", "More tools");

	return (
		<div
			data-testid="tool-strip"
			role="toolbar"
			aria-orientation="vertical"
			aria-label={t("canvas.toolstrip.label", "Tools")}
			className={cn(
				"flex max-h-[80%] flex-col gap-0.5 overflow-y-auto rounded-xl bg-card p-1 shadow-lg ring-1 ring-border",
				STRIP_POSITION_CLASSES,
				className,
			)}
		>
			{rail.map((tool) => {
				const { isActive, isLoading, isDisabled } = stateOf(tool);
				const Icon = tool.icon;
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
						aria-label={tool.label}
						aria-keyshortcuts={tool.shortcutLabel}
						title={
							tool.shortcutLabel
								? `${tool.label} (${tool.shortcutLabel})`
								: tool.label
						}
						onClick={() => setActiveTool(tool.id)}
					>
						{isLoading ? (
							<Loader2 aria-hidden className="animate-spin" />
						) : (
							<Icon aria-hidden />
						)}
					</Button>
				);
			})}
			{overflow.length > 0 ? (
				<DropdownMenu>
					<DropdownMenuTrigger
						data-testid="tool-strip-more"
						data-active={overflowActive ? "true" : "false"}
						aria-label={moreLabel}
						title={moreLabel}
						className={cn(
							buttonVariants({
								variant: overflowActive ? "default" : "ghost",
								size: "icon-sm",
							}),
						)}
					>
						<MoreHorizontal aria-hidden />
					</DropdownMenuTrigger>
					<DropdownMenuContent side="right" align="start">
						{overflow.map((tool) => {
							const { isActive, isLoading, isDisabled } = stateOf(tool);
							const Icon = tool.icon;
							return (
								<DropdownMenuCheckboxItem
									key={tool.id as string}
									checked={isActive}
									disabled={isDisabled}
									closeOnClick
									data-testid={`tool-strip-more-${tool.id}`}
									data-active={isActive ? "true" : "false"}
									data-loading={isLoading ? "true" : "false"}
									aria-busy={isLoading || undefined}
									onClick={() => setActiveTool(tool.id)}
								>
									{isLoading ? (
										<Loader2 aria-hidden className="animate-spin" />
									) : (
										<Icon aria-hidden />
									)}
									{tool.label}
									{tool.shortcutLabel ? (
										<DropdownMenuShortcut>
											{tool.shortcutLabel}
										</DropdownMenuShortcut>
									) : null}
								</DropdownMenuCheckboxItem>
							);
						})}
					</DropdownMenuContent>
				</DropdownMenu>
			) : null}
		</div>
	);
}
