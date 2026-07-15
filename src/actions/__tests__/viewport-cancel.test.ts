import {
	type CanvasIR,
	createCanvasIR,
	createGroup,
	createPage,
	createRect,
} from "@anvilkit/canvas-core";
import { describe, expect, it } from "vitest";
import { makeHarness } from "@/tools/__tests__/_tool-test-helpers.js";
import { matchesCombo } from "@/workspace/shortcuts/shortcut-registry.js";
import { cancelImpl } from "../cancel-action.js";
import {
	CANVAS_ZOOM_MAX,
	CANVAS_ZOOM_MIN,
	computeWheelZoom,
	resetZoomImpl,
	zoomInImpl,
	zoomOutImpl,
	zoomToFitImpl,
	zoomToSelectionImpl,
} from "../viewport-actions.js";

const FIXED_TS = "2026-05-20T00:00:00.000Z";

function fixtureIR(): CanvasIR {
	const page = createPage({ id: "p1" });
	page.size = { width: 1000, height: 500 };
	page.root = createGroup({
		id: "p1-root",
		bounds: page.root.bounds,
		children: [
			createRect({
				id: "a",
				transform: { x: 100, y: 100 },
				bounds: { width: 200, height: 100 },
			}),
		],
	});
	return createCanvasIR({ id: "ir", pages: [page], now: () => FIXED_TS });
}

function setup() {
	const h = makeHarness({ ir: fixtureIR() });
	h.studioCtx.viewportStore
		.getState()
		.setViewportSize({ width: 500, height: 500 });
	return h;
}

describe("viewport actions (A-07)", () => {
	it("zoomIn/zoomOut step multiplicatively and clamp", () => {
		const h = setup();
		zoomInImpl(h.studioCtx);
		expect(h.studioCtx.viewportStore.getState().zoom).toBe(1.25);
		for (let i = 0; i < 20; i++) zoomInImpl(h.studioCtx);
		expect(h.studioCtx.viewportStore.getState().zoom).toBe(CANVAS_ZOOM_MAX);
		for (let i = 0; i < 40; i++) zoomOutImpl(h.studioCtx);
		expect(h.studioCtx.viewportStore.getState().zoom).toBe(CANVAS_ZOOM_MIN);
	});

	it("zoomToFit fits the active page into the measured viewport", () => {
		const h = setup();
		zoomToFitImpl(h.studioCtx);
		// min(500/1000, 500/500) * 0.9 = 0.45
		expect(h.studioCtx.viewportStore.getState().zoom).toBe(0.45);
	});

	it("zoomToSelection fits the selection bbox", () => {
		const h = setup();
		h.studioCtx.selectionStore.getState().setSelection(["a"]);
		zoomToSelectionImpl(h.studioCtx);
		// bbox 200x100 → min(500/200, 500/100) * 0.9 = 2.25
		expect(h.studioCtx.viewportStore.getState().zoom).toBe(2.25);
	});

	it("resetZoom returns to 100%; fit is a no-op without a measured viewport", () => {
		const h = setup();
		resetZoomImpl(h.studioCtx);
		expect(h.studioCtx.viewportStore.getState().zoom).toBe(1);
		h.studioCtx.viewportStore.getState().setViewportSize(null);
		zoomToFitImpl(h.studioCtx);
		expect(h.studioCtx.viewportStore.getState().zoom).toBe(1);
	});

	it("zoom never commits history entries", () => {
		const h = setup();
		zoomInImpl(h.studioCtx);
		zoomToFitImpl(h.studioCtx);
		resetZoomImpl(h.studioCtx);
		expect(h.commits).toHaveLength(0);
		expect(h.studioCtx.historyStore.getState().canUndo()).toBe(false);
	});

	it("computeWheelZoom: negative deltaY zooms in, clamped", () => {
		expect(computeWheelZoom(1, -50)).toBeGreaterThan(1);
		expect(computeWheelZoom(1, 50)).toBeLessThan(1);
		expect(computeWheelZoom(CANVAS_ZOOM_MAX, -500)).toBe(CANVAS_ZOOM_MAX);
	});
});

describe("cancelImpl — Escape precedence (A-07, FR-040)", () => {
	it("cancels one layer per press, top-down", () => {
		const h = setup();
		const s = h.studioCtx;
		// Arrange every cancellable layer at once.
		s.editingStore.getState().setEditing("a");
		s.cropStore.getState().begin("a");
		s.penStore.getState().addAnchor({ x: 0, y: 0 });
		s.pathEditStore.getState().begin("a");
		s.draftStore.getState().setDraft({
			type: "move",
			nodeStarts: [],
			dx: 0,
			dy: 0,
		} as never);
		s.toolStore.getState().setActiveTool("rect");
		s.selectionStore.getState().setSelection(["a"]);

		expect(cancelImpl(s)).toBe("text-editing");
		expect(cancelImpl(s)).toBe("crop");
		expect(cancelImpl(s)).toBe("pen");
		expect(cancelImpl(s)).toBe("path-edit");
		expect(cancelImpl(s)).toBe("draft");
		expect(cancelImpl(s)).toBe("tool");
		expect(s.toolStore.getState().activeTool).toBe("select");
		expect(cancelImpl(s)).toBe("selection");
		expect(s.selectionStore.getState().selectedIds).toHaveLength(0);
		expect(cancelImpl(s)).toBe("none");
	});
});

describe("combo code matching (Shift+digit)", () => {
	it("matches on event.code when the combo specifies one", () => {
		const combo = { key: "1", code: "Digit1", shift: true };
		const shiftOne = {
			key: "!",
			code: "Digit1",
			metaKey: false,
			ctrlKey: false,
			shiftKey: true,
			altKey: false,
		};
		expect(matchesCombo(shiftOne, combo)).toBe(true);
		expect(matchesCombo({ ...shiftOne, code: "Digit2" }, combo)).toBe(false);
	});
});
