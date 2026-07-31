"use client";

import type { BrandComplianceIssue } from "@anvilkit/canvas-core";
import { cn } from "@anvilkit/ui/lib/utils";
// Required binding: this package builds CLASSIC JSX, so `dist` throws
// "React is not defined" without it and typecheck does not catch it.
import * as React from "react";

import type { ComplianceNavigationTarget } from "../../brand-governance/use-compliance-navigation.js";
import type { CanvasT } from "../../context/canvas-studio-context.js";
import { complianceIssueMessage } from "./compliance-messages.js";

/**
 * @file One compliance row (plan 0021 T-044).
 *
 * ## Status is never colour alone (T-044 step 5)
 *
 * Every row carries a glyph AND a localized severity word in an
 * `aria-label`ed element. Amber-vs-red tells a sighted user with normal colour
 * vision which issues block; it tells a screen reader, a monochrome display and
 * roughly one man in twelve nothing at all. The colour classes stay — they are
 * a redundant channel, not the channel.
 */

export interface ComplianceIssueRowProps {
	issue: BrandComplianceIssue;
	target: ComplianceNavigationTarget;
	onActivate: (issue: BrandComplianceIssue) => void;
	t: CanvasT;
}

/** Glyph + localized word for a severity. `undefined` severity reads as warning. */
export function severityPresentation(
	severity: BrandComplianceIssue["severity"],
	t: CanvasT,
): { glyph: string; label: string } {
	return severity === "blocking"
		? {
				glyph: "⛔",
				label: t("canvas.governance.severityBlocking", "Blocking"),
			}
		: { glyph: "⚠", label: t("canvas.governance.severityWarning", "Warning") };
}

export function ComplianceIssueRow({
	issue,
	target,
	onActivate,
	t,
}: ComplianceIssueRowProps): React.JSX.Element {
	const { glyph, label } = severityPresentation(issue.severity, t);
	const unreachable = target.kind === "unavailable";

	return (
		<button
			type="button"
			data-testid={`compliance-issue-${issue.nodeId}-${issue.code}`}
			data-severity={issue.severity ?? "warning"}
			data-target={target.kind}
			disabled={unreachable}
			onClick={() => onActivate(issue)}
			title={
				unreachable
					? t(
							"canvas.governance.issueUnreachable",
							"This issue's target isn't on a page — find it in the Components panel.",
						)
					: undefined
			}
			className={cn(
				"flex w-full items-start gap-2 rounded-sm px-2 py-1 text-left text-xs",
				"hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
				unreachable && "cursor-default opacity-70",
			)}
		>
			<span
				// Glyph is decorative; the adjacent text carries the same meaning.
				className={cn(
					"shrink-0",
					issue.severity === "blocking"
						? "text-destructive"
						: "text-amber-600 dark:text-amber-400",
				)}
				aria-hidden="true"
			>
				{glyph}
			</span>
			<span className="min-w-0 flex-1">
				<span className="sr-only">{`${label}: `}</span>
				<span className="font-medium">{issue.property}</span>
				<span className="text-muted-foreground">
					{` — ${complianceIssueMessage(t, issue)}`}
				</span>
			</span>
		</button>
	);
}
