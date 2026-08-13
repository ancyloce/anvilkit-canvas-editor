import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createViewportStore } from "@/stores/viewport-store.js";
import {
	CANVAS_STAGE_FOOTPRINT_ATTRIBUTE,
	clientPointToPage,
	pageToClientPoint,
	type ViewportPointContext,
} from "../viewport-point.js";

/** Per-element rect fakes, keyed by `data-rect-id` (jsdom measures 0×0). */
const rects = new Map<
	string,
	{ left: number; top: number; width: number; height: number }
>();

beforeEach(() => {
	rects.clear();
	vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(
		function (this: Element) {
			const key = this.getAttribute?.("data-rect-id");
			const r = (key && rects.get(key)) || {
				left: 0,
				top: 0,
				width: 0,
				height: 0,
			};
			return {
				...r,
				right: r.left + r.width,
				bottom: r.top + r.height,
				x: r.left,
				y: r.top,
				toJSON: () => r,
			} as DOMRect;
		},
	);
});

afterEach(() => {
	vi.restoreAllMocks();
	document.body.innerHTML = "";
});

function makeCtx(options: {
	zoom: number;
	panX?: number;
	panY?: number;
	windowed?: boolean;
}): ViewportPointContext {
	const container = document.createElement("div");
	container.setAttribute("data-rect-id", "container");
	if (options.windowed) {
		const footprint = document.createElement("div");
		footprint.setAttribute(CANVAS_STAGE_FOOTPRINT_ATTRIBUTE, "");
		footprint.setAttribute("data-rect-id", "footprint");
		footprint.appendChild(container);
		document.body.appendChild(footprint);
	} else {
		document.body.appendChild(container);
	}
	return {
		stage: { container: () => container } as never,
		viewportStore: createViewportStore({
			zoom: options.zoom,
			panX: options.panX ?? 0,
			panY: options.panY ?? 0,
		}),
	};
}

describe("viewport-point under the K-1 windowed stage", () => {
	it("anchors on the FOOTPRINT, not the container, when windowed", () => {
		// Footprint at (100, 50); the canvas window sits 512 px further in.
		rects.set("footprint", { left: 100, top: 50, width: 2000, height: 1500 });
		rects.set("container", { left: 612, top: 562, width: 800, height: 600 });
		const ctx = makeCtx({ zoom: 2, panX: 0, panY: 0, windowed: true });

		// Page (10, 20) → client = footprint.origin + page × zoom + pan.
		expect(pageToClientPoint(ctx, 10, 20)).toEqual({ x: 120, y: 90 });
		// And the inverse agrees.
		expect(clientPointToPage(ctx, 120, 90)).toEqual({ x: 10, y: 20 });
	});

	it("keeps the pre-K-1 container anchor without a footprint", () => {
		rects.set("container", { left: 100, top: 50, width: 800, height: 600 });
		const ctx = makeCtx({ zoom: 2, panX: 6, panY: 8, windowed: false });

		expect(pageToClientPoint(ctx, 10, 20)).toEqual({
			x: 100 + 10 * 2 + 6,
			y: 50 + 20 * 2 + 8,
		});
		expect(clientPointToPage(ctx, 126, 98)).toEqual({ x: 10, y: 20 });
	});

	it("returns undefined without a mounted stage", () => {
		const ctx: ViewportPointContext = {
			stage: null,
			viewportStore: createViewportStore(),
		} as never;
		expect(pageToClientPoint(ctx, 0, 0)).toBeUndefined();
		expect(clientPointToPage(ctx, 0, 0)).toBeUndefined();
	});
});
