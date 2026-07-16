import {
	type CanvasIR,
	type CanvasPageSetLayoutAidsCommand,
	createCanvasIR,
	createPage,
} from "@anvilkit/canvas-core";
import { describe, expect, it } from "vitest";
import { makeHarness } from "@/tools/__tests__/_tool-test-helpers.js";
import {
	addGuideImpl,
	clearGuidesImpl,
	moveGuideImpl,
	removeGuideImpl,
	setPageLayoutAidsImpl,
} from "../guide-actions.js";

const FIXED_TS = "2026-05-20T00:00:00.000Z";

function irWithGuides(
	guides: { horizontal: number[]; vertical: number[] } | undefined,
): CanvasIR {
	const page = createPage({
		id: "p1",
		...(guides ? { layoutAids: { guides } } : {}),
	});
	return createCanvasIR({ id: "ir", pages: [page], now: () => FIXED_TS });
}

function lastCommand(h: ReturnType<typeof makeHarness>) {
	return h.commits.at(-1) as CanvasPageSetLayoutAidsCommand | undefined;
}

describe("guide-actions (C-02, FR-111)", () => {
	it("addGuide appends on the right axis and commits ONE page.set-layout-aids", () => {
		const h = makeHarness({
			ir: irWithGuides({ horizontal: [10], vertical: [] }),
		});
		const index = addGuideImpl(h.studioCtx, "horizontal", 55.129);
		expect(index).toBe(1);
		expect(h.commits).toHaveLength(1);
		const cmd = lastCommand(h);
		expect(cmd?.type).toBe("page.set-layout-aids");
		expect(cmd?.pageId).toBe("p1");
		// Rounded to 2 decimals; vertical untouched.
		expect(cmd?.to?.guides).toEqual({ horizontal: [10, 55.13], vertical: [] });
	});

	it("addGuide on a page with no aids creates the guides object", () => {
		const h = makeHarness({ ir: irWithGuides(undefined) });
		const index = addGuideImpl(h.studioCtx, "vertical", 20);
		expect(index).toBe(0);
		expect(lastCommand(h)?.to).toEqual({
			guides: { horizontal: [], vertical: [20] },
		});
	});

	it("moveGuide replaces exactly one position; bad index is a no-op", () => {
		const h = makeHarness({
			ir: irWithGuides({ horizontal: [10, 50], vertical: [30] }),
		});
		moveGuideImpl(h.studioCtx, "horizontal", 1, 75);
		expect(lastCommand(h)?.to?.guides).toEqual({
			horizontal: [10, 75],
			vertical: [30],
		});
		const commitCount = h.commits.length;
		moveGuideImpl(h.studioCtx, "horizontal", 9, 75);
		moveGuideImpl(h.studioCtx, "vertical", -1, 75);
		expect(h.commits).toHaveLength(commitCount);
	});

	it("removeGuide drops one guide; removing the last drops layoutAids entirely", () => {
		const h = makeHarness({
			ir: irWithGuides({ horizontal: [10], vertical: [30] }),
		});
		removeGuideImpl(h.studioCtx, "vertical", 0);
		expect(lastCommand(h)?.to?.guides).toEqual({
			horizontal: [10],
			vertical: [],
		});

		const h2 = makeHarness({
			ir: irWithGuides({ horizontal: [10], vertical: [] }),
		});
		removeGuideImpl(h2.studioCtx, "horizontal", 0);
		// No other aids → whole object cleared, not left as empty husks.
		expect(lastCommand(h2)?.to).toBeUndefined();
	});

	it("clearGuides clears both axes in ONE commit but keeps margins", () => {
		const page = createPage({
			id: "p1",
			layoutAids: {
				guides: { horizontal: [1, 2], vertical: [3] },
				margin: { top: 5, right: 5, bottom: 5, left: 5 },
			},
		});
		const ir = createCanvasIR({ id: "ir", pages: [page], now: () => FIXED_TS });
		const h = makeHarness({ ir });
		clearGuidesImpl(h.studioCtx);
		expect(h.commits).toHaveLength(1);
		expect(lastCommand(h)?.to).toEqual({
			margin: { top: 5, right: 5, bottom: 5, left: 5 },
		});
	});

	it("clearGuides with nothing to clear commits nothing", () => {
		const h = makeHarness({ ir: irWithGuides(undefined) });
		clearGuidesImpl(h.studioCtx);
		expect(h.commits).toHaveLength(0);
	});

	it("setPageLayoutAids replaces the whole aid set on the addressed page", () => {
		const h = makeHarness({
			ir: irWithGuides({ horizontal: [9], vertical: [] }),
		});
		setPageLayoutAidsImpl(h.studioCtx, "p1", {
			margin: { top: 1, right: 2, bottom: 3, left: 4 },
		});
		expect(lastCommand(h)?.to).toEqual({
			margin: { top: 1, right: 2, bottom: 3, left: 4 },
		});
		setPageLayoutAidsImpl(h.studioCtx, "p1", undefined);
		expect(lastCommand(h)?.to).toBeUndefined();
		const commitCount = h.commits.length;
		setPageLayoutAidsImpl(h.studioCtx, "missing-page", undefined);
		expect(h.commits).toHaveLength(commitCount);
	});
});
