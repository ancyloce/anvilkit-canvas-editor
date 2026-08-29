import { describe, expect, it } from "vitest";
import { createFieldPreviewStore } from "@/stores/field-preview-store.js";
import { createResolvedDocumentStore } from "@/stores/resolved-document-store.js";
import { createSceneStore } from "@/stores/scene-store.js";
import {
	buildComponentPreviewFixture,
	buildFlatPreviewFixture,
	buildLayoutPreviewFixture,
	flushEachPreviewFrame,
	measurePreviewFixture,
	type PreviewFixture,
	type PreviewMetric,
} from "../../../bench/preview-harness.js";

/**
 * @file Preview-throughput algorithm gate, shared with PLAN-0039 E4-T6.
 *
 * The dedicated benchmark owns millisecond budgets and baseline comparison.
 * This ordinary unit test guards the machine-independent scaling shape and the
 * preview-is-transient invariant on every `pnpm test` run.
 */

const FRAMES = 60;
const WARMUP = 5;

function sweep(fixture: PreviewFixture): PreviewMetric {
	return measurePreviewFixture(fixture, { runs: FRAMES, warmup: WARMUP });
}

function report(rows: readonly PreviewMetric[]): void {
	const lines = rows.map(
		(row) =>
			`  ${row.id.padEnd(18)} ${String(row.nodeCount).padStart(5)} nodes  ` +
			`median ${row.median.toFixed(3).padStart(8)} ms  ` +
			`p95 ${row.p95.toFixed(3).padStart(8)} ms`,
	);
	console.log(
		`\n[PLAN-0039 E4] preview resolution, ${FRAMES} frames each:\n${lines.join("\n")}\n`,
	);
}

describe("preview throughput", () => {
	it("records fixed document shapes and scales", () => {
		const rows = [
			sweep(buildFlatPreviewFixture(100)),
			sweep(buildFlatPreviewFixture(1_000)),
			sweep(buildFlatPreviewFixture(5_000)),
			sweep(buildLayoutPreviewFixture(1_000)),
			sweep(buildComponentPreviewFixture(1_000)),
		];
		report(rows);

		// Catastrophic-regression tripwire only. The dedicated E4 benchmark owns
		// the 16.7/50 ms budgets because it runs without unit-suite contention.
		for (const row of rows) {
			expect(row.median, `${row.id} median`).toBeLessThan(300);
		}
	}, 60_000);

	it("scales sub-quadratically with document size", () => {
		const small = sweep(buildFlatPreviewFixture(500));
		const large = sweep(buildFlatPreviewFixture(5_000));
		report([small, large]);

		const perNode = (metric: PreviewMetric): number =>
			metric.median / metric.nodeCount;
		const growth = perNode(large) / perNode(small);
		expect(
			growth,
			`per-node cost growth over a 10x step = ${growth.toFixed(2)}x ` +
				`(${small.median.toFixed(3)} ms -> ${large.median.toFixed(3)} ms)`,
		).toBeLessThan(4);
	});

	it("leaves committed IR untouched across a whole preview sweep", () => {
		const fixture = buildFlatPreviewFixture(100);
		const sceneStore = createSceneStore({ initialIR: fixture.ir });
		const fieldPreviewStore = createFieldPreviewStore();
		const store = createResolvedDocumentStore({
			sceneStore,
			fieldPreviewStore,
			schedulePreviewResolution: flushEachPreviewFrame,
		});
		const disconnect = store.connect();
		try {
			const before = sceneStore.getState().ir;
			for (let frame = 0; frame < FRAMES; frame += 1) {
				fieldPreviewStore.getState().setPreviews({
					[fixture.targetId]: { transform: { x: frame, y: 0 } },
				});
			}
			expect(sceneStore.getState().ir).toBe(before);
			expect(store.getState().resolved).toBeDefined();
		} finally {
			disconnect();
		}
	});
});
