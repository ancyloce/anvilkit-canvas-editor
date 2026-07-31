"use client";

import type { CanvasNode } from "@anvilkit/canvas-core";
// Required binding: this package builds CLASSIC JSX, so `dist` throws
// "React is not defined" without it and typecheck does not catch it.
import * as React from "react";
import { useMemo } from "react";
import { useBrandKitDefinition } from "../../brand/use-brand-kit.js";
import { useInstanceCompliance } from "../../brand-governance/use-instance-compliance.js";
import {
	useCanvasStudio,
	useCanvasT,
} from "../../context/canvas-studio-context.js";
import { complianceIssueMessage } from "../governance/compliance-messages.js";
import { severityPresentation } from "../governance/ComplianceIssueRow.js";

/**
 * FR-142 (C-07): passive, non-blocking brand warnings for the CURRENT
 * selection. Reuses core's compliance checker — the same one the Brand
 * panel's on-demand report runs — filtered to the selected nodes, so the two
 * surfaces can never disagree. Renders nothing without a full
 * `BrandKitDefinition` or a clean selection; never intercepts editing.
 */
export function BrandComplianceWarnings({
	nodes,
}: {
	nodes: readonly CanvasNode[];
}): React.JSX.Element | null {
	const ctx = useCanvasStudio();
	const definition = useBrandKitDefinition();
	const t = useCanvasT();
	// Plan 0021 T-043. The scan is memoized on `[ir, brandKit]` ONLY, so moving
	// the selection is a `Map.get` rather than a whole-document re-scan. The
	// previous version depended on `nodes` (and on `t`), which meant every click
	// re-scanned a 1,000-node document and discarded almost all of the result.
	const compliance = useInstanceCompliance(ctx.ir, definition);
	const messages = useMemo(() => {
		if (nodes.length === 0) return [];
		const issues = compliance.forNodes(nodes.map((n) => n.id));
		// Dedupe identical property+message pairs across a multi-selection, and
		// keep the WORST severity for each — a selection containing one blocking
		// instance must not read as a warning because a warning came last.
		const bySeverity = new Map<string, "warning" | "blocking">();
		for (const issue of issues) {
			const text = `${issue.property}: ${complianceIssueMessage(t, issue)}`;
			if (issue.severity === "blocking" || !bySeverity.has(text)) {
				bySeverity.set(
					text,
					issue.severity === "blocking" ? "blocking" : "warning",
				);
			}
		}
		return [...bySeverity].map(([text, severity]) => ({ text, severity }));
	}, [compliance, nodes, t]);

	if (messages.length === 0) return null;
	return (
		<div
			data-testid="brand-warnings"
			role="status"
			className="space-y-1 rounded-md bg-amber-500/10 px-2.5 py-1.5 text-[0.7rem] text-amber-700 dark:text-amber-400"
		>
			<div className="font-medium">
				{t("canvas.brand.warningsTitle", "Off-brand selection")}
			</div>
			{/* T-044 step 5: status by glyph AND word, never colour alone. */}
			{messages.map(({ text, severity }) => {
				const { glyph, label } = severityPresentation(severity, t);
				return (
					<div key={text} data-severity={severity} className="flex gap-1.5">
						<span aria-hidden="true">{glyph}</span>
						<span>
							<span className="sr-only">{`${label}: `}</span>
							{text}
						</span>
					</div>
				);
			})}
		</div>
	);
}
