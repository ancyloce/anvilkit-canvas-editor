import { act, cleanup, render } from "@testing-library/react";
import { useRef } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	type StageWindow,
	useStageWindow,
	type WindowRect,
} from "../stage-window.js";
import { CANVAS_VIEWPORT_ATTRIBUTE } from "../viewport-point.js";

afterEach(() => {
	cleanup();
	vi.restoreAllMocks();
	vi.unstubAllGlobals();
});

/**
 * jsdom measures every element as 0×0, which `computeStageWindow` correctly
 * treats as unmeasurable. Rects are faked per element via a `data-rect-id`
 * lookup so mount-time measurement (a layout effect — before any test code
 * can stub the instance) already sees them.
 */
const rects = new Map<string, WindowRect>();

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
	// Deterministic rAF: the hook coalesces scroll bursts through it.
	vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback): number => {
		cb(0);
		return 1;
	});
	vi.stubGlobal("cancelAnimationFrame", () => undefined);
});

function Probe({
	onWindow,
}: {
	onWindow: (w: StageWindow | null) => void;
}): React.JSX.Element {
	const ref = useRef<HTMLDivElement>(null);
	onWindow(useStageWindow(ref));
	return <div ref={ref} data-rect-id="footprint" />;
}

describe("useStageWindow (K-1)", () => {
	it("returns null without a [data-canvas-viewport] ancestor", () => {
		rects.set("footprint", { left: 0, top: 0, width: 4000, height: 3000 });
		let latest: StageWindow | null = null;
		render(<Probe onWindow={(w) => (latest = w)} />);
		expect(latest).toBe(null);
	});

	it("measures a window inside the scroll viewport and updates on scroll", () => {
		rects.set("host", { left: 0, top: 0, width: 800, height: 600 });
		rects.set("footprint", {
			left: -500,
			top: -1000,
			width: 4000,
			height: 3000,
		});
		let latest: StageWindow | null = null;
		const { container } = render(
			<div data-rect-id="host" {...{ [CANVAS_VIEWPORT_ATTRIBUTE]: "" }}>
				<Probe onWindow={(w) => (latest = w)} />
			</div>,
		);
		const first = latest as StageWindow | null;
		expect(first).not.toBe(null);
		// Bounded by viewport + pad + quantum, positioned in footprint coords.
		expect((first as StageWindow).x).toBeGreaterThanOrEqual(0);
		expect((first as StageWindow).width).toBeLessThan(4000);

		// Scroll far enough to cross a quantum boundary: the footprint's rect
		// moves relative to the (fixed) host.
		rects.set("footprint", {
			left: -500,
			top: -2200,
			width: 4000,
			height: 3000,
		});
		const host = container.querySelector("[data-rect-id=host]");
		act(() => {
			host?.dispatchEvent(new Event("scroll"));
		});
		const second = latest as StageWindow | null;
		expect(second).not.toBe(null);
		expect((second as StageWindow).y).toBeGreaterThan((first as StageWindow).y);
	});

	it("keeps the same window reference for a sub-quantum scroll", () => {
		rects.set("host", { left: 0, top: 0, width: 800, height: 600 });
		rects.set("footprint", { left: 0, top: -1000, width: 4000, height: 3000 });
		let latest: StageWindow | null = null;
		const { container } = render(
			<div data-rect-id="host" {...{ [CANVAS_VIEWPORT_ATTRIBUTE]: "" }}>
				<Probe onWindow={(w) => (latest = w)} />
			</div>,
		);
		const first = latest;
		rects.set("footprint", { left: 0, top: -1010, width: 4000, height: 3000 });
		const host = container.querySelector("[data-rect-id=host]");
		act(() => {
			host?.dispatchEvent(new Event("scroll"));
		});
		// Same reference — no re-render churn for a 10 px scroll.
		expect(latest).toBe(first);
	});
});
