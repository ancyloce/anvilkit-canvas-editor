import {
	type CanvasIR,
	type CanvasPageLayoutAids,
	createCanvasIR,
	createPage,
} from "@anvilkit/canvas-core";
import { act, cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
	CanvasStudioContext,
	type CanvasStudioContextValue,
	CanvasStudioStableContext,
} from "@/context/canvas-studio-context.js";
import { createRulerGuideStore } from "@/stores/ruler-guide-store.js";
import { makeHarness } from "@/tools/__tests__/_tool-test-helpers.js";
import { GuideLayoutOverlay } from "../GuideLayoutOverlay.js";

const shapeCalls: Array<{ kind: string; props: Record<string, unknown> }> = [];

vi.mock("react-konva", () => ({
	Line: (props: Record<string, unknown>) => {
		shapeCalls.push({ kind: "line", props });
		return null;
	},
	Rect: (props: Record<string, unknown>) => {
		shapeCalls.push({ kind: "rect", props });
		return null;
	},
}));

const FIXED_TS = "2026-05-20T00:00:00.000Z";

function irWithAids(aids: CanvasPageLayoutAids | undefined): CanvasIR {
	const page = createPage({
		id: "p1",
		size: { width: 400, height: 200 },
		...(aids ? { layoutAids: aids } : {}),
	});
	return createCanvasIR({ id: "ir", pages: [page], now: () => FIXED_TS });
}

function renderOverlay(
	aids: CanvasPageLayoutAids | undefined,
	storeOptions: Parameters<typeof createRulerGuideStore>[0] = {},
) {
	shapeCalls.length = 0;
	const h = makeHarness({ ir: irWithAids(aids) });
	const rulerGuideStore = createRulerGuideStore(storeOptions);
	const ctx: CanvasStudioContextValue = {
		...h.studioCtx,
		rulerGuideStore,
		ir: h.studioCtx.getIR(),
	};
	const view = render(
		<CanvasStudioStableContext.Provider value={ctx}>
			<CanvasStudioContext.Provider value={ctx}>
				<GuideLayoutOverlay />
			</CanvasStudioContext.Provider>
		</CanvasStudioStableContext.Provider>,
	);
	return { rulerGuideStore, view };
}

function names(): string[] {
	return shapeCalls.map((c) => String(c.props.name));
}

afterEach(cleanup);

describe("GuideLayoutOverlay (C-02, FR-111/FR-113)", () => {
	it("renders one line per persisted guide, draggable when unlocked", () => {
		renderOverlay({ guides: { horizontal: [50], vertical: [100, 200] } });
		const lines = shapeCalls.filter((c) => c.kind === "line");
		expect(lines).toHaveLength(3);
		expect(names()).toEqual(
			expect.arrayContaining([
				"ruler-guide-horizontal-0",
				"ruler-guide-vertical-0",
				"ruler-guide-vertical-1",
			]),
		);
		for (const line of lines) {
			expect(line.props.draggable).toBe(true);
		}
		// Horizontal guide spans the page width at y=50.
		const horizontal = shapeCalls.find(
			(c) => c.props.name === "ruler-guide-horizontal-0",
		);
		expect(horizontal?.props.points).toEqual([0, 50, 400, 50]);
	});

	it("locked guides are not draggable; hidden guides do not render", () => {
		renderOverlay(
			{ guides: { horizontal: [50], vertical: [] } },
			{ guidesLocked: true },
		);
		const locked = shapeCalls.find(
			(c) => c.props.name === "ruler-guide-horizontal-0",
		);
		expect(locked?.props.draggable).toBe(false);

		renderOverlay(
			{ guides: { horizontal: [50], vertical: [] } },
			{ guidesVisible: false },
		);
		expect(names()).not.toContain("ruler-guide-horizontal-0");
	});

	it("renders margin/bleed/safe-area frames and hides them when toggled off", () => {
		const aids: CanvasPageLayoutAids = {
			margin: { top: 10, right: 10, bottom: 10, left: 10 },
			bleed: { top: 3, right: 3, bottom: 3, left: 3 },
			safeArea: { top: 20, right: 0, bottom: 20, left: 0 },
		};
		renderOverlay(aids);
		expect(names()).toEqual(
			expect.arrayContaining([
				"layout-aid-margin",
				"layout-aid-bleed",
				"layout-aid-safe-area",
			]),
		);
		const margin = shapeCalls.find((c) => c.props.name === "layout-aid-margin");
		expect(margin?.props).toMatchObject({
			x: 10,
			y: 10,
			width: 380,
			height: 180,
			listening: false,
		});
		// Bleed extends OUTWARD from the page edge.
		const bleed = shapeCalls.find((c) => c.props.name === "layout-aid-bleed");
		expect(bleed?.props).toMatchObject({
			x: -3,
			y: -3,
			width: 406,
			height: 206,
		});

		renderOverlay(aids, { layoutAidsVisible: false });
		expect(names()).not.toContain("layout-aid-margin");
	});

	it("renders center lines only when enabled", () => {
		renderOverlay(undefined, { centerLinesVisible: true });
		expect(names()).toEqual(
			expect.arrayContaining([
				"center-line-vertical",
				"center-line-horizontal",
			]),
		);
		renderOverlay(undefined);
		expect(names()).not.toContain("center-line-vertical");
	});

	it("renders the drag-from-ruler preview from pendingGuide", () => {
		const { rulerGuideStore } = renderOverlay(undefined);
		expect(names()).not.toContain("pending-guide");
		act(() => {
			rulerGuideStore
				.getState()
				.setPendingGuide({ axis: "vertical", position: 120 });
		});
		const pending = shapeCalls.find((c) => c.props.name === "pending-guide");
		expect(pending?.props.points).toEqual([120, 0, 120, 200]);
		expect(pending?.props.listening).toBe(false);
	});

	it("renders nothing without a ruler-guide store (partial test contexts)", () => {
		shapeCalls.length = 0;
		const h = makeHarness({
			ir: irWithAids({ guides: { horizontal: [50], vertical: [] } }),
		});
		const ctx: CanvasStudioContextValue = {
			...h.studioCtx,
			ir: h.studioCtx.getIR(),
		};
		render(
			<CanvasStudioStableContext.Provider value={ctx}>
				<CanvasStudioContext.Provider value={ctx}>
					<GuideLayoutOverlay />
				</CanvasStudioContext.Provider>
			</CanvasStudioStableContext.Provider>,
		);
		expect(shapeCalls).toHaveLength(0);
	});
});
