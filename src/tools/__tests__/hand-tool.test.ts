import { describe, expect, it } from "vitest";
import { handTool } from "../hand-tool.js";
import { makeHarness, pointerEvent } from "./_tool-test-helpers.js";

describe("handTool", () => {
	it("starts a pan draft on pointerdown, never commits", () => {
		const h = makeHarness();
		handTool.onPointerDown?.(pointerEvent(100, 50), h.ctx);
		const draft = h.ctx.draftStore.getState().draft;
		expect(draft?.type).toBe("pan");
		expect(h.commits).toHaveLength(0);
	});

	it("pointermove updates viewport pan by screen delta", () => {
		const h = makeHarness();
		const startVp = h.ctx.viewportStore.getState();
		expect(startVp.panX).toBe(0);
		expect(startVp.panY).toBe(0);
		handTool.onPointerDown?.(pointerEvent(100, 50), h.ctx);
		handTool.onPointerMove?.(pointerEvent(130, 70), h.ctx);
		const vp = h.ctx.viewportStore.getState();
		expect(vp.panX).toBe(30);
		expect(vp.panY).toBe(20);
		expect(h.commits).toHaveLength(0);
	});

	it("pointerup clears the draft, leaves viewport pan intact", () => {
		const h = makeHarness();
		handTool.onPointerDown?.(pointerEvent(100, 50), h.ctx);
		handTool.onPointerMove?.(pointerEvent(180, 100), h.ctx);
		handTool.onPointerUp?.(pointerEvent(180, 100), h.ctx);
		expect(h.ctx.draftStore.getState().draft).toBeNull();
		// Pan persisted.
		expect(h.ctx.viewportStore.getState().panX).toBe(80);
		expect(h.ctx.viewportStore.getState().panY).toBe(50);
		expect(h.commits).toHaveLength(0);
	});

	it("relative-pan: pan compounds correctly across two drags", () => {
		const h = makeHarness();
		// First drag.
		handTool.onPointerDown?.(pointerEvent(0, 0), h.ctx);
		handTool.onPointerMove?.(pointerEvent(40, 30), h.ctx);
		handTool.onPointerUp?.(pointerEvent(40, 30), h.ctx);
		expect(h.ctx.viewportStore.getState().panX).toBe(40);
		// Second drag from a different screen origin.
		handTool.onPointerDown?.(pointerEvent(100, 100), h.ctx);
		handTool.onPointerMove?.(pointerEvent(150, 110), h.ctx);
		expect(h.ctx.viewportStore.getState().panX).toBe(90);
		expect(h.ctx.viewportStore.getState().panY).toBe(40);
	});

	it("never commits — pan is view state only (MVP-7 negative case)", () => {
		const h = makeHarness();
		handTool.onPointerDown?.(pointerEvent(0, 0), h.ctx);
		for (let i = 0; i < 10; i++) {
			handTool.onPointerMove?.(pointerEvent(i * 5, i * 3), h.ctx);
		}
		handTool.onPointerUp?.(pointerEvent(50, 30), h.ctx);
		expect(h.commits).toHaveLength(0);
	});

	it("onActivate sets cursor; onDeactivate clears draft + cursor", () => {
		const h = makeHarness();
		handTool.onActivate?.(h.ctx);
		// Stage container has cursor set in helper.
		const container = (
			h.ctx.stage as unknown as { container: () => HTMLElement }
		).container();
		expect(container.style.cursor).toBe("grab");
		handTool.onPointerDown?.(pointerEvent(0, 0), h.ctx);
		handTool.onDeactivate?.(h.ctx);
		expect(h.ctx.draftStore.getState().draft).toBeNull();
		expect(container.style.cursor).toBe("default");
	});
});
