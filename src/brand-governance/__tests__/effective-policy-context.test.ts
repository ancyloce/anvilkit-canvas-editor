import type { CanvasBrandPolicyContext } from "@anvilkit/canvas-core/brand-governance";
import { CANVAS_PERMISSIVE_POLICY_CONTEXT } from "@anvilkit/canvas-core/brand-governance";
import { describe, expect, it } from "vitest";

import {
	blockedOperationCodeOf,
	blockedOperationMessage,
	isCapabilityAvailable,
	isPropertyEditable,
	policyDecisionOf,
	resolveEffectivePolicyContext,
} from "../effective-policy-context.js";

/** T-040 — the presentation side of policy. */

function context(
	overrides: Partial<CanvasBrandPolicyContext> = {},
): CanvasBrandPolicyContext {
	return {
		enforcement: "blocking",
		capabilities: {
			canEditOverrides: true,
			canChangeVariant: true,
			canDetach: true,
			canFlatten: true,
			canInsertExternalComponents: true,
			canUpdateComponents: true,
		},
		...overrides,
	};
}

describe("resolveEffectivePolicyContext", () => {
	it("an ungoverned host keeps every affordance", () => {
		// The regression that matters: shipping M4 must not disable component
		// editing for embedders that pass nothing.
		expect(resolveEffectivePolicyContext(undefined)).toBe(
			CANVAS_PERMISSIVE_POLICY_CONTEXT,
		);
		expect(
			isCapabilityAvailable(
				resolveEffectivePolicyContext(undefined),
				"canDetach",
			),
		).toBe(true);
	});

	it("passes a host context through unchanged", () => {
		const host = context();
		expect(resolveEffectivePolicyContext(host)).toBe(host);
	});
});

describe("isCapabilityAvailable", () => {
	it("honours a denied capability", () => {
		const ctx = context({
			capabilities: { ...context().capabilities, canDetach: false },
		});
		expect(isCapabilityAvailable(ctx, "canDetach")).toBe(false);
		expect(isCapabilityAvailable(ctx, "canFlatten")).toBe(true);
	});

	it('enforcement "off" evaluates nothing', () => {
		const ctx = context({
			enforcement: "off",
			capabilities: { ...context().capabilities, canDetach: false },
		});
		expect(isCapabilityAvailable(ctx, "canDetach")).toBe(true);
	});
});

describe("isPropertyEditable (OD-08 per-instance narrowing)", () => {
	it("absent map means no narrowing; empty array means nothing editable", () => {
		// These two must not collapse — an empty allowlist is a real state.
		expect(isPropertyEditable(context(), "inst-1", "fill")).toBe(true);
		const narrowed = context({
			capabilities: {
				...context().capabilities,
				editablePropertyIdsByInstance: { "inst-1": [] },
			},
		});
		expect(isPropertyEditable(narrowed, "inst-1", "fill")).toBe(false);
		// An instance absent from the map is unnarrowed even when others are.
		expect(isPropertyEditable(narrowed, "inst-2", "fill")).toBe(true);
	});

	it("respects the allowlist contents", () => {
		const ctx = context({
			capabilities: {
				...context().capabilities,
				editablePropertyIdsByInstance: { "inst-1": ["label"] },
			},
		});
		expect(isPropertyEditable(ctx, "inst-1", "label")).toBe(true);
		expect(isPropertyEditable(ctx, "inst-1", "fill")).toBe(false);
	});

	it("a global override denial beats a per-instance allowlist", () => {
		const ctx = context({
			capabilities: {
				...context().capabilities,
				canEditOverrides: false,
				editablePropertyIdsByInstance: { "inst-1": ["label"] },
			},
		});
		expect(isPropertyEditable(ctx, "inst-1", "label")).toBe(false);
	});
});

describe("decoding a thrown denial (T-040 step 2)", () => {
	it("recovers the stable reason without touching the message", () => {
		const error = Object.assign(new Error("structure-locked: whatever"), {
			code: "brand-policy-denied",
			policy: { outcome: "deny", reason: "structure-locked" },
		});
		expect(blockedOperationCodeOf(error)).toBe("structure-locked");
	});

	it("is structural, not instanceof — cross-realm errors still decode", () => {
		// Dual ESM/CJS resolution can hand the editor an error from a different
		// module instance; `instanceof CanvasCommandError` is false for it.
		const plain = {
			code: "brand-policy-denied",
			policy: { outcome: "deny", reason: "detach-denied" },
		};
		expect(blockedOperationCodeOf(plain)).toBe("detach-denied");
	});

	it("a denial with no reason still gets copy", () => {
		expect(
			blockedOperationCodeOf({
				code: "brand-policy-denied",
				policy: undefined,
			}),
		).toBe("unknown");
		expect(blockedOperationMessage("unknown").key).toBe(
			"canvas.governance.policyViolation",
		);
	});

	it("ignores every other error", () => {
		expect(blockedOperationCodeOf(new Error("boom"))).toBeUndefined();
		expect(blockedOperationCodeOf({ code: "node-not-found" })).toBeUndefined();
		expect(policyDecisionOf(null)).toBeUndefined();
		expect(policyDecisionOf("brand-policy-denied")).toBeUndefined();
	});

	it("every deny reason has its own copy", () => {
		const reasons = [
			"capability-denied",
			"property-not-editable",
			"structure-locked",
			"detach-denied",
			"flatten-denied",
			"variant-change-denied",
			"token-not-allowed",
		] as const;
		const keys = reasons.map((r) => blockedOperationMessage(r).key);
		// Distinct copy per reason — a shared string would make two different
		// denials indistinguishable to the user.
		expect(new Set(keys).size).toBe(reasons.length);
		for (const key of keys)
			expect(key.startsWith("canvas.governance.")).toBe(true);
	});
});
