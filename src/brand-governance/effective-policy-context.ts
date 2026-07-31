"use client";

import type {
	CanvasBrandPolicyContext,
	CanvasPolicyDecision,
	CanvasPolicyDenyReason,
} from "@anvilkit/canvas-core/brand-governance";
import { CANVAS_PERMISSIVE_POLICY_CONTEXT } from "@anvilkit/canvas-core/brand-governance";
import { useMemo } from "react";

import { useCanvasStudio } from "../context/canvas-studio-context.js";

/**
 * @file The Editor's view of host brand policy (plan 0021 T-040).
 *
 * ## Why "effective" and not just "the host's context"
 *
 * Three things decide whether an affordance is offered: the host's capability
 * snapshot, the enforcement mode, and whether governance is wired at all. A
 * host that passes nothing must behave exactly as it did before M4 — every
 * affordance available — so the absent case resolves to
 * `CANVAS_PERMISSIVE_POLICY_CONTEXT` rather than to a locked-down default.
 * Defaulting the other way would silently disable component editing for every
 * existing embedder the day this ships.
 *
 * ## UI hiding is never the enforcement (T-040 DoD)
 *
 * Everything here is presentation. The command layer re-evaluates the same
 * policy through `options.brandPolicy` on every mutation, including undo/redo,
 * batch, clipboard and the public command API — so a caller that skips the UI
 * is denied by the same rule that greyed the button out. `governance-bypass`
 * in core's suite is what proves that; this module could be deleted and the
 * document would still be protected.
 */

/**
 * Resolve the context the Editor should present against.
 *
 * Pure, so a test can drive it without React.
 */
export function resolveEffectivePolicyContext(
	host: CanvasBrandPolicyContext | undefined,
): CanvasBrandPolicyContext {
	return host ?? CANVAS_PERMISSIVE_POLICY_CONTEXT;
}

/**
 * The live policy context, refreshed when the host's capability revision
 * changes mid-session (T-040 step 4).
 *
 * The memo depends on the context object AND on `policyRevision` explicitly.
 * A host that mutates its snapshot in place and only bumps the revision is
 * doing something unusual, but it is the documented signal for "cached
 * decisions are stale" — honouring only object identity would let a revision
 * bump pass unnoticed and leave the UI showing capabilities the host has
 * already withdrawn.
 */
export function useEffectivePolicyContext(): CanvasBrandPolicyContext {
	const ctx = useCanvasStudio();
	const host = ctx.brandGovernance;
	const revision = host?.policyRevision;
	// `revision` is deliberately in the dependency list even though
	// `resolveEffectivePolicyContext` does not read it — see the doc comment.
	return useMemo(() => resolveEffectivePolicyContext(host), [host, revision]);
}

/** Whether an affordance guarded by `capability` should be offered at all. */
export function isCapabilityAvailable(
	context: CanvasBrandPolicyContext,
	capability: keyof CanvasBrandPolicyContext["capabilities"],
): boolean {
	if (context.enforcement === "off") return true;
	const value = context.capabilities[capability];
	// `editablePropertyIdsByInstance` is a map, not a boolean; asking about it
	// through this helper is a caller bug rather than a denial.
	return typeof value === "boolean" ? value : true;
}

/**
 * Per-instance editable-property narrowing (OD-08).
 *
 * Absent means "no narrowing"; an empty array means "nothing editable". Those
 * two must not collapse into each other, which is why this returns a tri-state
 * rather than a boolean over a defaulted array.
 */
export function isPropertyEditable(
	context: CanvasBrandPolicyContext,
	instanceId: string,
	propertyId: string,
): boolean {
	if (context.enforcement === "off") return true;
	if (!context.capabilities.canEditOverrides) return false;
	const allow =
		context.capabilities.editablePropertyIdsByInstance?.[instanceId];
	return allow === undefined ? true : allow.includes(propertyId);
}

/* ── Thrown-denial decoding (T-040 step 2) ───────────────────────────────── */

/**
 * The stable code the Blocked dialog localizes.
 *
 * `"unknown"` covers a denial with no reason attached, which the copy renders
 * as the generic policy-violation string rather than as nothing.
 */
export type BlockedOperationCode = CanvasPolicyDenyReason | "unknown";

const DENY_MESSAGE_KEYS: Readonly<
	Record<BlockedOperationCode, { key: string; fallback: string }>
> = {
	"capability-denied": {
		key: "canvas.governance.capabilityUnsupported",
		fallback: "This editor does not support what this component requires.",
	},
	"property-not-editable": {
		key: "canvas.governance.propertyNotEditable",
		fallback: "This property is locked by the component's brand policy.",
	},
	"structure-locked": {
		key: "canvas.governance.structureLocked",
		fallback: "This component's structure is locked.",
	},
	"detach-denied": {
		key: "canvas.governance.detachDenied",
		fallback: "This component may not be detached.",
	},
	"flatten-denied": {
		key: "canvas.governance.flattenDenied",
		fallback: "This component may not be flattened on export.",
	},
	"variant-change-denied": {
		key: "canvas.governance.variantDenied",
		fallback: "This component's variant may not be changed.",
	},
	"source-update-denied": {
		key: "canvas.governance.sourceUpdateDenied",
		fallback: "This component's version is pinned and can't be changed.",
	},
	"source-swap-denied": {
		key: "canvas.governance.sourceSwapDenied",
		fallback: "This component can't be replaced with a different one.",
	},
	"token-not-allowed": {
		key: "canvas.governance.tokenNotAllowed",
		fallback: "This value is not an allowed brand token here.",
	},
	unknown: {
		key: "canvas.governance.policyViolation",
		fallback: "This edit conflicts with the component's brand policy.",
	},
};

/** The i18n key + fallback for a stable deny reason. */
export function blockedOperationMessage(code: BlockedOperationCode): {
	key: string;
	fallback: string;
} {
	return DENY_MESSAGE_KEYS[code] ?? DENY_MESSAGE_KEYS.unknown;
}

/**
 * Recover the structured decision from a thrown command error.
 *
 * Deliberately structural rather than `instanceof CanvasCommandError`: the
 * editor and core can end up as separate module instances (dual ESM/CJS
 * resolution, a duplicated dependency in a host's tree), and a cross-realm
 * `instanceof` then reports false for an error that is unmistakably ours —
 * the same class of bug PLAN-0020 Phase 1B hit in the browser.
 */
export function policyDecisionOf(
	error: unknown,
): CanvasPolicyDecision | undefined {
	if (typeof error !== "object" || error === null) return undefined;
	const candidate = error as {
		code?: unknown;
		policy?: CanvasPolicyDecision;
	};
	if (candidate.code !== "brand-policy-denied") return undefined;
	return candidate.policy ?? { outcome: "deny" };
}

/** The stable code to localize for a thrown denial, or `undefined` if it isn't one. */
export function blockedOperationCodeOf(
	error: unknown,
): BlockedOperationCode | undefined {
	const decision = policyDecisionOf(error);
	if (!decision) return undefined;
	return decision.reason ?? "unknown";
}
