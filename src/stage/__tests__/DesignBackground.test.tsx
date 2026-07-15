import {
	type CanvasIR,
	type CanvasPageBackground,
	createCanvasIR,
	createPage,
} from "@anvilkit/canvas-core";
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

type ElementCall = { type: string; props: Record<string, unknown> };
const calls: ElementCall[] = [];

vi.mock("react-konva", () => ({
	Rect: (props: Record<string, unknown>) => {
		calls.push({ type: "Rect", props });
		return <div data-testid="Rect" />;
	},
}));

import { CanvasStudioContext } from "@/context/canvas-studio-context.js";
import { makeHarness } from "@/tools/__tests__/_tool-test-helpers.js";
import { DesignBackground } from "../DesignBackground.js";

afterEach(() => {
	cleanup();
	calls.length = 0;
});

const FIXED_TS = "2026-05-20T00:00:00.000Z";

function irWithBackground(background: CanvasPageBackground): CanvasIR {
	const page = createPage({ id: "p1" });
	page.size = { width: 640, height: 480 };
	page.background = background;
	return createCanvasIR({ id: "ir", pages: [page], now: () => FIXED_TS });
}

/**
 * The exact Rect the thumbnail rasterizer draws for the page background
 * (render/rasterize-page.tsx) — the live stage must stay in lockstep with it
 * so the canvas and page navigator never disagree (M0-04 regression).
 */
function rasterizerRectProps(ir: CanvasIR) {
	const page = ir.pages[0];
	if (!page) throw new Error("fixture page missing");
	return {
		x: 0,
		y: 0,
		width: page.size.width,
		height: page.size.height,
		fill: page.background.value,
	};
}

function renderBackground(ir: CanvasIR, activePageId = "p1"): void {
	const h = makeHarness({ ir });
	render(
		<CanvasStudioContext.Provider value={{ ...h.studioCtx, ir, activePageId }}>
			<DesignBackground />
		</CanvasStudioContext.Provider>,
	);
}

describe("DesignBackground (live stage page background, M0-04)", () => {
	const KINDS: readonly CanvasPageBackground[] = [
		{ kind: "solid", value: "#ff4400" },
		{ kind: "gradient", value: "linear-gradient(#000, #fff)" },
		{ kind: "image", value: "https://example.com/bg.png" },
	];

	for (const background of KINDS) {
		it(`renders the page-sized fill rect for a ${background.kind} background, matching the rasterizer`, () => {
			const ir = irWithBackground(background);
			renderBackground(ir);
			expect(calls).toHaveLength(1);
			const rect = calls[0];
			if (!rect) throw new Error("no Rect rendered");
			expect(rect.props).toMatchObject(rasterizerRectProps(ir));
			// Background must never intercept pointer events.
			expect(rect.props.listening).toBe(false);
		});
	}

	it("renders nothing when the active page is missing", () => {
		const ir = irWithBackground({ kind: "solid", value: "#123456" });
		renderBackground(ir, "not-a-page");
		expect(calls).toHaveLength(0);
	});
});
