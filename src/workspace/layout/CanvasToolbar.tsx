"use client";

import { type CanvasNode, findNode } from "@anvilkit/canvas-core";
import { Input } from "@anvilkit/ui/input";
import { cn } from "@anvilkit/ui/lib/utils";
import { Separator } from "@anvilkit/ui/separator";
import { useSyncExternalStore } from "react";
import {
	useCanvasStudio,
	useCanvasT,
} from "@/context/canvas-studio-context.js";
import { useCommitPatch } from "@/panels/fields.js";

/** Node kinds that carry a `fill`. */
const FILL_TYPES = new Set<CanvasNode["type"]>([
	"rect",
	"ellipse",
	"text",
	"path",
]);
/** Node kinds that carry a `stroke` / `strokeWidth` (the "border"). */
const STROKE_TYPES = new Set<CanvasNode["type"]>([
	"rect",
	"ellipse",
	"line",
	"path",
]);

export interface CanvasToolbarProps {
	className?: string;
}

/**
 * Dynamic property toolbar — a floating, centered pill above the page (Canva
 * style). Surfaces the most-used quick props for the selected node
 * (fill · border · width · opacity), committing through the shared
 * `node.update` pipeline. Renders nothing when the selection is empty.
 */
export function CanvasToolbar({
	className,
}: CanvasToolbarProps): React.JSX.Element | null {
	const ctx = useCanvasStudio();
	const t = useCanvasT();
	const commitPatch = useCommitPatch();
	const selectedIds = useSyncExternalStore(
		ctx.selectionStore.subscribe,
		() => ctx.selectionStore.getState().selectedIds,
		() => ctx.selectionStore.getState().selectedIds,
	);

	const firstId = selectedIds[0];
	const node = firstId ? (findNode(ctx.ir, firstId)?.node ?? null) : null;
	if (!node) return null;

	const hasFill = FILL_TYPES.has(node.type);
	const hasStroke = STROKE_TYPES.has(node.type);

	return (
		// Fixed, non-interactive lane pinned to the top of the canvas so the pill
		// floats over the page (centered) without taking layout space / pushing
		// the canvas down; only the pill itself captures pointer events.
		<div className="pointer-events-none absolute inset-x-0 top-0 z-20 flex justify-center p-3">
			<div
				data-testid="canvas-toolbar"
				data-node-id={node.id}
				role="toolbar"
				aria-label={t("canvas.toolbar.elementProperties", "Element properties")}
				className={cn(
					"pointer-events-auto inline-flex h-11 max-w-full items-center gap-1 overflow-x-auto rounded-full border border-border bg-card px-2 shadow-md",
					className,
				)}
			>
				{hasFill ? (
					<SwatchControl
						label={t("canvas.toolbar.fill", "Fill")}
						value={(node as { fill?: string }).fill}
						testId="toolbar-fill"
						onCommit={(v) => commitPatch(node, { fill: v })}
					/>
				) : null}
				{hasFill && hasStroke ? <PillDivider /> : null}
				{hasStroke ? (
					<SwatchControl
						label={t("canvas.toolbar.border", "Border")}
						value={(node as { stroke?: string }).stroke}
						testId="toolbar-stroke"
						onCommit={(v) => commitPatch(node, { stroke: v })}
					/>
				) : null}
				{hasStroke ? (
					<NumberControl
						label={t("canvas.toolbar.width", "Width")}
						value={(node as { strokeWidth?: number }).strokeWidth ?? 0}
						min={0}
						testId="toolbar-stroke-width"
						onCommit={(v) => commitPatch(node, { strokeWidth: v })}
					/>
				) : null}
				<PillDivider />
				<NumberControl
					label={t("canvas.toolbar.opacity", "Opacity")}
					value={node.opacity ?? 1}
					step={0.05}
					min={0}
					max={1}
					testId="toolbar-opacity"
					onCommit={(v) => commitPatch(node, { opacity: v })}
				/>
			</div>
		</div>
	);
}

function PillDivider(): React.JSX.Element {
	return (
		<Separator
			orientation="vertical"
			className="mx-0.5 h-5 data-vertical:self-center"
		/>
	);
}

/** Compact color control: a swatch + label that opens the native picker. */
function SwatchControl({
	label,
	value,
	testId,
	onCommit,
}: {
	label: string;
	value: string | undefined;
	testId: string;
	onCommit: (next: string) => void;
}): React.JSX.Element {
	return (
		<label
			className="inline-flex cursor-pointer items-center gap-1.5 rounded-full px-2 py-1 hover:bg-muted"
			title={label}
		>
			<span
				className="size-4 rounded-full ring-1 ring-border"
				style={{ backgroundColor: value ?? "#000000" }}
				aria-hidden
			/>
			<span className="text-xs text-muted-foreground">{label}</span>
			<input
				// Commit-on-blur (after the picker closes); re-key on external change.
				key={value ?? "#000000"}
				type="color"
				aria-label={label}
				defaultValue={value ?? "#000000"}
				data-testid={testId}
				className="sr-only"
				onBlur={(e) => {
					if (e.currentTarget.value !== value) onCommit(e.currentTarget.value);
				}}
			/>
		</label>
	);
}

/** Compact number control reusing the `@anvilkit/ui` Input, sized for the pill. */
function NumberControl({
	label,
	value,
	step,
	min,
	max,
	testId,
	onCommit,
}: {
	label: string;
	value: number;
	step?: number;
	min?: number;
	max?: number;
	testId: string;
	onCommit: (next: number) => void;
}): React.JSX.Element {
	return (
		<label className="inline-flex items-center gap-1.5 px-1.5" title={label}>
			<span className="text-xs text-muted-foreground">{label}</span>
			<Input
				// See SwatchControl: commit-on-blur, re-key on external value change.
				key={value}
				type="number"
				aria-label={label}
				defaultValue={value}
				step={step ?? 1}
				min={min}
				max={max}
				data-testid={testId}
				className="h-7 w-14 rounded-md px-1.5 text-xs"
				onBlur={(e) => {
					const parsed = Number.parseFloat(e.currentTarget.value);
					if (!Number.isNaN(parsed) && parsed !== value) onCommit(parsed);
				}}
			/>
		</label>
	);
}
