/**
 * @file Reproducible input-to-preview benchmark harness (PLAN-0039 E4-T6).
 *
 * The fixture builders and measurement seam are shared with the older
 * preview-throughput regression so the unit and CI gates exercise the same
 * store pipeline. Measurements include the preview-store write, dirty-scope
 * derivation, component expansion, Auto Layout, and resolved-store publish.
 */

import type {
	CanvasComponentDefinition,
	CanvasIR,
	CanvasLayoutMeasurementProvider,
	CanvasNode,
	MeasuredText,
	TextMeasureRequest,
} from "@anvilkit/canvas-core";
import {
	createCanvasIR,
	createComponentInstance,
	createFrame,
	createGroup,
	createImage,
	createPage,
	createRect,
	createText,
} from "@anvilkit/canvas-core";
import { performance } from "node:perf_hooks";
import { createFieldPreviewStore } from "../src/stores/field-preview-store.js";
import { createResolvedDocumentStore } from "../src/stores/resolved-document-store.js";
import { createSceneStore } from "../src/stores/scene-store.js";

const NOW = () => "2026-08-28T00:00:00.000Z";

export const PREVIEW_BENCH_RUNS = Number(
	process.env.ANVILKIT_CANVAS_INTERACTION_BENCH_RUNS ?? "200",
);
export const PREVIEW_BENCH_WARMUP = Number(
	process.env.ANVILKIT_CANVAS_INTERACTION_BENCH_WARMUP ?? "20",
);

/** The initially recommended E4 regression threshold. */
export const PREVIEW_REGRESSION_TOLERANCE = 0.15;

export interface PreviewFixture {
	readonly id: string;
	readonly label: string;
	/** Resolved records, including the page root. */
	readonly nodeCount: number;
	readonly budgetMs: number;
	readonly ir: CanvasIR;
	readonly targetId: string;
}

export interface SampleSummary {
	readonly median: number;
	readonly p95: number;
	readonly runs: number;
}

export interface PreviewMetric extends SampleSummary {
	readonly id: string;
	readonly label: string;
	readonly nodeCount: number;
	readonly budgetMs: number;
	/** Raw preview p95 divided by the calibration median. */
	readonly normalizedP95: number;
	readonly calibration: SampleSummary;
}

export interface PreviewMeasurementOptions {
	readonly runs?: number;
	readonly warmup?: number;
}

export interface PreviewBaselineMetric {
	readonly id: string;
	readonly median: number;
	readonly p95: number;
	readonly normalizedP95: number;
	/** False only for the sub-millisecond 100-node noise-floor fixture. */
	readonly regressionEligible: boolean;
}

export interface PreviewBaseline {
	readonly schemaVersion: 1;
	readonly capturedAt: string;
	readonly source: string;
	readonly regressionTolerance: number;
	readonly runs: number;
	readonly warmup: number;
	readonly capturePasses: number;
	readonly environment: {
		readonly cpuModel: string;
		readonly logicalCores: number;
		readonly platform: string;
		readonly arch: string;
		readonly release: string;
		readonly node: string;
	};
	readonly metrics: readonly PreviewBaselineMetric[];
}

export interface PreviewGateViolation {
	readonly kind: "budget" | "baseline" | "regression";
	readonly metricId: string;
	readonly message: string;
}

export interface PreviewGateVerdict {
	readonly ok: boolean;
	readonly violations: readonly PreviewGateViolation[];
}

const deterministicMeasurement: CanvasLayoutMeasurementProvider = {
	manifestHash: "e4-bench-fonts-v1",
	measureText(request: TextMeasureRequest): MeasuredText {
		let characters = 0;
		for (const paragraph of request.paragraphs) {
			for (const span of paragraph.spans) characters += span.text.length;
		}
		return { lines: [], width: characters * 8, height: 20 };
	},
};

export const flushEachPreviewFrame = (
	callback: () => void,
): (() => void) => {
	callback();
	return () => {
		// The injected frame completed synchronously.
	};
};

function exactLeafCount(nodeCount: number): number {
	if (!Number.isInteger(nodeCount) || nodeCount < 2) {
		throw new Error(`fixture nodeCount must be an integer >= 2; got ${nodeCount}`);
	}
	return nodeCount - 1;
}

/** Flat page: the page root plus sibling rectangles. */
export function buildFlatPreviewFixture(nodeCount: number): PreviewFixture {
	const leaves = exactLeafCount(nodeCount);
	const targetIndex = Math.floor(leaves / 2);
	const page = createPage({
		id: "p1",
		root: createGroup({
			id: "root-1",
			children: Array.from({ length: leaves }, (_, index) =>
				createRect({
					id: `r-${index}`,
					transform: {
						x: (index % 50) * 24,
						y: Math.floor(index / 50) * 24,
					},
					bounds: { width: 20, height: 20 },
				}),
			),
		}),
	});
	return {
		id: `flat-${nodeCount}`,
		label: "flat",
		nodeCount,
		budgetMs: nodeCount >= 5_000 ? 50 : 16.7,
		ir: createCanvasIR({
			id: `flat-${nodeCount}`,
			title: "E4 flat fixture",
			pages: [page],
			now: NOW,
		}),
		targetId: `r-${targetIndex}`,
	};
}

/** Exact-size Auto Layout fixture retained by the algorithmic unit gate. */
export function buildLayoutPreviewFixture(nodeCount: number): PreviewFixture {
	const leaves = exactLeafCount(nodeCount);
	const frameCount = Math.floor(leaves / 5);
	const remainder = leaves - frameCount * 5;
	const frames = Array.from(
		{ length: frameCount },
		(_, frameIndex) =>
			({
				...createFrame({
					id: `f-${frameIndex}`,
					transform: { x: 0, y: frameIndex * 48 },
					bounds: { width: 300, height: 40 },
				}),
				autoLayout: {
					version: 1,
					direction: "horizontal",
					padding: { top: 0, right: 0, bottom: 0, left: 0 },
					gap: 4,
					primaryAlign: "start",
					crossAlign: "start",
				},
				children: Array.from({ length: 4 }, (_, childIndex) =>
					createRect({
						id: `r-${frameIndex}-${childIndex}`,
						bounds: { width: 40, height: 20 },
					}),
				),
			}) as CanvasNode,
	);
	const remainderNodes = Array.from({ length: remainder }, (_, index) =>
		createRect({
			id: `remainder-${index}`,
			bounds: { width: 20, height: 20 },
		}),
	);
	const page = createPage({
		id: "p1",
		root: createGroup({
			id: "root-1",
			children: [...frames, ...remainderNodes],
		}),
	});
	return {
		id: `auto-layout-${nodeCount}`,
		label: "auto-layout",
		nodeCount,
		budgetMs: nodeCount >= 5_000 ? 50 : 16.7,
		ir: createCanvasIR({
			id: `auto-layout-${nodeCount}`,
			title: "E4 Auto Layout fixture",
			pages: [page],
			now: NOW,
		}),
		targetId:
			frameCount > 0
				? `r-${Math.floor(frameCount / 2)}-0`
				: "remainder-0",
	};
}

/** Text-heavy page with deterministic metrics and repeated strings. */
export function buildTextPreviewFixture(nodeCount: number): PreviewFixture {
	const leaves = exactLeafCount(nodeCount);
	const targetIndex = Math.floor(leaves / 2);
	const page = createPage({
		id: "p1",
		root: createGroup({
			id: "root-1",
			children: Array.from({ length: leaves }, (_, index) =>
				createText({
					id: `text-${index}`,
					text: `Canvas performance label ${index % 20}`,
					transform: { x: 0, y: index * 22 },
					bounds: { width: 240, height: 20 },
					fontFamily: "Inter",
					fontSize: 16,
				}),
			),
		}),
	});
	return {
		id: `text-${nodeCount}`,
		label: "text-heavy",
		nodeCount,
		budgetMs: nodeCount >= 5_000 ? 50 : 16.7,
		ir: createCanvasIR({
			id: `text-${nodeCount}`,
			title: "E4 text fixture",
			pages: [page],
			now: NOW,
		}),
		targetId: `text-${targetIndex}`,
	};
}

/** Image-heavy page with 20 stable asset records shared across the nodes. */
export function buildImagePreviewFixture(nodeCount: number): PreviewFixture {
	const leaves = exactLeafCount(nodeCount);
	const targetIndex = Math.floor(leaves / 2);
	const assets = Object.fromEntries(
		Array.from({ length: 20 }, (_, index) => {
			const id = `asset-${index}`;
			return [
				id,
				{
					id,
					uri: `https://assets.example.invalid/e4/${index}.png`,
					mimeType: "image/png",
					width: 320,
					height: 180,
				},
			];
		}),
	);
	const page = createPage({
		id: "p1",
		root: createGroup({
			id: "root-1",
			children: Array.from({ length: leaves }, (_, index) =>
				createImage({
					id: `image-${index}`,
					assetId: `asset-${index % 20}`,
					transform: {
						x: (index % 20) * 84,
						y: Math.floor(index / 20) * 52,
					},
					bounds: { width: 80, height: 48 },
					alt: `Fixture image ${index}`,
				}),
			),
		}),
	});
	const ir = createCanvasIR({
		id: `image-${nodeCount}`,
		title: "E4 image fixture",
		pages: [page],
		now: NOW,
	});
	return {
		id: `image-${nodeCount}`,
		label: "image-heavy",
		nodeCount,
		budgetMs: nodeCount >= 5_000 ? 50 : 16.7,
		ir: { ...ir, assets },
		targetId: `image-${targetIndex}`,
	};
}

/** Three resolved nodes (root + two leaves) per expanded instance. */
function componentDefinition(): CanvasComponentDefinition {
	return {
		id: "cmp-card",
		name: "Card",
		revision: 1,
		properties: [],
		root: {
			...createFrame({
				id: "source-root",
				bounds: { width: 200, height: 80 },
				background: "#eeeeee",
			}),
			children: [
				createRect({
					id: "source-badge",
					transform: { x: 8, y: 8 },
					bounds: { width: 24, height: 24 },
					fill: "#ff0000",
				}),
				createRect({
					id: "source-body",
					transform: { x: 40, y: 8 },
					bounds: { width: 120, height: 40 },
					fill: "#0000ff",
				}),
			],
		} as CanvasNode,
	};
}

/** Component-heavy fixture whose requested size is the expanded record count. */
export function buildComponentPreviewFixture(
	resolvedNodeCount: number,
): PreviewFixture {
	const instanceCount = (resolvedNodeCount - 1) / 3;
	if (!Number.isInteger(instanceCount) || instanceCount < 1) {
		throw new Error(
			`component fixture needs 1 + (3 * instances) nodes; got ${resolvedNodeCount}`,
		);
	}
	const targetIndex = Math.floor(instanceCount / 2);
	const page = createPage({
		id: "p1",
		root: createGroup({
			id: "root-1",
			children: Array.from({ length: instanceCount }, (_, index) =>
				createComponentInstance({
					id: `instance-${index}`,
					componentId: "cmp-card",
					transform: { x: 0, y: index * 84 },
					bounds: { width: 200, height: 80 },
				}),
			),
		}),
	});
	const ir = createCanvasIR({
		id: `component-${resolvedNodeCount}`,
		title: "E4 component fixture",
		pages: [page],
		now: NOW,
	});
	return {
		id: `component-${resolvedNodeCount}`,
		label: "component-heavy",
		nodeCount: resolvedNodeCount,
		budgetMs: resolvedNodeCount >= 5_000 ? 50 : 16.7,
		ir: { ...ir, components: { "cmp-card": componentDefinition() } },
		targetId: `instance-${targetIndex}`,
	};
}

/** The fixed E4-T6 CI suite, in stable reporting order. */
export function buildFixedPreviewFixtures(): readonly PreviewFixture[] {
	return [
		buildFlatPreviewFixture(100),
		buildFlatPreviewFixture(1_000),
		buildFlatPreviewFixture(5_000),
		buildTextPreviewFixture(1_000),
		buildImagePreviewFixture(1_000),
		buildComponentPreviewFixture(1_000),
	];
}

/** Nearest-rank p95 over an observed sample, plus the ordinary median. */
export function summarizeSamples(samples: readonly number[]): SampleSummary {
	if (samples.length === 0) return { median: 0, p95: 0, runs: 0 };
	const sorted = [...samples].sort((left, right) => left - right);
	const middle = Math.floor(sorted.length / 2);
	const median =
		sorted.length % 2 === 0
			? ((sorted[middle - 1] as number) + (sorted[middle] as number)) / 2
			: (sorted[middle] as number);
	const rank = Math.min(
		sorted.length - 1,
		Math.max(0, Math.ceil(sorted.length * 0.95) - 1),
	);
	return { median, p95: sorted[rank] as number, runs: sorted.length };
}

// A fixed typed-array traversal normalizes CPU/memory throughput across CI
// hosts without relabeling one machine as another. The observable sink prevents
// V8 from proving the loop dead and deleting the calibration work.
const CALIBRATION_VALUES = Uint32Array.from(
	{ length: 1_048_576 },
	(_, index) => (Math.imul(index + 1, 2_654_435_761) ^ (index >>> 3)) >>> 0,
);
let calibrationSink = 0;

function runCalibration(): void {
	let accumulator = calibrationSink;
	for (let index = 0; index < CALIBRATION_VALUES.length; index += 1) {
		accumulator = (
			accumulator +
			Math.imul(CALIBRATION_VALUES[index] as number, (index & 255) + 1)
		) >>> 0;
	}
	calibrationSink = accumulator;
}

/** Measure one fixed fixture through the real connected preview pipeline. */
export function measurePreviewFixture(
	fixture: PreviewFixture,
	options: PreviewMeasurementOptions = {},
): PreviewMetric {
	const runs = options.runs ?? PREVIEW_BENCH_RUNS;
	const warmup = options.warmup ?? PREVIEW_BENCH_WARMUP;
	const sceneStore = createSceneStore({ initialIR: fixture.ir });
	const fieldPreviewStore = createFieldPreviewStore();
	const resolvedStore = createResolvedDocumentStore({
		sceneStore,
		fieldPreviewStore,
		measurement: deterministicMeasurement,
		schedulePreviewResolution: flushEachPreviewFrame,
	});
	const disconnect = resolvedStore.connect();
	try {
		const actualNodeCount = resolvedStore.getState().resolved.records.size;
		if (actualNodeCount !== fixture.nodeCount) {
			throw new Error(
				`${fixture.id} declared ${fixture.nodeCount} resolved nodes but produced ${actualNodeCount}`,
			);
		}

		const previewSamples: number[] = [];
		const total = warmup + runs;
		for (let frame = 0; frame < total; frame += 1) {
			const previewStarted = performance.now();
			fieldPreviewStore.getState().setPreviews({
				[fixture.targetId]: {
					transform: { x: frame + 1, y: (frame + 1) % 17 },
				},
			});
			const previewMs = performance.now() - previewStarted;

			if (frame >= warmup) {
				previewSamples.push(previewMs);
			}
		}

		const preview = summarizeSamples(previewSamples);
		const calibrationSamples: number[] = [];
		for (let run = 0; run < total; run += 1) {
			const calibrationStarted = performance.now();
			runCalibration();
			const calibrationMs = performance.now() - calibrationStarted;
			if (run >= warmup) calibrationSamples.push(calibrationMs);
		}
		const calibration = summarizeSamples(calibrationSamples);
		return {
			id: fixture.id,
			label: fixture.label,
			nodeCount: fixture.nodeCount,
			budgetMs: fixture.budgetMs,
			...preview,
			normalizedP95: preview.p95 / Math.max(calibration.median, 0.000_001),
			calibration,
		};
	} finally {
		disconnect();
	}
}

/** Judge raw p95 budgets and the normalized p95 regression baseline. */
export function comparePreviewPerformance(
	metrics: readonly PreviewMetric[],
	baseline: PreviewBaseline | null,
): PreviewGateVerdict {
	const violations: PreviewGateViolation[] = [];
	for (const metric of metrics) {
		if (metric.p95 > metric.budgetMs) {
			violations.push({
				kind: "budget",
				metricId: metric.id,
				message: `${metric.id}: p95 ${metric.p95.toFixed(3)} ms exceeds ${metric.budgetMs} ms`,
			});
		}
	}

	if (baseline === null) {
		violations.push({
			kind: "baseline",
			metricId: "*",
			message: "the committed interaction-preview baseline is missing",
		});
		return { ok: false, violations };
	}

	const baselineById = new Map(
		baseline.metrics.map((metric) => [metric.id, metric]),
	);
	for (const metric of metrics) {
		const previous = baselineById.get(metric.id);
		if (!previous) {
			violations.push({
				kind: "baseline",
				metricId: metric.id,
				message: `${metric.id}: no committed baseline metric`,
			});
			continue;
		}
		if (!previous.regressionEligible) continue;
		const limit = previous.normalizedP95 * (1 + baseline.regressionTolerance);
		if (metric.normalizedP95 > limit) {
			const delta =
				(metric.normalizedP95 - previous.normalizedP95) /
				previous.normalizedP95;
			violations.push({
				kind: "regression",
				metricId: metric.id,
				message:
					`${metric.id}: normalized p95 ${metric.normalizedP95.toFixed(3)} is ` +
					`${(delta * 100).toFixed(1)}% slower than baseline ` +
					`${previous.normalizedP95.toFixed(3)} (limit ` +
					`${(baseline.regressionTolerance * 100).toFixed(0)}%)`,
			});
		}
	}
	return { ok: violations.length === 0, violations };
}

/** Stable, artifact-friendly text table for local runs and CI logs. */
export function formatPreviewPerformanceReport(
	metrics: readonly PreviewMetric[],
): string {
	const rows = metrics.map(
		(metric) =>
			`  ${metric.id.padEnd(18)} ${String(metric.nodeCount).padStart(5)} nodes  ` +
			`median ${metric.median.toFixed(3).padStart(8)} ms  ` +
			`p95 ${metric.p95.toFixed(3).padStart(8)} ms  ` +
			`normalized p95 ${metric.normalizedP95.toFixed(3).padStart(8)}  ` +
			`budget <= ${metric.budgetMs.toFixed(1)} ms`,
	);
	return [
		`Canvas interaction preview (${PREVIEW_BENCH_RUNS} samples, ${PREVIEW_BENCH_WARMUP} warmup)`,
		...rows,
	].join("\n");
}
