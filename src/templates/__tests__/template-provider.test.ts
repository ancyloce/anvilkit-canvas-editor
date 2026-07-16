import {
	type CanvasIR,
	createCanvasIR,
	createPage,
} from "@anvilkit/canvas-core";
import { describe, expect, it } from "vitest";
import type { CanvasTemplateEntry } from "../template-entry.js";
import { createStaticTemplateProvider } from "../template-provider.js";

const FIXED_TS = "2026-07-09T00:00:00.000Z";

function doc(width = 1080, height = 1080): CanvasIR {
	return createCanvasIR({
		id: `d-${width}x${height}`,
		pages: [createPage({ size: { width, height, unit: "px" } })],
		now: () => FIXED_TS,
	});
}

function entry(
	id: string,
	overrides: Partial<CanvasTemplateEntry> = {},
): CanvasTemplateEntry {
	return {
		id,
		version: "1",
		title: id,
		category: "social",
		tags: [],
		supportedSizes: [],
		document: doc(),
		variables: [],
		editableSlots: [],
		lockedNodeIds: [],
		...overrides,
	};
}

describe("createStaticTemplateProvider (C-06, FR-131)", () => {
	it("filters by text, category, and size", async () => {
		const provider = createStaticTemplateProvider([
			entry("a", { title: "Summer Sale", tags: ["sale"] }),
			entry("b", { title: "Winter", category: "print" }),
			entry("c", { title: "Story", document: doc(1080, 1920) }),
		]);
		const byText = await provider.search({ text: "sale" });
		expect(byText.entries.map((e) => e.id)).toEqual(["a"]);
		const byCategory = await provider.search({ category: "print" });
		expect(byCategory.entries.map((e) => e.id)).toEqual(["b"]);
		const bySize = await provider.search({
			size: { width: 1080, height: 1920 },
		});
		expect(bySize.entries.map((e) => e.id)).toEqual(["c"]);
	});

	it("paginates with an offset cursor and reports total", async () => {
		const provider = createStaticTemplateProvider(
			[entry("a"), entry("b"), entry("c")],
			{ pageSize: 2 },
		);
		const first = await provider.search({});
		expect(first.entries.map((e) => e.id)).toEqual(["a", "b"]);
		expect(first.total).toBe(3);
		expect(first.nextCursor).toBe("2");
		const second = await provider.search({ cursor: first.nextCursor ?? "" });
		expect(second.entries.map((e) => e.id)).toEqual(["c"]);
		expect(second.nextCursor).toBeUndefined();
	});

	it("getById resolves an entry or null", async () => {
		const provider = createStaticTemplateProvider([entry("a")]);
		expect((await provider.getById("a"))?.id).toBe("a");
		expect(await provider.getById("missing")).toBeNull();
	});
});
