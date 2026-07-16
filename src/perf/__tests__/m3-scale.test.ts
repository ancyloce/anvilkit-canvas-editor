import {
	applyCommand,
	CanvasIRSchema,
	createCanvasIR,
	createGroup,
	createPage,
	createRect,
} from "@anvilkit/canvas-core";
import { describe, expect, it } from "vitest";
import { EMPTY_LAYER_FILTER, findLayers } from "@/panels/layer-filter.js";
import {
	computeDimmedIds,
	isolationScopeChildren,
} from "@/selection/isolation.js";

/**
 * C-14 (PRD 0012 §13.2): document-scale smoke test at the Phase 2 target —
 * 50 pages / 1,000 nodes. Budgets are deliberately GENEROUS (CI boxes vary
 * wildly); this guards against accidental quadratic blowups in the M3
 * surfaces, not against millisecond regressions.
 */

const PAGES = 50;
const NODES_PER_PAGE = 20; // 50 × 20 = 1,000 nodes

function makeScaleIR() {
	const pages = Array.from({ length: PAGES }, (_, p) =>
		createPage({
			id: `p${p}`,
			root: createGroup({
				id: `root-${p}`,
				children: Array.from({ length: NODES_PER_PAGE }, (_, n) =>
					createRect({
						id: `r-${p}-${n}`,
						name: `Rect ${p}-${n}`,
						transform: { x: (n % 5) * 50, y: Math.floor(n / 5) * 50 },
						bounds: { width: 40, height: 40 },
					}),
				),
			}),
		}),
	);
	return createCanvasIR({ id: "scale-doc", pages });
}

describe("M3 document-scale smoke (50 pages / 1,000 nodes)", () => {
	const ir = makeScaleIR();

	it("full-document schema validation stays linear-ish (< 5s)", () => {
		const start = performance.now();
		expect(CanvasIRSchema.safeParse(ir).success).toBe(true);
		expect(performance.now() - start).toBeLessThan(5000);
	});

	it("cross-page find layer (FR-191) over the whole document (< 1s)", () => {
		const start = performance.now();
		const hits = findLayers(ir, { ...EMPTY_LAYER_FILTER, query: "rect 49-1" });
		expect(hits.length).toBeGreaterThan(0);
		// Uncapped scans: a broad query stays bounded by the result limit.
		expect(
			findLayers(ir, { ...EMPTY_LAYER_FILTER, query: "rect" }).length,
		).toBeLessThanOrEqual(50);
		expect(performance.now() - start).toBeLessThan(1000);
	});

	it("isolation scope + dim-set computation on a large page (< 250ms)", () => {
		const page = ir.pages[0];
		if (!page) throw new Error("no page");
		const start = performance.now();
		for (let i = 0; i < 100; i += 1) {
			isolationScopeChildren(page, []);
			computeDimmedIds(page, []);
		}
		expect(performance.now() - start).toBeLessThan(250);
	});

	it("a single command on a 1,000-node document commits quickly (< 500ms)", () => {
		const start = performance.now();
		const { ir: next } = applyCommand(ir, {
			type: "node.move",
			nodeId: "r-25-10",
			from: { x: 0, y: 100 },
			to: { x: 5, y: 105 },
		});
		expect(next).not.toBe(ir);
		expect(performance.now() - start).toBeLessThan(500);
	});
});
