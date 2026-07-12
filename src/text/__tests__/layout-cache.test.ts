import type { MeasuredText, RichTextParagraph } from "@anvilkit/canvas-core";
import { describe, expect, it, vi } from "vitest";
import { getCachedLayout } from "../layout-cache.js";

const EMPTY_RESULT: MeasuredText = { lines: [], width: 0, height: 0 };

describe("getCachedLayout", () => {
	it("computes once and reuses the result for the same paragraphs/width/wrap", () => {
		const paragraphs: RichTextParagraph[] = [{ spans: [{ text: "Hi" }] }];
		const compute = vi.fn(() => EMPTY_RESULT);

		const first = getCachedLayout(paragraphs, 100, "word", compute);
		const second = getCachedLayout(paragraphs, 100, "word", compute);

		expect(second).toBe(first);
		expect(compute).toHaveBeenCalledTimes(1);
	});

	it("hits the cache across a NEW node object as long as `paragraphs` is the same reference (the drag-frame case)", () => {
		const paragraphs: RichTextParagraph[] = [{ spans: [{ text: "Hi" }] }];
		const compute = vi.fn(() => EMPTY_RESULT);

		// Simulates ir/mutations.ts's shallow `{ ...node, transform: ... }` spread
		// on a transform-only patch: a new node object, same `paragraphs` array.
		const nodeA = { paragraphs, width: 100, wrap: "word" as const };
		const nodeB = { ...nodeA, transform: { x: 5, y: 5 } };

		getCachedLayout(nodeA.paragraphs, nodeA.width, nodeA.wrap, compute);
		getCachedLayout(nodeB.paragraphs, nodeB.width, nodeB.wrap, compute);

		expect(compute).toHaveBeenCalledTimes(1);
	});

	it("recomputes when width or wrap differ, even for the same paragraphs", () => {
		const paragraphs: RichTextParagraph[] = [{ spans: [{ text: "Hi" }] }];
		const compute = vi.fn(() => EMPTY_RESULT);

		getCachedLayout(paragraphs, 100, "word", compute);
		getCachedLayout(paragraphs, 200, "word", compute);
		getCachedLayout(paragraphs, 100, "character", compute);

		expect(compute).toHaveBeenCalledTimes(3);
	});

	it("recomputes when `paragraphs` itself is a new array (a real text edit)", () => {
		const compute = vi.fn(() => EMPTY_RESULT);

		getCachedLayout([{ spans: [{ text: "Hi" }] }], 100, "word", compute);
		getCachedLayout([{ spans: [{ text: "Hi" }] }], 100, "word", compute);

		expect(compute).toHaveBeenCalledTimes(2);
	});
});
