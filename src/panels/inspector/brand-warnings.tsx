"use client";

import {
	type CanvasNode,
	generateBrandComplianceReport,
} from "@anvilkit/canvas-core";
import { useMemo } from "react";
import { useBrandKitDefinition } from "../../brand/use-brand-kit.js";
import {
	useCanvasStudio,
	useCanvasT,
} from "../../context/canvas-studio-context.js";
import { complianceIssueMessage } from "../BrandPanel.js";

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
	const messages = useMemo(() => {
		if (!definition || nodes.length === 0) return [];
		const ids = new Set(nodes.map((n) => n.id));
		const issues = generateBrandComplianceReport(
			ctx.ir,
			definition,
		).issues.filter((issue) => ids.has(issue.nodeId));
		// Dedupe identical property+message pairs across a multi-selection.
		return Array.from(
			new Set(
				issues.map(
					(issue) => `${issue.property}: ${complianceIssueMessage(t, issue)}`,
				),
			),
		);
	}, [ctx.ir, definition, nodes, t]);

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
			{messages.map((message) => (
				<div key={message}>{message}</div>
			))}
		</div>
	);
}
