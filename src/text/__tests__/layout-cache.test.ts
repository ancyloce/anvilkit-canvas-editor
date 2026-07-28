import type {
	MeasuredText,
	RichTextParagraph,
	RichTextStyleDefaults,
} from "@anvilkit/canvas-core";
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

/** T-M3-04 (TS-50) — the two-level key: defaults + manifest join width|wrap. */
describe("getCachedLayout key options", () => {
	const defaultsA: RichTextStyleDefaults = {
		fontFamily: "Inter",
		fontSize: 16,
		lineHeight: 1.4,
		align: "left",
	};
	const defaultsB: RichTextStyleDefaults = {
		fontFamily: "Inter",
		fontSize: 24,
		lineHeight: 1.4,
		align: "left",
	};

	it("no longer collides two nodes with different host defaults", () => {
		const paragraphs: RichTextParagraph[] = [{ spans: [{ text: "Hi" }] }];
		const resultA: MeasuredText = { lines: [], width: 1, height: 1 };
		const resultB: MeasuredText = { lines: [], width: 2, height: 2 };

		const first = getCachedLayout(paragraphs, 100, "word", () => resultA, {
			defaults: defaultsA,
		});
		const second = getCachedLayout(paragraphs, 100, "word", () => resultB, {
			defaults: defaultsB,
		});

		// The old `width|wrap` key returned `resultA` for both — the documented
		// cross-defaults collision this task exists to fix.
		expect(first).toBe(resultA);
		expect(second).toBe(resultB);
	});

	it("still hits for the same defaults object (the drag-frame fast path)", () => {
		const paragraphs: RichTextParagraph[] = [{ spans: [{ text: "Hi" }] }];
		const compute = vi.fn(() => EMPTY_RESULT);

		getCachedLayout(paragraphs, 100, "word", compute, { defaults: defaultsA });
		getCachedLayout(paragraphs, 100, "word", compute, { defaults: defaultsA });

		expect(compute).toHaveBeenCalledTimes(1);
	});

	it("performs no serialization of `defaults` on the reference fast path", () => {
		const paragraphs: RichTextParagraph[] = [{ spans: [{ text: "Hi" }] }];
		let reads = 0;
		const counted = new Proxy(
			{ ...defaultsA },
			{
				get(target, prop, receiver) {
					reads += 1;
					return Reflect.get(target, prop, receiver);
				},
			},
		) as RichTextStyleDefaults;

		getCachedLayout(paragraphs, 100, "word", () => EMPTY_RESULT, {
			defaults: counted,
		});
		expect(reads).toBeGreaterThan(0);

		reads = 0;
		getCachedLayout(paragraphs, 100, "word", () => EMPTY_RESULT, {
			defaults: counted,
		});
		// A transform-only drag frame re-uses the same defaults object; the key
		// must come from the memo, not from re-serializing the object.
		expect(reads).toBe(0);
	});

	it("recomputes when the font manifest changes", () => {
		const paragraphs: RichTextParagraph[] = [{ spans: [{ text: "Hi" }] }];
		const compute = vi.fn(() => EMPTY_RESULT);

		getCachedLayout(paragraphs, 100, "word", compute, {
			defaults: defaultsA,
			manifestHash: "0",
		});
		getCachedLayout(paragraphs, 100, "word", compute, {
			defaults: defaultsA,
			manifestHash: "1",
		});

		expect(compute).toHaveBeenCalledTimes(2);
	});
});
