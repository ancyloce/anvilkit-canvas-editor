"use client";

import type {
	CanvasComponentVariantSelection,
	CanvasComponentVariantSet,
} from "@anvilkit/canvas-core";
import { canonicalVariantKey } from "@anvilkit/canvas-core";
import { cn } from "@anvilkit/ui/lib/utils";
import * as React from "react";

import type { CanvasT } from "../../context/canvas-studio-context.js";

/**
 * @file One control per variant axis (plan 0021 T-027, TD §11.5).
 *
 * ## Unsupported combinations are marked by TEXT AND ICON, never colour alone
 *
 * A sparse variant set means most axis-value combinations do not exist. Marking
 * those with colour only fails for the ~4% of users with a colour-vision
 * deficiency and for anyone using a screen reader, so each unsupported option
 * carries a visible marker character, a `title`, and `aria-disabled` — the
 * T-027 DoD.
 *
 * ## Availability is computed against the OTHER axes' current values
 *
 * "Is `size=lg` available?" only has an answer relative to the rest of the
 * selection: `lg` may exist with `tone=brand` and not with `tone=neutral`. So
 * each option is tested by substituting it into the current selection and
 * asking whether that exact combination is declared.
 */

export interface VariantControlsProps {
	set: CanvasComponentVariantSet;
	/** Current persisted selection (may be partial or stale). */
	selection: CanvasComponentVariantSelection | undefined;
	onChange: (next: CanvasComponentVariantSelection) => void;
	/** Marks options whose selection would orphan an override. */
	orphanWarning?: (next: CanvasComponentVariantSelection) => boolean;
	disabled?: boolean;
	t: CanvasT;
	className?: string;
}

/** Selection with every axis filled from its default — the resolution baseline. */
function normalized(
	set: CanvasComponentVariantSet,
	selection: CanvasComponentVariantSelection | undefined,
): Record<string, string> {
	const out: Record<string, string> = {};
	for (const axis of set.axes) {
		const requested = selection?.[axis.id];
		out[axis.id] =
			requested !== undefined && axis.values.some((v) => v.id === requested)
				? requested
				: axis.defaultValueId;
	}
	return out;
}

export function VariantControls({
	set,
	selection,
	onChange,
	orphanWarning,
	disabled = false,
	t,
	className,
}: VariantControlsProps): React.JSX.Element {
	const current = normalized(set, selection);
	const declared = new Set(
		set.variants.map((v) => canonicalVariantKey(v.selection)),
	);

	return (
		<div
			className={cn("flex flex-col gap-2", className)}
			data-testid="variant-controls"
		>
			{set.axes.map((axis) => (
				<div key={axis.id} className="flex flex-col gap-1">
					<span
						className="text-[11px] text-muted-foreground"
						id={`variant-axis-${axis.id}`}
					>
						{axis.name ?? axis.id}
					</span>
					<div
						role="radiogroup"
						aria-labelledby={`variant-axis-${axis.id}`}
						data-testid={`variant-axis-${axis.id}`}
						className="flex flex-wrap gap-1"
					>
						{axis.values.map((value) => {
							const candidate = { ...current, [axis.id]: value.id };
							const available = declared.has(canonicalVariantKey(candidate));
							const wouldOrphan = orphanWarning?.(candidate) === true;
							const active = current[axis.id] === value.id;

							return (
								<button
									key={value.id}
									type="button"
									role="radio"
									aria-checked={active}
									// Unsupported options stay FOCUSABLE and announced —
									// `aria-disabled` rather than `disabled` — so a keyboard
									// user can discover that the combination does not exist
									// instead of tabbing past an invisible gap.
									aria-disabled={!available || disabled}
									data-testid={`variant-value-${axis.id}-${value.id}`}
									data-available={available}
									title={
										available
											? wouldOrphan
												? t(
														"canvas.variants.wouldOrphan",
														"Selecting this keeps overrides that no longer apply.",
													)
												: undefined
											: t(
													"canvas.variants.unavailable",
													"This combination is not available.",
												)
									}
									onClick={() => {
										if (!available || disabled) return;
										onChange({ ...selection, [axis.id]: value.id });
									}}
									className={cn(
										"rounded border px-2 py-0.5 text-xs",
										active && "border-primary bg-accent",
										!available && "opacity-50",
									)}
								>
									{value.name ?? value.id}
									{available ? null : (
										// Text marker, not colour: the DoD.
										<span aria-hidden="true" className="ml-1">
											✕
										</span>
									)}
									{available && wouldOrphan ? (
										<span aria-hidden="true" className="ml-1">
											⚠
										</span>
									) : null}
									{available ? null : (
										<span className="sr-only">
											{t(
												"canvas.variants.unavailable",
												"This combination is not available.",
											)}
										</span>
									)}
								</button>
							);
						})}
					</div>
				</div>
			))}
		</div>
	);
}
