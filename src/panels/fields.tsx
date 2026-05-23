"use client";

import type {
	CanvasAnyNodeUpdateCommand,
	CanvasNode,
} from "@anvilkit/canvas-core";
import { Input } from "@anvilkit/ui/input";
import { type ReactNode, useCallback } from "react";
import { useCanvasStudio } from "../context/canvas-studio-context.js";

/**
 * @file Shared inspector field primitives. Extracted verbatim from
 * `PropertyInspector` so the Canva-shell `CanvasToolbar` can surface the same
 * commit-on-blur controls without duplicating logic. Behavior is unchanged —
 * the inspector and the toolbar render identical fields and commit through the
 * same `node.update` pipeline via {@link useCommitPatch}.
 */

const eyebrowClass =
	"text-[11px] font-semibold uppercase tracking-wide text-muted-foreground";

export function Section({
	title,
	children,
}: {
	title: string;
	children: ReactNode;
}): React.JSX.Element {
	return (
		<div className="flex flex-col gap-2">
			<div className={eyebrowClass}>{title}</div>
			{children}
		</div>
	);
}

export function FieldRow({
	label,
	children,
}: {
	label: string;
	children: ReactNode;
}): React.JSX.Element {
	return (
		<label className="grid grid-cols-[64px_1fr] items-center gap-2.5">
			<span className="text-[11.5px] text-muted-foreground">{label}</span>
			{children}
		</label>
	);
}

export interface NumberFieldProps {
	label: string;
	value: number;
	step?: number;
	min?: number;
	max?: number;
	dataTestId: string;
	onCommit: (next: number) => void;
}

export function NumberField({
	label,
	value,
	step,
	min,
	max,
	dataTestId,
	onCommit,
}: NumberFieldProps): React.JSX.Element {
	return (
		<FieldRow label={label}>
			<Input
				// Uncontrolled (commit-on-blur), so re-key on external value changes
				// (drag/nudge/undo) to remount with a fresh defaultValue instead of
				// mutating an initialized Base UI FieldControl (which warns + leaves
				// the field stale). Stable while typing — the store only updates on blur.
				key={value}
				type="number"
				aria-label={label}
				defaultValue={value}
				step={step ?? 1}
				className="h-7.5 text-xs"
				{...(min !== undefined ? { min } : {})}
				{...(max !== undefined ? { max } : {})}
				data-testid={dataTestId}
				onBlur={(e) => {
					const parsed = Number.parseFloat(e.currentTarget.value);
					if (!Number.isNaN(parsed) && parsed !== value) onCommit(parsed);
				}}
			/>
		</FieldRow>
	);
}

export interface TextFieldProps {
	label: string;
	value: string;
	dataTestId: string;
	onCommit: (next: string) => void;
}

export function TextField({
	label,
	value,
	dataTestId,
	onCommit,
}: TextFieldProps): React.JSX.Element {
	return (
		<FieldRow label={label}>
			<Input
				// See NumberField: re-key uncontrolled input on external value change.
				key={value}
				type="text"
				aria-label={label}
				defaultValue={value}
				className="h-7.5 text-xs"
				data-testid={dataTestId}
				onBlur={(e) => {
					if (e.currentTarget.value !== value) onCommit(e.currentTarget.value);
				}}
			/>
		</FieldRow>
	);
}

export interface ColorFieldProps {
	label: string;
	value: string | undefined;
	dataTestId: string;
	onCommit: (next: string) => void;
}

export function ColorField({
	label,
	value,
	dataTestId,
	onCommit,
}: ColorFieldProps): React.JSX.Element {
	return (
		<FieldRow label={label}>
			<div className="flex items-center gap-2">
				<span
					className="size-5 shrink-0 rounded-sm ring-1 ring-border"
					style={{ backgroundColor: value ?? "#000000" }}
					aria-hidden
				/>
				<Input
					// See NumberField: re-key uncontrolled input on external value change.
					key={value ?? "#000000"}
					type="color"
					aria-label={label}
					defaultValue={value ?? "#000000"}
					className="h-7.5 flex-1 p-0.5"
					data-testid={dataTestId}
					onBlur={(e) => {
						if (e.currentTarget.value !== value)
							onCommit(e.currentTarget.value);
					}}
				/>
			</div>
		</FieldRow>
	);
}

/** Applies a partial node patch through the editor's `node.update` pipeline. */
export type CommitPatch = (
	node: CanvasNode,
	patch: Record<string, unknown>,
) => void;

/**
 * Returns a stable {@link CommitPatch} bound to the current studio context.
 * Identical to the inspector's former local `commitPatch` — every field
 * mutation flows through `ctx.commit({ type: "node.update", … })`.
 */
export function useCommitPatch(): CommitPatch {
	const ctx = useCanvasStudio();
	return useCallback<CommitPatch>(
		(targetNode, patch) => {
			const cmd = {
				type: "node.update",
				nodeId: targetNode.id,
				kind: targetNode.type,
				patch,
			} as CanvasAnyNodeUpdateCommand;
			ctx.commit(cmd);
		},
		[ctx],
	);
}
