"use client";

import type { CanvasComponentCompatibilityReport } from "@anvilkit/canvas-core/component-libraries";
import { Button } from "@anvilkit/ui/button";
import { cn } from "@anvilkit/ui/lib/utils";
import * as React from "react";

import type { CanvasT } from "../../context/canvas-studio-context.js";

/**
 * @file Update / swap confirmation (plan 0021 T-031, and T-032's dialog).
 *
 * ## One dialog, two verbs
 *
 * Update and swap present the same evidence — a compatibility report and a
 * per-override outcome — and differ only in wording and in whether a scope
 * choice is offered. Two components would be two places for the preview to
 * drift away from what the command actually does.
 *
 * ## Cancel is inert, and that is tested
 *
 * Nothing here mutates. The dialog is a pure view over a report computed by
 * `previewSourceChange` — the same call the command makes — and reports the
 * user's choice through callbacks. A cancel path that "cleaned up" would imply
 * something had already been applied.
 */

export type ComponentChangeVerb = "update" | "swap";

export interface UpdateComponentDialogProps {
	verb: ComponentChangeVerb;
	report: CanvasComponentCompatibilityReport;
	/** Instances the change would affect, for the scope choice. */
	affectedInstanceCount: number;
	/** Sanitized already by the caller (T-009); rendered only when present. */
	releaseNotesUrl?: string;
	fromVersion: string;
	toVersion: string;
	onConfirm: (scope: "instance" | "all") => void;
	onCancel: () => void;
	t: CanvasT;
	className?: string;
}

function OutcomeList({
	report,
	t,
}: {
	report: CanvasComponentCompatibilityReport;
	t: CanvasT;
}): React.JSX.Element {
	const preserved = report.properties.filter(
		(p) => p.kind === "exact" || p.kind === "semantic",
	);
	const orphaned = report.properties.filter(
		(p) => p.kind === "orphaned" || p.kind === "ambiguous",
	);
	const blocked = report.properties.filter((p) => p.kind === "blocked");

	const row = (
		testId: string,
		label: string,
		items: typeof report.properties,
		marker: string,
	) =>
		items.length === 0 ? null : (
			<li data-testid={testId} className="flex items-start gap-2">
				{/* Marker character, not colour alone — same rule as VariantControls. */}
				<span aria-hidden="true">{marker}</span>
				<span className="text-xs">
					{label.replace("{n}", String(items.length))}
					<span className="ml-1 text-muted-foreground">
						({items.map((i) => i.fromPropertyId).join(", ")})
					</span>
				</span>
			</li>
		);

	return (
		<ul className="flex flex-col gap-1" data-testid="change-outcomes">
			{row(
				"outcome-preserved",
				t("canvas.componentChange.preserved", "{n} override(s) carried over"),
				preserved,
				"✓",
			)}
			{row(
				"outcome-orphaned",
				t(
					"canvas.componentChange.orphaned",
					"{n} override(s) kept but no longer applied",
				),
				orphaned,
				"⚠",
			)}
			{row(
				"outcome-blocked",
				t(
					"canvas.componentChange.blocked",
					"{n} override(s) cannot transfer — the property changed type",
				),
				blocked,
				"✕",
			)}
		</ul>
	);
}

export function UpdateComponentDialog({
	verb,
	report,
	affectedInstanceCount,
	releaseNotesUrl,
	fromVersion,
	toVersion,
	onConfirm,
	onCancel,
	t,
	className,
}: UpdateComponentDialogProps): React.JSX.Element {
	const headingId = React.useId();
	const confirmRef = React.useRef<HTMLButtonElement | null>(null);

	// Focus the primary action on open so a keyboard user is not left at the
	// document root, and so Escape/Tab have a defined starting point.
	React.useEffect(() => {
		confirmRef.current?.focus();
	}, []);

	return (
		<div
			role="dialog"
			aria-modal="true"
			aria-labelledby={headingId}
			data-testid={`component-${verb}-dialog`}
			className={cn("flex flex-col gap-3 p-4", className)}
			onKeyDown={(event) => {
				if (event.key === "Escape") onCancel();
			}}
		>
			<h2 id={headingId} className="text-sm font-medium">
				{verb === "update"
					? t("canvas.componentChange.updateTitle", "Update component")
					: t("canvas.componentChange.swapTitle", "Swap component")}
			</h2>

			<p
				className="text-xs text-muted-foreground"
				data-testid="change-versions"
			>
				{t("canvas.componentChange.versions", "{from} → {to}")
					.replace("{from}", fromVersion)
					.replace("{to}", toVersion)}
			</p>

			<p
				className="text-xs"
				data-testid={`change-classification-${report.classification}`}
			>
				{report.classification === "compatible"
					? t("canvas.componentChange.compatible", "Compatible")
					: report.classification === "review-required"
						? t("canvas.componentChange.reviewRequired", "Review required")
						: t("canvas.componentChange.incompatible", "Incompatible")}
			</p>

			<OutcomeList report={report} t={t} />

			{releaseNotesUrl ? (
				<a
					href={releaseNotesUrl}
					target="_blank"
					rel="noreferrer noopener"
					className="text-xs underline"
					data-testid="change-release-notes"
				>
					{t("canvas.componentChange.releaseNotes", "Release notes")}
				</a>
			) : null}

			<div className="flex items-center justify-end gap-2 pt-1">
				<Button
					size="sm"
					variant="ghost"
					data-testid="change-cancel"
					onClick={onCancel}
				>
					{t("canvas.componentChange.cancel", "Cancel")}
				</Button>
				{verb === "update" && affectedInstanceCount > 1 ? (
					<Button
						size="sm"
						variant="outline"
						data-testid="change-confirm-all"
						onClick={() => onConfirm("all")}
					>
						{t(
							"canvas.componentChange.confirmAll",
							"Update all {n} instances",
						).replace("{n}", String(affectedInstanceCount))}
					</Button>
				) : null}
				<Button
					size="sm"
					ref={confirmRef}
					data-testid="change-confirm"
					onClick={() => onConfirm("instance")}
				>
					{verb === "update"
						? t("canvas.componentChange.confirmOne", "Update this instance")
						: t("canvas.componentChange.confirmSwap", "Swap")}
				</Button>
			</div>
		</div>
	);
}

/** The swap dialog is the same view with the swap verb (T-032). */
export function SwapComponentDialog(
	props: Omit<UpdateComponentDialogProps, "verb">,
): React.JSX.Element {
	return <UpdateComponentDialog {...props} verb="swap" />;
}
