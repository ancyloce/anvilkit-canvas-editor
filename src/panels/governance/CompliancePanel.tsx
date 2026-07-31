"use client";

import type { BrandComplianceIssue } from "@anvilkit/canvas-core";
import { Windowed } from "@anvilkit/ui/windowed";
// Required binding: this package builds CLASSIC JSX, so `dist` throws
// "React is not defined" without it and typecheck does not catch it.
import * as React from "react";
import { useCallback, useMemo } from "react";

import type { ComplianceNavigationTarget } from "../../brand-governance/use-compliance-navigation.js";
import { useComplianceNavigation } from "../../brand-governance/use-compliance-navigation.js";
import type { CanvasT } from "../../context/canvas-studio-context.js";
import { ComplianceIssueRow } from "./ComplianceIssueRow.js";

/**
 * @file The compliance issue list (plan 0021 T-044).
 *
 * ## It extends the Brand surface rather than adding a third one
 *
 * T-044 step 1. `BrandPanel` already owns "check compliance" and
 * `complianceIssueMessage`; `brand-warnings.tsx` already shows the selection's
 * issues in the Inspector. A separate top-level Governance panel would be a
 * third place the same report is rendered, and the three would drift. This
 * component is the Brand panel's report body, promoted to its own file because
 * it now has navigation and virtualization in it.
 *
 * ## Virtualized (T-044 step 6)
 *
 * A brand sweep over a real campaign document produces thousands of issues —
 * far more than the layer tree ever holds, because one node contributes one per
 * off-brand property. `Windowed`'s default threshold keeps small reports as
 * plain DOM, so the common case is unchanged.
 */

export interface CompliancePanelProps {
	issues: readonly BrandComplianceIssue[];
	t: CanvasT;
	/**
	 * Told when a row resolves to a Component Source instead of a page node, so
	 * the host surface can point the user at the Components panel (T-044's
	 * documented fallback). Navigation itself never changes scope.
	 */
	onComponentTarget?: (componentId: string) => void;
}

interface Row {
	readonly issue: BrandComplianceIssue;
	readonly target: ComplianceNavigationTarget;
	readonly key: string;
}

export function CompliancePanel({
	issues,
	t,
	onComponentTarget,
}: CompliancePanelProps): React.JSX.Element {
	const navigation = useComplianceNavigation();

	const rows = useMemo<readonly Row[]>(() => {
		// Resolution is by structural id only (see `use-compliance-navigation`),
		// so it is stable across locales and safe to precompute here.
		const seen = new Map<string, number>();
		return issues.map((issue) => {
			// The scanner already deduplicates by semantic key, but a row key must
			// survive a caller that passes an unnormalized list — a duplicate React
			// key silently drops a row, which reads as a missing issue.
			const base = `${issue.nodeId}|${issue.code}|${issue.property}|${issue.propertyId ?? ""}`;
			const n = seen.get(base) ?? 0;
			seen.set(base, n + 1);
			return {
				issue,
				target: navigation.resolve(issue),
				key: n === 0 ? base : `${base}#${n}`,
			};
		});
	}, [issues, navigation]);

	const activate = useCallback(
		(issue: BrandComplianceIssue) => {
			const target = navigation.navigate(issue);
			if (target.kind === "component") onComponentTarget?.(target.componentId);
		},
		[navigation, onComponentTarget],
	);

	// `useCallback`-stable per `Windowed`'s contract — an inline arrow here would
	// re-render every row on every parent render and defeat the windowing.
	const renderRow = useCallback(
		(row: Row) => (
			<ComplianceIssueRow
				issue={row.issue}
				target={row.target}
				onActivate={activate}
				t={t}
			/>
		),
		[activate, t],
	);

	if (rows.length === 0) {
		return (
			<p
				className="text-xs text-muted-foreground"
				data-testid="compliance-panel-clean"
			>
				{t("canvas.governance.complianceClean", "No brand issues found.")}
			</p>
		);
	}

	return (
		<div className="flex flex-col gap-1" data-testid="compliance-panel">
			<Windowed
				items={rows}
				renderItem={renderRow}
				itemKey={(row: Row) => row.key}
				estimateSize={30}
				maxHeight={280}
				as="ul"
				aria-label={t(
					"canvas.governance.compliancePanelTitle",
					"Brand compliance",
				)}
				data-testid="compliance-issue-rows"
			/>
		</div>
	);
}
