"use client";

import {
	type CanvasAnyNodeUpdateCommand,
	type CanvasNode,
	findNode,
} from "@anvilkit/canvas-core";
import { Button } from "@anvilkit/ui/button";
import { cn } from "@anvilkit/ui/lib/utils";
import { Separator } from "@anvilkit/ui/separator";
import { useSyncExternalStore } from "react";
import { useCanvasStudio } from "../context/canvas-studio-context.js";
import { ChromeIcons } from "./icons.js";

/** Node kinds that carry a `fill` property the quick-fill control can set. */
const FILLABLE = new Set<CanvasNode["type"]>([
	"rect",
	"ellipse",
	"text",
	"path",
]);

export interface FloatingSelectionToolbarProps {
	/**
	 * Render as a flat strip pinned below the stage bar instead of a floating
	 * pill (reference `.floating-toolbar.is-docked`). Defaults to floating.
	 */
	docked?: boolean;
	className?: string;
}

/**
 * Selection action pill (reference `.floating-toolbar`). Rendered only when
 * something is selected. Wires the operations the editor's command pipeline
 * supports: Ask AI (host seam), quick fill, and delete. Presentational-only
 * formatting controls from the reference are intentionally omitted so every
 * button does something.
 */
export function FloatingSelectionToolbar({
	docked = false,
	className,
}: FloatingSelectionToolbarProps): React.JSX.Element | null {
	const ctx = useCanvasStudio();
	const selectedIds = useSyncExternalStore(
		ctx.selectionStore.subscribe,
		() => ctx.selectionStore.getState().selectedIds,
		() => ctx.selectionStore.getState().selectedIds,
	);

	if (selectedIds.length === 0) return null;

	const nodes = selectedIds
		.map((id) => findNode(ctx.ir, id)?.node)
		.filter((n): n is CanvasNode => Boolean(n));
	const fillable = nodes.filter((n) => FILLABLE.has(n.type));
	const currentFill =
		(fillable[0] as { fill?: string } | undefined)?.fill ?? "#000000";

	const askAi = () => {
		const first = nodes[0];
		if (!first) return;
		ctx.requestAiIntent?.({
			kind: "ai-brush-select",
			nodeId: first.id,
			context: { artboardId: ctx.activePageId },
		});
	};

	const applyFill = (fill: string) => {
		for (const node of fillable) {
			ctx.commit({
				type: "node.update",
				nodeId: node.id,
				kind: node.type,
				patch: { fill },
			} as CanvasAnyNodeUpdateCommand);
		}
	};

	const deleteSelection = () => {
		for (const id of selectedIds) {
			ctx.commit({ type: "node.delete", nodeId: id });
		}
		ctx.selectionStore.getState().clearSelection();
	};

	return (
		<div
			data-testid="floating-selection-toolbar"
			data-ak-floating-toolbar=""
			data-docked={docked ? "true" : "false"}
			role="toolbar"
			aria-label="Selection actions"
			className={cn(
				"z-30 flex items-center gap-0.5 overflow-x-auto bg-card text-foreground",
				docked
					? "w-full shrink-0 border-b border-border px-3 py-1.5"
					: "absolute top-14 left-1/2 -translate-x-1/2 rounded-full px-1.5 py-1 shadow-lg ring-1 ring-border",
				className,
			)}
		>
			{ctx.requestAiIntent ? (
				<>
					<Button
						type="button"
						size="sm"
						variant="secondary"
						data-testid="floating-ask-ai"
						className="gap-1.5 rounded-full font-semibold"
						onClick={askAi}
					>
						<ChromeIcons.sparkles aria-hidden />
						Ask AI
					</Button>
					<Separator orientation="vertical" className="mx-1 h-4.5" />
				</>
			) : null}

			<label
				className="inline-flex cursor-pointer items-center gap-1.5 rounded-md px-1.5 py-1 hover:bg-muted"
				title="Fill color"
			>
				<span
					className="size-4 rounded-sm ring-1 ring-border"
					style={{ backgroundColor: currentFill }}
				/>
				<input
					type="color"
					aria-label="Fill color"
					data-testid="floating-fill"
					defaultValue={currentFill}
					disabled={fillable.length === 0}
					className="sr-only"
					onChange={(e) => applyFill(e.currentTarget.value)}
				/>
			</label>

			<Separator orientation="vertical" className="mx-1 h-4.5" />

			<Button
				type="button"
				size="icon-sm"
				variant="ghost"
				data-testid="floating-delete"
				aria-label="Delete selection"
				title="Delete"
				onClick={deleteSelection}
			>
				<ChromeIcons.delete aria-hidden />
			</Button>
		</div>
	);
}
