"use client";

import type { BrandComplianceIssue } from "@anvilkit/canvas-core";

import type { CanvasT } from "../../context/canvas-studio-context.js";

/**
 * @file Compliance copy, derived from `code` (plan 0021 T-041/T-044).
 *
 * ## Why this is not in `BrandPanel.tsx` any more
 *
 * It used to be, and three surfaces imported it from there: the Brand panel,
 * the Inspector's warnings, and now the compliance rows. Once `BrandPanel`
 * started rendering `CompliancePanel`, that made a genuine import cycle
 * (`BrandPanel → CompliancePanel → ComplianceIssueRow → BrandPanel`), which
 * `pnpm madge` correctly refused. A shared leaf is the fix; `BrandPanel`
 * re-exports the name so the public API is unchanged.
 *
 * ## Copy comes from `code`, never from the issue
 *
 * `BrandComplianceIssue` has no `message` field by design (T-041 step 5), so a
 * localized string can never be used to identify or locate an issue. This
 * module is the one place that turns a stable code into text.
 */

/** Shared with the inspector's passive warnings (C-07) — one wording everywhere. */
export function complianceIssueMessage(
	t: CanvasT,
	issue: BrandComplianceIssue,
): string {
	switch (issue.code) {
		case "unresolved-color-token":
		case "unresolved-font-token":
			return t(
				"canvas.brand.complianceUnresolvedToken",
				"References a brand token that no longer exists.",
			);
		case "forbidden-color":
		case "forbidden-font":
			return t(
				"canvas.brand.complianceForbidden",
				"Uses a forbidden brand value.",
			);
		// --- Component-aware codes (plan 0021 T-044) ---
		case "brand-component-property-not-editable":
			return t(
				"canvas.governance.propertyNotEditable",
				"This property is locked by the component's brand policy.",
			);
		case "brand-component-structure-locked":
			return t(
				"canvas.governance.structureLocked",
				"This component's structure is locked.",
			);
		case "brand-component-detach-denied":
			return t(
				"canvas.governance.detachDenied",
				"This component may not be detached.",
			);
		case "brand-component-flatten-denied":
			return t(
				"canvas.governance.flattenDenied",
				"This component may not be flattened on export.",
			);
		case "brand-component-variant-denied":
			return t(
				"canvas.governance.variantDenied",
				"This component's variant may not be changed.",
			);
		case "brand-component-token-not-allowed":
			return t(
				"canvas.governance.tokenNotAllowed",
				"This value is not an allowed brand token here.",
			);
		case "brand-component-override-off-brand":
			return t(
				"canvas.governance.overrideOffBrand",
				"This override does not match the brand kit.",
			);
		case "brand-component-snapshot-missing":
			return t(
				"canvas.governance.snapshotMissing",
				"This component's stored copy is missing.",
			);
		case "brand-component-source-deprecated":
			return t(
				"canvas.governance.sourceDeprecated",
				"This component version is deprecated.",
			);
		case "brand-component-policy-unsatisfiable":
			return t(
				"canvas.governance.policyUnsatisfiable",
				"This component's brand policy cannot be satisfied.",
			);
		case "brand-component-capability-unsupported":
			return t(
				"canvas.governance.capabilityUnsupported",
				"This editor does not support what this component requires.",
			);
		case "brand-component-policy-violation":
			return t(
				"canvas.governance.policyViolation",
				"This edit conflicts with the component's brand policy.",
			);
		default:
			return t(
				"canvas.brand.complianceOffBrand",
				"Doesn't match the brand kit.",
			);
	}
}
