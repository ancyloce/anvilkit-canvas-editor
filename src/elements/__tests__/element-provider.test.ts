import { createPath } from "@anvilkit/canvas-core";
import { describe, expect, it, vi } from "vitest";
import type {
	CanvasElementBuildContext,
	CanvasElementEntry,
} from "../element-entry.js";
import {
	CANVAS_ELEMENT_CATEGORIES,
	CANVAS_ELEMENT_NODE_KINDS,
} from "../element-entry.js";
import {
	type CanvasElementProvider,
	createLazyElementProvider,
	createStaticElementProvider,
} from "../element-provider.js";

const SQUARE = "M0 0H24V24H0Z";

function entry(
	id: string,
	overrides: Partial<CanvasElementEntry> = {},
): CanvasElementEntry {
	return {
		id,
		name: id,
		category: "shape",
		tags: [],
		preview: { kind: "path", d: SQUARE },
		defaultSize: { width: 24, height: 24 },
		license: "MIT",
		recolor: "fill",
		build: (context: CanvasElementBuildContext = {}) =>
			createPath({
				...(context.newId ? { id: context.newId() } : {}),
				d: SQUARE,
				bounds: context.size ?? { width: 24, height: 24 },
				transform: context.at ?? { x: 0, y: 0 },
				fill: context.fill ?? "#000000",
			}),
		...overrides,
	};
}

describe("createStaticElementProvider (cp3-001)", () => {
	it("filters by text and category", async () => {
		const provider = createStaticElementProvider([
			entry("a", { name: "Trash can", tags: ["ui"], keywords: ["bin"] }),
			entry("b", { name: "Star", category: "icon" }),
			entry("c", { name: "Arrow", category: "line" }),
		]);
		const byName = await provider.search({ text: "trash" });
		expect(byName.entries.map((e) => e.id)).toEqual(["a"]);
		const byCategory = await provider.search({ category: "icon" });
		expect(byCategory.entries.map((e) => e.id)).toEqual(["b"]);
		const byTag = await provider.search({ text: "ui" });
		expect(byTag.entries.map((e) => e.id)).toEqual(["a"]);
	});

	// The one deviation from the template provider's `matchesText`, and the
	// reason `cp3-002` can ship an icon set that is actually findable.
	it("searches keywords, not only name and tags", async () => {
		const provider = createStaticElementProvider([
			entry("trash", {
				name: "Trash can",
				tags: ["ui"],
				keywords: ["bin", "delete", "remove"],
			}),
		]);
		for (const term of ["bin", "delete", "remove"]) {
			const result = await provider.search({ text: term });
			expect(result.entries.map((e) => e.id)).toEqual(["trash"]);
		}
		expect((await provider.search({ text: "kettle" })).entries).toEqual([]);
	});

	it("combines the text and category filters", async () => {
		const provider = createStaticElementProvider([
			entry("a", { name: "Star", category: "icon" }),
			entry("b", { name: "Star", category: "shape" }),
		]);
		const result = await provider.search({ text: "star", category: "shape" });
		expect(result.entries.map((e) => e.id)).toEqual(["b"]);
	});

	/**
	 * PAGINATION PARITY. Deliberately the same assertions, in the same order,
	 * as `templates/__tests__/template-provider.test.ts`'s
	 * "paginates with an offset cursor and reports total" — same page size, same
	 * three entries, same expected cursor string. If the two ever disagree, one
	 * of them changed and the "learn one, learn both" promise is broken.
	 */
	it("paginates with an offset cursor and reports total", async () => {
		const provider = createStaticElementProvider(
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

	it("never repeats an entry across pages", async () => {
		const entries = Array.from({ length: 7 }, (_, i) => entry(`e${i}`));
		const provider = createStaticElementProvider(entries, { pageSize: 3 });
		const seen: string[] = [];
		let cursor: string | undefined;
		do {
			const page: Awaited<ReturnType<CanvasElementProvider["search"]>> =
				await provider.search(cursor === undefined ? {} : { cursor });
			seen.push(...page.entries.map((e) => e.id));
			cursor = page.nextCursor;
		} while (cursor !== undefined);
		expect(seen).toEqual(entries.map((e) => e.id));
		expect(new Set(seen).size).toBe(seen.length);
	});

	it("applies the per-query limit over the constructor page size", async () => {
		const provider = createStaticElementProvider(
			[entry("a"), entry("b"), entry("c")],
			{ pageSize: 3 },
		);
		const result = await provider.search({ limit: 1 });
		expect(result.entries.map((e) => e.id)).toEqual(["a"]);
		expect(result.nextCursor).toBe("1");
	});

	it("getById resolves an entry or null", async () => {
		const provider = createStaticElementProvider([entry("a")]);
		expect((await provider.getById("a"))?.id).toBe("a");
		expect(await provider.getById("missing")).toBeNull();
	});
});

describe("createLazyElementProvider (cp3-001)", () => {
	it("does not load until the first query, then loads once", async () => {
		const load = vi.fn(async () =>
			createStaticElementProvider([entry("a"), entry("b")]),
		);
		const provider = createLazyElementProvider(load);
		expect(load).not.toHaveBeenCalled();

		const first = await provider.search({});
		expect(first.entries.map((e) => e.id)).toEqual(["a", "b"]);
		await provider.search({ text: "a" });
		await provider.getById("b");
		expect(load).toHaveBeenCalledTimes(1);
	});

	it("retries after a failed load rather than caching the rejection", async () => {
		let attempt = 0;
		const load = vi.fn(async () => {
			attempt += 1;
			if (attempt === 1) throw new Error("offline");
			return createStaticElementProvider([entry("a")]);
		});
		const provider = createLazyElementProvider(load);
		await expect(provider.search({})).rejects.toThrow("offline");
		const retry = await provider.search({});
		expect(retry.entries.map((e) => e.id)).toEqual(["a"]);
		expect(load).toHaveBeenCalledTimes(2);
	});
});

describe("element contract constants (cp3-001)", () => {
	it("lists all five categories", () => {
		expect([...CANVAS_ELEMENT_CATEGORIES].sort()).toEqual([
			"frame",
			"icon",
			"line",
			"shape",
			"sticker",
		]);
	});

	// The key decision, guarded at runtime as well as at compile time: no
	// asset-referencing or document-state-requiring kind is buildable.
	it("excludes every kind that would need document-level state", () => {
		for (const kind of [
			"svg",
			"image",
			"video",
			"audio",
			"component-instance",
			"ai-placeholder",
			"text",
			"rich-text",
		]) {
			expect(CANVAS_ELEMENT_NODE_KINDS).not.toContain(kind);
		}
		expect([...CANVAS_ELEMENT_NODE_KINDS].sort()).toEqual([
			"ellipse",
			"frame",
			"group",
			"line",
			"path",
			"polygon",
			"rect",
			"star",
		]);
	});

	it("honours the build context's placement, size and id factory", () => {
		let n = 0;
		const node = entry("a").build({
			newId: () => `fixed-${(n += 1)}`,
			at: { x: 40, y: 12 },
			size: { width: 64, height: 64 },
			fill: "#ff0000",
		});
		expect(node.id).toBe("fixed-1");
		expect(node.transform.x).toBe(40);
		expect(node.transform.y).toBe(12);
		expect(node.bounds).toEqual({ width: 64, height: 64 });
		expect(node.type === "path" && node.fill).toBe("#ff0000");
	});

	// The literal deliverable signature: `build()` with no argument.
	it("builds with no context at all", () => {
		const node = entry("a").build();
		expect(node.type).toBe("path");
		expect(node.bounds).toEqual({ width: 24, height: 24 });
		expect(node.transform).toMatchObject({ x: 0, y: 0 });
	});
});
