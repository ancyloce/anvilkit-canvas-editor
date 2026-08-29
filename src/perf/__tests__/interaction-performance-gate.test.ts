import { describe, expect, it } from "vitest";
import {
	comparePreviewPerformance,
	type PreviewBaseline,
	type PreviewMetric,
	summarizeSamples,
} from "../../../bench/preview-harness.js";

function metric(normalizedP95: number, p95 = 10): PreviewMetric {
	return {
		id: "flat-1000",
		label: "flat",
		nodeCount: 1_000,
		budgetMs: 16.7,
		median: 8,
		p95,
		runs: 100,
		normalizedP95,
		calibration: { median: 1, p95: 1, runs: 100 },
	};
}

function baseline(normalizedP95 = 10): PreviewBaseline {
	return {
		schemaVersion: 1,
		capturedAt: "2026-08-28T00:00:00.000Z",
		source: "test",
		regressionTolerance: 0.15,
		runs: 100,
		warmup: 10,
		capturePasses: 3,
		environment: {
			cpuModel: "test",
			logicalCores: 1,
			platform: "test",
			arch: "test",
			release: "test",
			node: "test",
		},
		metrics: [
			{
				id: "flat-1000",
				median: 8,
				p95: 10,
				normalizedP95,
				regressionEligible: true,
			},
		],
	};
}

describe("E4 interaction performance gate", () => {
	it("reports an observed nearest-rank p95", () => {
		const samples = Array.from({ length: 100 }, (_, index) => index + 1);
		expect(summarizeSamples(samples)).toEqual({
			median: 50.5,
			p95: 95,
			runs: 100,
		});
	});

	it("passes exactly 15% and fails the first value above it", () => {
		expect(comparePreviewPerformance([metric(11.5)], baseline()).ok).toBe(true);
		const verdict = comparePreviewPerformance([metric(11.500_001)], baseline());
		expect(verdict.ok).toBe(false);
		expect(verdict.violations).toEqual([
			expect.objectContaining({ kind: "regression", metricId: "flat-1000" }),
		]);
	});

	it("gates raw p95 even when the median and normalized result pass", () => {
		const verdict = comparePreviewPerformance([metric(10, 16.8)], baseline());
		expect(verdict.ok).toBe(false);
		expect(verdict.violations).toEqual([
			expect.objectContaining({ kind: "budget", metricId: "flat-1000" }),
		]);
	});

	it("fails closed when the committed baseline is absent", () => {
		const verdict = comparePreviewPerformance([metric(10)], null);
		expect(verdict.ok).toBe(false);
		expect(verdict.violations).toEqual([
			expect.objectContaining({ kind: "baseline", metricId: "*" }),
		]);
	});
});
