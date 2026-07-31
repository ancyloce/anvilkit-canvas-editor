import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
	buildGovernanceAuditEvent,
	hashIdentifier,
} from "@anvilkit/canvas-core/brand-governance";
import { describe, expect, it, vi } from "vitest";

import {
	analyticsEventName,
	CANVAS_ANALYTICS_EVENTS,
	CANVAS_ANALYTICS_PREFIX,
	type CanvasAnalyticsEventKey,
	canvasAnalyticsEvent,
	emitCanvasAnalytics,
	latencyBucket,
} from "../analytics.js";

/**
 * T-050 — the analytics/audit seam.
 *
 * Two properties matter more than the payload shapes: the names cannot collide
 * with the i18n namespace (the DoD), and nothing sensitive rides along.
 */

/** The catalog gate's real scanner, copied verbatim from `i18n-catalog.test.ts`. */
const I18N_SCANNER = /["'](canvas\.[a-zA-Z0-9.]+)["']/g;

describe("event names cannot collide with the i18n catalog (T-050 DoD)", () => {
	it("no EMITTED name matches the catalog scanner", () => {
		for (const key of Object.keys(
			CANVAS_ANALYTICS_EVENTS,
		) as CanvasAnalyticsEventKey[]) {
			const emitted = analyticsEventName(key);
			// Quoted the way it would appear in source, which is what the scanner
			// actually sees.
			expect(`"${emitted}"`.match(I18N_SCANNER)).toBeNull();
		}
	});

	it("proves the collision is REAL without the prefix", () => {
		// Two of the nine PRD names match the scanner exactly once the prefix is
		// stripped. The first version of the module stored these bare suffixes in
		// its table and the catalog gate failed on precisely these two — which is
		// why the table stores full wire names instead.
		const wouldCollide = Object.values(CANVAS_ANALYTICS_EVENTS)
			.map((name) => name.slice(CANVAS_ANALYTICS_PREFIX.length))
			.filter((suffix) => `"${suffix}"`.match(/["'](canvas\.[a-zA-Z0-9.]+)["']/g));
		expect(wouldCollide).toEqual([
			"canvas.library.searched",
			"canvas.component.swapped",
		]);
	});

	it("survives a name the current character class would not exclude", () => {
		// The seven remaining names escape only because `_` is outside
		// `[a-zA-Z0-9.]`. A tenth event named without an underscore must still be
		// safe — that is what the prefix buys, and this is the regression guard.
		expect(
			`"${"anvilkit."}canvas.library.browsed"`.match(I18N_SCANNER),
		).toBeNull();
	});

	it("every name is `anvilkit.canvas.`-prefixed", () => {
		for (const key of Object.keys(
			CANVAS_ANALYTICS_EVENTS,
		) as CanvasAnalyticsEventKey[]) {
			expect(analyticsEventName(key).startsWith("anvilkit.canvas.")).toBe(true);
		}
	});
});

describe("the nine PRD §13 events", () => {
	it("exist, and only those nine", () => {
		expect(Object.keys(CANVAS_ANALYTICS_EVENTS)).toHaveLength(9);
		expect(
			Object.values(CANVAS_ANALYTICS_EVENTS).map((n) =>
				n.slice(CANVAS_ANALYTICS_PREFIX.length),
			),
		).toEqual([
			"canvas.library.searched",
			"canvas.library.component_inserted",
			"canvas.component.update_checked",
			"canvas.component.update_applied",
			"canvas.component.variant_changed",
			"canvas.component.swapped",
			"canvas.brand.violation_detected",
			"canvas.brand.operation_blocked",
			"canvas.brand.compliance_run",
		]);
	});

	it("carries the name on the event itself", () => {
		const event = canvasAnalyticsEvent("brandComplianceRun", {
			warningCount: 2,
			blockingCount: 0,
			trigger: "manual",
		});
		expect(event.name).toBe("anvilkit.canvas.brand.compliance_run");
		expect(event.key).toBe("brandComplianceRun");
	});
});

describe("redaction (PRD §13)", () => {
	/** Flags anything that looks like a secret, a URL, or prose. */
	function offending(value: unknown, path = ""): string[] {
		if (typeof value === "string") {
			// A stable code is lowercase-kebab by contract (`detach-denied`,
			// `brand-component-token-not-allowed`). Exempting that shape first is
			// what keeps the credential heuristic from firing on the word "token"
			// in `token-not-allowed`, which is a BRAND token, not an auth one.
			if (/^[a-z][a-z0-9]*(-[a-z0-9]+)*$/.test(value)) return [];
			const bad =
				/^(bearer|basic)\s/i.test(value) ||
				/^sk-|^ghp_/i.test(value) ||
				/\b(token|secret|password|apikey|api_key)\b/i.test(value) ||
				/^https?:|^data:|^blob:/i.test(value) ||
				value.includes("@") ||
				value.split(" ").length > 4;
			return bad ? [`${path}=${value}`] : [];
		}
		if (Array.isArray(value)) {
			return value.flatMap((v, i) => offending(v, `${path}[${i}]`));
		}
		if (value && typeof value === "object") {
			return Object.entries(value).flatMap(([k, v]) =>
				offending(v, path ? `${path}.${k}` : k),
			);
		}
		return [];
	}

	it("a fully-populated payload of every event carries nothing sensitive", () => {
		const events = [
			canvasAnalyticsEvent("librarySearched", {
				queryLength: 12,
				filters: ["buttons", "free"],
				resultCount: 30,
				latencyBucket: "fast",
				outcome: "ok",
			}),
			canvasAnalyticsEvent("libraryComponentInserted", {
				libraryIdHash: hashIdentifier("acme-internal"),
				componentIdHash: hashIdentifier("secret-card"),
				version: "1.0.0",
				cached: true,
			}),
			canvasAnalyticsEvent("componentUpdateChecked", {
				currentVersion: "1.0.0",
				updateAvailable: true,
				outcome: "ok",
			}),
			canvasAnalyticsEvent("componentUpdateApplied", {
				fromVersion: "1.0.0",
				toVersion: "2.0.0",
				instanceCount: 12,
				orphanCount: 1,
			}),
			canvasAnalyticsEvent("componentVariantChanged", {
				axisCount: 2,
				valid: true,
				orphanCount: 0,
			}),
			canvasAnalyticsEvent("componentSwapped", {
				compatibilityLevel: "compatible",
				preservedCount: 4,
				orphanCount: 0,
			}),
			canvasAnalyticsEvent("brandViolationDetected", {
				code: "brand-component-token-not-allowed",
				severity: "blocking",
				operation: "override-set",
			}),
			canvasAnalyticsEvent("brandOperationBlocked", {
				operation: "detach",
				code: "detach-denied",
				hostPolicyMode: "blocking",
			}),
			canvasAnalyticsEvent("brandComplianceRun", {
				warningCount: 3,
				blockingCount: 1,
				trigger: "export",
			}),
		];
		for (const event of events) {
			expect(offending(event.properties, event.key)).toEqual([]);
		}
	});

	it("the search event reports a LENGTH, never the query", () => {
		// The query is the user's own text; its length is the operational signal.
		const event = canvasAnalyticsEvent("librarySearched", {
			queryLength: "acme confidential q3 launch".length,
			filters: [],
			resultCount: 0,
			latencyBucket: "instant",
			outcome: "empty",
		});
		expect(JSON.stringify(event)).not.toContain("confidential");
		expect(event.properties.queryLength).toBe(27);
	});

	it("latency is bucketed, not timed", () => {
		// A raw duration correlates with result-set size and therefore with what
		// was searched for.
		expect(latencyBucket(0)).toBe("instant");
		expect(latencyBucket(99)).toBe("instant");
		expect(latencyBucket(100)).toBe("fast");
		expect(latencyBucket(499)).toBe("fast");
		expect(latencyBucket(500)).toBe("slow");
		expect(latencyBucket(5_000)).toBe("very-slow");
	});

	it("identifiers are hashed, and the hash does not contain the input", () => {
		const hash = hashIdentifier("acme-unannounced-brand");
		expect(hash).not.toContain("acme");
		expect(hash).not.toContain("unannounced");
		// Stable, so funnels still work across events.
		expect(hashIdentifier("acme-unannounced-brand")).toBe(hash);
	});
});

describe("emission is never load-bearing", () => {
	it("does nothing without a sink", () => {
		expect(() =>
			emitCanvasAnalytics(undefined, "componentVariantChanged", {
				axisCount: 1,
				valid: true,
				orphanCount: 0,
			}),
		).not.toThrow();
	});

	it("a THROWING host sink cannot break the edit that emitted", () => {
		// The sink is third-party code on a user-interaction path. Losing a
		// metric is acceptable; losing the user's work is not.
		const sink = vi.fn(() => {
			throw new Error("analytics backend down");
		});
		expect(() =>
			emitCanvasAnalytics(sink, "brandComplianceRun", {
				warningCount: 0,
				blockingCount: 0,
				trigger: "manual",
			}),
		).not.toThrow();
		expect(sink).toHaveBeenCalledTimes(1);
	});

	it("passes the built event through unchanged", () => {
		const sink = vi.fn();
		emitCanvasAnalytics(sink, "componentSwapped", {
			compatibilityLevel: "breaking",
			preservedCount: 0,
			orphanCount: 3,
		});
		expect(sink).toHaveBeenCalledWith(
			expect.objectContaining({ name: "anvilkit.canvas.component.swapped" }),
		);
	});
});

describe("governance audit envelope (TD §24.2)", () => {
	const base = {
		event: "component-instance.detach",
		documentId: "campaign-nova",
		documentRevision: 7,
		outcome: "blocked" as const,
		timestamp: "2026-07-30T00:00:00.000Z",
	};

	it("hashes the document id rather than carrying it", () => {
		const record = buildGovernanceAuditEvent(base);
		expect(record.documentIdHash).toBe(hashIdentifier("campaign-nova"));
		expect(JSON.stringify(record)).not.toContain("campaign-nova");
	});

	it("carries NO actor identity", () => {
		// Canvas has no authenticated notion of who the user is; an identity it
		// emitted would be self-reported and worthless as an audit record.
		const record = buildGovernanceAuditEvent(base) as Record<string, unknown>;
		for (const field of ["actor", "user", "userId", "email", "identity"]) {
			expect(record[field]).toBeUndefined();
		}
	});

	it("namespaces local and library sources so their hashes differ", () => {
		const local = buildGovernanceAuditEvent({
			...base,
			source: { kind: "local", componentId: "card" },
		});
		const library = buildGovernanceAuditEvent({
			...base,
			source: {
				kind: "library",
				libraryId: "acme",
				componentId: "card",
				version: "1.0.0",
				integrity: `sha256-${"A".repeat(43)}`,
			},
		});
		expect(local.componentRefHash).not.toBe(library.componentRefHash);
	});

	it("omits optional fields rather than setting them undefined (INV-10)", () => {
		const record = buildGovernanceAuditEvent(base);
		expect(Object.hasOwn(record, "componentRefHash")).toBe(false);
		expect(Object.hasOwn(record, "policyRevision")).toBe(false);
		expect(Object.hasOwn(record, "issueCodes")).toBe(false);
		// An empty array is the same as absent, for the same reason.
		expect(
			Object.hasOwn(
				buildGovernanceAuditEvent({ ...base, issueCodes: [] }),
				"issueCodes",
			),
		).toBe(false);
	});

	it("carries stable codes, never messages", () => {
		const record = buildGovernanceAuditEvent({
			...base,
			issueCodes: ["detach-denied"],
			policyRevision: "rev-9",
		});
		expect(record.issueCodes).toEqual(["detach-denied"]);
		expect(record.policyRevision).toBe("rev-9");
		// No prose anywhere in the record.
		// Word-bounded: `"blocked"` is a legitimate OUTCOME value and contains
		// the substring "locked".
		expect(JSON.stringify(record)).not.toMatch(
			/\b(may not|cannot|is locked|forbidden)\b/i,
		);
	});

	it("owns no clock — the timestamp is the caller's", () => {
		// A module that read the clock could not be replayed deterministically,
		// and workflow scripts in this repo cannot call Date.now() at all.
		const source = readFileSync(
			join(
				__dirname,
				"..",
				"..",
				"..",
				"..",
				"core",
				"src",
				"brand-governance",
				"audit.ts",
			),
			"utf8",
		);
		expect(source).not.toContain("Date.now");
		expect(source).not.toContain("new Date(");
	});
});
