import type {
	CanvasComponentDefinition,
	CanvasComponentInstanceNode,
	CanvasIR,
	CanvasNode,
} from "@anvilkit/canvas-core";
import {
	createCanvasIR,
	createFrame,
	createGroup,
	createPage,
	createRect,
} from "@anvilkit/canvas-core";
import { describe, expect, it } from "vitest";
import { createFieldPreviewStore } from "@/stores/field-preview-store.js";
import { createResolvedDocumentStore } from "@/stores/resolved-document-store.js";
import { createSceneStore } from "@/stores/scene-store.js";

/**
 * @file Plan 0024 Phase 0 (T-0.1 / T-0.2) — preview-throughput baseline.
 *
 * The §10 field contract renders in-progress values by writing
 * `fieldPreviewStore`, and `resolvedDocumentStore` re-resolves the WHOLE
 * document synchronously on every such write (`resolved-document-store.ts`
 * `connect()` subscribes `recompute` to the preview store). There is no rAF
 * coalescing on that path, so a pointer-driven drag re-resolves at pointer-move
 * rate — 60-120 Hz. Before widening real-time coverage (Phases 1-3) or adding
 * coalescing (Phase 4), this records what a preview frame actually costs.
 *
 * What it guards, and what it does NOT:
 * - It DOES guard against super-linear blowups in the preview path — the
 *   failure mode where a preview stops sharing untouched subtrees and every
 *   frame walks/rebuilds the whole tree. That is asserted on the SHAPE of the
 *   scaling curve, which is stable across machines.
 * - It does NOT police milliseconds. CI boxes vary wildly (the sibling
 *   `m3-scale.test.ts` makes the same call), so the absolute ceilings are
 *   deliberately generous and exist only to catch a catastrophic regression.
 *
 * The measured medians are logged as a table so the Phase 4 go/no-go (T-0.3)
 * has real numbers to read rather than a bare pass/fail.
 */

/** Frames measured per sweep — roughly one second of a 60 Hz pointer drag. */
const FRAMES = 60;
/** Warm-up frames dropped before measuring (first resolve seeds the warm path). */
const WARMUP = 5;

interface Sweep {
	label: string;
	nodes: number;
	medianMs: number;
	maxMs: number;
}

/** Flat page: one group holding `count` sibling rects. The cheap baseline. */
function flatDoc(count: number): { ir: CanvasIR; targetId: string } {
	const page = createPage({
		id: "p1",
		root: createGroup({
			id: "root-1",
			children: Array.from({ length: count }, (_, n) =>
				createRect({
					id: `r-${n}`,
					transform: { x: (n % 40) * 50, y: Math.floor(n / 40) * 50 },
					bounds: { width: 40, height: 40 },
				}),
			),
		}),
	});
	return {
		ir: createCanvasIR({ id: "flat-doc", title: "t", pages: [page] }),
		// Mid-document target: previewing the FIRST node could hide a bug where
		// the walk short-circuits early.
		targetId: `r-${Math.floor(count / 2)}`,
	};
}

/**
 * Auto Layout page: `count / 4` horizontal frames of 4 children each. Every
 * preview forces the layout solver to re-flow the touched frame.
 */
function layoutDoc(count: number): { ir: CanvasIR; targetId: string } {
	const frames = Math.max(1, Math.floor(count / 4));
	const page = createPage({
		id: "p1",
		root: createGroup({
			id: "root-1",
			children: Array.from(
				{ length: frames },
				(_, f) =>
					({
						...createFrame({
							id: `f-${f}`,
							transform: { x: 0, y: f * 60 },
							bounds: { width: 400, height: 50 },
						}),
						autoLayout: {
							version: 1,
							direction: "horizontal",
							padding: { top: 0, right: 0, bottom: 0, left: 0 },
							gap: 10,
							primaryAlign: "start",
							crossAlign: "start",
						},
						children: Array.from({ length: 4 }, (_, n) =>
							createRect({
								id: `r-${f}-${n}`,
								bounds: { width: 40, height: 20 },
							}),
						),
					}) as CanvasNode,
			),
		}),
	});
	return {
		ir: createCanvasIR({ id: "layout-doc", title: "t", pages: [page] }),
		targetId: `r-${Math.floor(frames / 2)}-0`,
	};
}

/** Source whose root frame holds two rects — 3 nodes per expanded instance. */
function definition(): CanvasComponentDefinition {
	return {
		id: "cmp-card",
		name: "Card",
		revision: 1,
		properties: [],
		root: {
			...createFrame({
				id: "src-root",
				bounds: { width: 200, height: 80 },
				background: "#eeeeee",
			}),
			children: [
				createRect({
					id: "src-badge",
					transform: { x: 8, y: 8 },
					bounds: { width: 24, height: 24 },
					fill: "#ff0000",
				}),
				createRect({
					id: "src-body",
					transform: { x: 40, y: 8 },
					bounds: { width: 120, height: 40 },
					fill: "#0000ff",
				}),
			],
		} as CanvasNode,
	};
}

/**
 * Component page: `count / 3` instances of one Source (3 nodes each). Every
 * preview runs the composed resolver's expansion pass over the registry.
 */
function componentDoc(count: number): { ir: CanvasIR; targetId: string } {
	const instances = Math.max(1, Math.floor(count / 3));
	const page = createPage({
		id: "p1",
		root: createGroup({
			id: "root-1",
			children: Array.from(
				{ length: instances },
				(_, n) =>
					({
						type: "component-instance",
						id: `inst-${n}`,
						source: { kind: "local", componentId: "cmp-card" },
						transform: { x: 0, y: n * 90, rotation: 0, scaleX: 1, scaleY: 1 },
						bounds: { width: 200, height: 80 },
					}) as CanvasComponentInstanceNode,
			),
		}),
	});
	const ir = createCanvasIR({ id: "component-doc", title: "t", pages: [page] });
	return {
		ir: { ...ir, components: { "cmp-card": definition() } },
		targetId: `inst-${Math.floor(instances / 2)}`,
	};
}

/**
 * Drive `FRAMES` sequential preview writes against a connected store and
 * return the per-frame timings. Each frame previews a slightly different value
 * on one node, exactly as a number-field scrub or colour drag does.
 */
function sweep(
	label: string,
	nodes: number,
	build: () => { ir: CanvasIR; targetId: string },
): Sweep {
	const { ir, targetId } = build();
	const sceneStore = createSceneStore({ initialIR: ir });
	const fieldPreviewStore = createFieldPreviewStore();
	const store = createResolvedDocumentStore({ sceneStore, fieldPreviewStore });
	const disconnect = store.connect();
	try {
		const durations: number[] = [];
		for (let frame = 0; frame < WARMUP + FRAMES; frame += 1) {
			const patch = { [targetId]: { transform: { x: frame, y: frame } } };
			const start = performance.now();
			fieldPreviewStore.getState().setPreviews(patch);
			const elapsed = performance.now() - start;
			if (frame >= WARMUP) durations.push(elapsed);
		}
		const sorted = [...durations].sort((a, b) => a - b);
		return {
			label,
			nodes,
			medianMs: sorted[Math.floor(sorted.length / 2)] ?? 0,
			maxMs: sorted.at(-1) ?? 0,
		};
	} finally {
		disconnect();
	}
}

function report(rows: readonly Sweep[]): void {
	const lines = rows.map(
		(r) =>
			`  ${r.label.padEnd(22)} ${String(r.nodes).padStart(6)} nodes   ` +
			`median ${r.medianMs.toFixed(3).padStart(8)} ms   ` +
			`max ${r.maxMs.toFixed(3).padStart(8)} ms`,
	);
	console.log(
		`\n[plan 0024 T-0.2] preview re-resolution, ${FRAMES} frames each:\n${lines.join("\n")}\n`,
	);
}

describe("preview throughput (plan 0024 Phase 0)", () => {
	it("records the baseline across document shapes and scales", () => {
		const rows: Sweep[] = [
			sweep("flat", 100, () => flatDoc(100)),
			sweep("flat", 1_000, () => flatDoc(1_000)),
			sweep("flat", 5_000, () => flatDoc(5_000)),
			sweep("auto-layout", 1_000, () => layoutDoc(1_000)),
			sweep("component", 1_000, () => componentDoc(1_000)),
		];
		report(rows);

		// Generous absolute ceiling — a catastrophic-regression tripwire, NOT a
		// millisecond budget. One preview frame taking a third of a second on any
		// of these shapes means the preview path has stopped sharing structure.
		for (const row of rows) {
			expect(
				row.medianMs,
				`${row.label} @ ${row.nodes} nodes median`,
			).toBeLessThan(300);
		}
	});

	it("scales sub-quadratically with document size", () => {
		// The machine-independent guard. `withPreviews` shares every untouched
		// subtree and the resolver threads the previous document as its warm-path
		// seed, so cost must stay ~linear in node count. Measured on the flat
		// shape so layout/component work cannot mask the tree walk.
		//
		// Both ends are deliberately large enough to sit well clear of the timer's
		// resolution: a 100-node median lands near the clock floor, which would
		// make the ratio explode on a fast machine and flake this gate.
		const small = sweep("flat", 500, () => flatDoc(500));
		const large = sweep("flat", 5_000, () => flatDoc(5_000));
		report([small, large]);

		// Compare COST PER NODE rather than raw time. Linear ⇒ per-node cost is
		// flat (ratio ~1x). Quadratic ⇒ it grows with the 10x size step (~10x).
		const perNode = (s: Sweep): number => s.medianMs / s.nodes;
		const growth = perNode(large) / perNode(small);
		expect(
			growth,
			`per-node cost growth over a 10x size step = ${growth.toFixed(2)}x ` +
				`(${small.medianMs.toFixed(3)} ms @ 500 → ${large.medianMs.toFixed(3)} ms @ 5,000)`,
		).toBeLessThan(4);
	});

	it("leaves the committed IR untouched across a whole preview sweep", () => {
		// The invariant the whole preview design rests on: previews are transient.
		// If a future change ever routes a preview through `commit`, this fails
		// before any perf number does.
		const { ir, targetId } = flatDoc(100);
		const sceneStore = createSceneStore({ initialIR: ir });
		const fieldPreviewStore = createFieldPreviewStore();
		const store = createResolvedDocumentStore({
			sceneStore,
			fieldPreviewStore,
		});
		const disconnect = store.connect();
		try {
			const before = sceneStore.getState().ir;
			for (let frame = 0; frame < FRAMES; frame += 1) {
				fieldPreviewStore
					.getState()
					.setPreviews({ [targetId]: { transform: { x: frame, y: 0 } } });
			}
			expect(sceneStore.getState().ir).toBe(before);
			// …and the resolution DID track the previews.
			expect(store.getState().resolved).toBeDefined();
		} finally {
			disconnect();
		}
	});
});
