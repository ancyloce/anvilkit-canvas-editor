import { describe, expect, it } from "vitest";
import { aiImageTool } from "../ai-image-tool.js";
import type { AiImageMarqueeIntent } from "../ai-intent.js";
import { makeHarness, pointerEvent } from "./_tool-test-helpers.js";

describe("aiImageTool", () => {
	it("drags a marquee draft and emits one ai-image-marquee intent on pointerup", () => {
		const h = makeHarness();
		aiImageTool.onPointerDown?.(pointerEvent(10, 20), h.ctx);
		expect(h.ctx.draftStore.getState().draft).toMatchObject({
			type: "marquee",
			startX: 10,
			startY: 20,
			currentX: 10,
			currentY: 20,
		});

		aiImageTool.onPointerMove?.(pointerEvent(60, 90), h.ctx);
		expect(h.ctx.draftStore.getState().draft).toMatchObject({
			currentX: 60,
			currentY: 90,
		});
		expect(h.aiIntents).toHaveLength(0); // nothing emitted mid-drag

		aiImageTool.onPointerUp?.(pointerEvent(60, 90), h.ctx);
		expect(h.aiIntents).toHaveLength(1);
		const intent = h.aiIntents[0] as AiImageMarqueeIntent;
		expect(intent.kind).toBe("ai-image-marquee");
		expect(intent.context).toEqual({
			artboardId: "p1",
			bounds: { x: 10, y: 20, width: 50, height: 70 },
		});

		// Draft cleared; intent is NOT a command — history untouched.
		expect(h.ctx.draftStore.getState().draft).toBeNull();
		expect(h.commits).toHaveLength(0);
	});

	it("derives the corner when dragged right-to-left / bottom-to-top", () => {
		const h = makeHarness();
		aiImageTool.onPointerDown?.(pointerEvent(100, 100), h.ctx);
		aiImageTool.onPointerUp?.(pointerEvent(30, 40), h.ctx);
		const intent = h.aiIntents[0] as AiImageMarqueeIntent;
		expect(intent.context.bounds).toEqual({
			x: 30,
			y: 40,
			width: 70,
			height: 60,
		});
	});

	it("emits nothing for a degenerate click (zero-area marquee)", () => {
		const h = makeHarness();
		aiImageTool.onPointerDown?.(pointerEvent(10, 10), h.ctx);
		aiImageTool.onPointerUp?.(pointerEvent(10.5, 10.5), h.ctx);
		expect(h.aiIntents).toHaveLength(0);
		expect(h.ctx.draftStore.getState().draft).toBeNull();
	});

	it("emits nothing for a 1-D drag (a line has no usable region)", () => {
		// Horizontal drag: width grows but height stays ~0.
		const hWide = makeHarness();
		aiImageTool.onPointerDown?.(pointerEvent(10, 50), hWide.ctx);
		aiImageTool.onPointerUp?.(pointerEvent(200, 50), hWide.ctx);
		expect(hWide.aiIntents).toHaveLength(0);

		// Vertical drag: height grows but width stays ~0.
		const hTall = makeHarness();
		aiImageTool.onPointerDown?.(pointerEvent(50, 10), hTall.ctx);
		aiImageTool.onPointerUp?.(pointerEvent(50, 200), hTall.ctx);
		expect(hTall.aiIntents).toHaveLength(0);
	});

	it("pointermove without a prior pointerdown is a no-op", () => {
		const h = makeHarness();
		expect(() =>
			aiImageTool.onPointerMove?.(pointerEvent(10, 10), h.ctx),
		).not.toThrow();
		expect(h.ctx.draftStore.getState().draft).toBeNull();
	});

	it("does not throw when no AI host is wired (requestAiIntent absent)", () => {
		const h = makeHarness();
		h.ctx.requestAiIntent = undefined;
		aiImageTool.onPointerDown?.(pointerEvent(0, 0), h.ctx);
		expect(() =>
			aiImageTool.onPointerUp?.(pointerEvent(40, 40), h.ctx),
		).not.toThrow();
		expect(h.ctx.draftStore.getState().draft).toBeNull();
	});

	it("onDeactivate clears the draft", () => {
		const h = makeHarness();
		aiImageTool.onPointerDown?.(pointerEvent(10, 10), h.ctx);
		aiImageTool.onDeactivate?.(h.ctx);
		expect(h.ctx.draftStore.getState().draft).toBeNull();
	});
});
