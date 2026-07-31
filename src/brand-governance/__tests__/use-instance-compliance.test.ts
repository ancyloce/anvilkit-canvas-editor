import { readFileSync } from "node:fs";
import { join } from "node:path";
import type {
	BrandComplianceIssue,
	BrandKitDefinition,
	CanvasIR,
} from "@anvilkit/canvas-core";
import { createCanvasIR } from "@anvilkit/canvas-core";
import { describe, expect, it, vi } from "vitest";

import { buildComplianceLookup } from "../use-instance-compliance.js";

/**
 * T-043 — the Inspector must not run a whole-document scan per selection.
 *
 * The DoD is "a regression test fails if the Inspector reverts to a
 * full-document scan", so one test reads the component source and asserts its
 * dependency array. That is unusual, and deliberate: the regression is invisible
 * to behaviour (the UI stays correct, it just gets slow), so behaviour alone
 * cannot catch it.
 */

const KIT = { id: "k", name: "K" } as unknown as BrandKitDefinition;

function doc(): CanvasIR {
	return createCanvasIR({ id: "doc", now: () => "t0" });
}

function issue(nodeId: string, property = "fill"): BrandComplianceIssue {
	return { nodeId, code: "off-brand-color", property, value: "#f00" };
}

describe("buildComplianceLookup", () => {
	it("scans ONCE and answers many nodes from the result", () => {
		const scan = vi.fn(() => ({ issues: [issue("a"), issue("b")] }));
		const lookup = buildComplianceLookup(doc(), KIT, scan);

		expect(lookup.forNode("a")).toHaveLength(1);
		expect(lookup.forNode("b")).toHaveLength(1);
		expect(lookup.forNodes(["a", "b"])).toHaveLength(2);
		// The point: many questions, one scan.
		expect(scan).toHaveBeenCalledTimes(1);
	});

	it("returns an empty array for a clean node rather than undefined", () => {
		const lookup = buildComplianceLookup(doc(), KIT, () => ({
			issues: [issue("a")],
		}));
		expect(lookup.forNode("clean")).toEqual([]);
	});

	it("deduplicates repeated node ids in a selection", () => {
		// A repeated id must not double that node's issues.
		const lookup = buildComplianceLookup(doc(), KIT, () => ({
			issues: [issue("a"), issue("a", "stroke")],
		}));
		expect(lookup.forNodes(["a", "a", "a"])).toHaveLength(2);
	});

	it("does not scan at all without a Brand Kit", () => {
		const scan = vi.fn(() => ({ issues: [] }));
		const lookup = buildComplianceLookup(doc(), undefined, scan);
		expect(lookup.forNode("a")).toEqual([]);
		expect(scan).not.toHaveBeenCalled();
	});
});

describe("regression guard — the Inspector's memo dependencies (T-043 DoD)", () => {
	const source = readFileSync(
		join(__dirname, "..", "..", "panels", "inspector", "brand-warnings.tsx"),
		"utf8",
	);

	it("memoizes the SCAN on [ir, brandKit] via the shared hook", () => {
		// The hook owns the scan memo; the component must go through it rather
		// than calling the whole-document report itself.
		expect(source).toContain("useInstanceCompliance(ctx.ir, definition)");
	});

	it("no longer calls generateBrandComplianceReport directly", () => {
		// This is the exact revert the DoD asks to catch: a full-document scan
		// inside a memo that depends on the selection.
		expect(source).not.toContain("generateBrandComplianceReport");
	});

	it("its message memo does NOT depend on ctx.ir", () => {
		// Depending on `ir` there would re-derive messages on every document
		// change even when the selection and the scan result are unchanged.
		const memoDeps = source.match(/\}, \[([^\]]*)\]\);/g) ?? [];
		expect(memoDeps.length).toBeGreaterThan(0);
		expect(memoDeps.some((d) => d.includes("compliance"))).toBe(true);
		expect(memoDeps.some((d) => d.includes("ctx.ir"))).toBe(false);
	});
});
