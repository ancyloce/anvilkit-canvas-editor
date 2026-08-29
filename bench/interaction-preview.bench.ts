/**
 * @file PLAN-0039 E4-T6 reproducible interaction-preview gate.
 */

import { arch, cpus, platform, release } from "node:os";
import { readFileSync, writeFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
	buildFixedPreviewFixtures,
	comparePreviewPerformance,
	formatPreviewPerformanceReport,
	measurePreviewFixture,
	PREVIEW_BENCH_RUNS,
	PREVIEW_BENCH_WARMUP,
	PREVIEW_REGRESSION_TOLERANCE,
	type PreviewBaseline,
	type PreviewMetric,
} from "./preview-harness.js";

const BASELINE_CAPTURE_PASSES = 3;

const BASELINE_URL = new URL(
	"./baselines/interaction-preview.json",
	import.meta.url,
);

const REFERENCE_ENVIRONMENT = {
	cpuModel: "Intel(R) Core(TM) i5-10300H CPU @ 2.50GHz",
	logicalCores: 8,
	platform: "linux",
	arch: "x64",
	kernelPattern: /microsoft-standard-WSL2/,
	nodeMajor: 24,
} as const;

function currentEnvironment(): PreviewBaseline["environment"] {
	return {
		cpuModel: cpus()[0]?.model ?? "unknown",
		logicalCores: cpus().length,
		platform: platform(),
		arch: arch(),
		release: release(),
		node: process.version,
	};
}

function referenceEnvironmentMismatch(): string | null {
	const environment = currentEnvironment();
	const mismatches: string[] = [];
	if (environment.cpuModel !== REFERENCE_ENVIRONMENT.cpuModel) {
		mismatches.push(`cpu ${environment.cpuModel}`);
	}
	if (environment.logicalCores !== REFERENCE_ENVIRONMENT.logicalCores) {
		mismatches.push(`cores ${environment.logicalCores}`);
	}
	if (environment.platform !== REFERENCE_ENVIRONMENT.platform) {
		mismatches.push(`platform ${environment.platform}`);
	}
	if (environment.arch !== REFERENCE_ENVIRONMENT.arch) {
		mismatches.push(`arch ${environment.arch}`);
	}
	if (!REFERENCE_ENVIRONMENT.kernelPattern.test(environment.release)) {
		mismatches.push(`kernel ${environment.release}`);
	}
	const nodeMajor = Number(environment.node.replace(/^v/, "").split(".")[0]);
	if (nodeMajor !== REFERENCE_ENVIRONMENT.nodeMajor) {
		mismatches.push(`node ${environment.node}`);
	}
	return mismatches.length > 0 ? mismatches.join("; ") : null;
}

function readBaseline(): PreviewBaseline {
	return JSON.parse(readFileSync(BASELINE_URL, "utf8")) as PreviewBaseline;
}

describe("Canvas interaction preview performance (PLAN-0039 E4-T6)", () => {
	it("reports median/p95 and enforces budgets plus the 15% baseline", () => {
		const capture =
			process.env.ANVILKIT_CANVAS_INTERACTION_UPDATE_BASELINE === "1";
		if (capture) {
			const mismatch = referenceEnvironmentMismatch();
			expect(
				mismatch,
				"baseline capture is allowed only on the nominated Canvas reference desktop",
			).toBeNull();
		}

		const passes: readonly (readonly PreviewMetric[])[] = Array.from(
			{ length: capture ? BASELINE_CAPTURE_PASSES : 1 },
			(_, passIndex) => {
				const metrics = buildFixedPreviewFixtures().map(measurePreviewFixture);
				console.log(
					`\n${capture ? `Baseline capture pass ${passIndex + 1}/${BASELINE_CAPTURE_PASSES}\n` : ""}` +
						`${formatPreviewPerformanceReport(metrics)}\n`,
				);
				return metrics;
			},
		);
		const metrics = passes[0] as readonly PreviewMetric[];

		if (capture) {
			const baseline: PreviewBaseline = {
				schemaVersion: 1,
				capturedAt: new Date().toISOString(),
				source: "PLAN-0039 E4 nominated Canvas reference desktop",
				regressionTolerance: PREVIEW_REGRESSION_TOLERANCE,
				runs: PREVIEW_BENCH_RUNS,
				warmup: PREVIEW_BENCH_WARMUP,
				capturePasses: BASELINE_CAPTURE_PASSES,
				environment: currentEnvironment(),
				metrics: metrics.map((metric) => {
					const rows = passes.map(
						(pass) =>
							pass.find(({ id }) => id === metric.id) as PreviewMetric,
					);
					return {
						id: metric.id,
						median: Math.max(...rows.map(({ median }) => median)),
						p95: Math.max(...rows.map(({ p95 }) => p95)),
						normalizedP95: Math.max(
							...rows.map(({ normalizedP95 }) => normalizedP95),
						),
						regressionEligible: metric.id !== "flat-100",
					};
				}),
			};
			writeFileSync(BASELINE_URL, `${JSON.stringify(baseline, null, "\t")}\n`);
			console.log(`captured baseline: ${BASELINE_URL.pathname}`);
			const budgetViolations = passes.flatMap((pass) =>
				comparePreviewPerformance(pass, baseline).violations.filter(
					({ kind }) => kind === "budget",
				),
			);
			expect(
				budgetViolations,
			).toEqual([]);
			return;
		}

		const verdict = comparePreviewPerformance(metrics, readBaseline());
		for (const violation of verdict.violations) {
			console.error(`FAIL [${violation.kind}] ${violation.message}`);
		}
		expect(verdict.violations).toEqual([]);
	}, 900_000);
});
