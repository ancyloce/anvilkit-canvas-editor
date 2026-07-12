import type { CanvasNodeCreateCommand } from "@anvilkit/canvas-core";
import { describe, expect, it } from "vitest";
import { richTextTool } from "../rich-text-tool.js";
import { makeHarness, pointerEvent } from "./_tool-test-helpers.js";

describe("richTextTool", () => {
	it("places a rich-text node and opens editor on pointerdown", () => {
		const h = makeHarness();
		richTextTool.onPointerDown?.(pointerEvent(40, 60), h.ctx);
		expect(h.commits).toHaveLength(1);
		const cmd = h.commits[0] as CanvasNodeCreateCommand;
		expect(cmd.type).toBe("node.create");
		expect(cmd.node.type).toBe("rich-text");
		expect(cmd.node.transform.x).toBe(40);
		expect(cmd.node.transform.y).toBe(60);
		expect(
			(cmd.node as { paragraphs: { spans: { text: string }[] }[] }).paragraphs,
		).toEqual([{ spans: [{ text: "Text" }] }]);
		// Selection + editing state set.
		expect(h.ctx.selectionStore.getState().selectedIds).toEqual([cmd.node.id]);
		expect(h.ctx.editingStore.getState().editingNodeId).toBe(cmd.node.id);
	});

	it("pointermove / pointerup are no-ops (MVP-7: single command per click)", () => {
		const h = makeHarness();
		richTextTool.onPointerDown?.(pointerEvent(40, 60), h.ctx);
		expect(richTextTool.onPointerMove).toBeUndefined();
		expect(richTextTool.onPointerUp).toBeUndefined();
		expect(h.commits).toHaveLength(1);
	});

	it("onDeactivate clears editing state", () => {
		const h = makeHarness();
		richTextTool.onPointerDown?.(pointerEvent(0, 0), h.ctx);
		expect(h.ctx.editingStore.getState().editingNodeId).not.toBeNull();
		richTextTool.onDeactivate?.(h.ctx);
		expect(h.ctx.editingStore.getState().editingNodeId).toBeNull();
	});
});
