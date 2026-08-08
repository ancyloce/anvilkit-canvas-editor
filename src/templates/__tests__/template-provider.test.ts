import {
	type CanvasIR,
	createCanvasIR,
	createPage,
} from "@anvilkit/canvas-core";
import { describe, expect, it } from "vitest";
import type { CanvasTemplateEntry } from "../template-entry.js";
import {
	createStaticTemplateProvider,
	normalizeTemplateTag,
} from "../template-provider.js";

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

describe("createStaticTemplateProvider — tag facet (cp3-006)", () => {
	const catalog = [
		entry("poster", {
			title: "Event Poster",
			category: "social",
			tags: ["poster", "portrait", "event"],
		}),
		entry("flyer", {
			title: "A4 Flyer",
			category: "print",
			tags: ["flyer", "portrait", "marketing"],
		}),
		entry("card", {
			title: "Business Card",
			category: "print",
			tags: ["business-card", "landscape", "networking"],
		}),
	];

	it("returns exactly the templates carrying the tag", async () => {
		const provider = createStaticTemplateProvider(catalog);
		const result = await provider.search({ tags: ["portrait"] });
		expect(result.entries.map((e) => e.id)).toEqual(["poster", "flyer"]);
		expect(result.total).toBe(2);
	});

	it("ANDs multiple tags rather than ORing them", async () => {
		const provider = createStaticTemplateProvider(catalog);
		expect(
			(await provider.search({ tags: ["portrait", "marketing"] })).entries.map(
				(e) => e.id,
			),
		).toEqual(["flyer"]);
		// The OR reading would have returned all three.
		expect(
			(await provider.search({ tags: ["portrait", "networking"] })).entries,
		).toEqual([]);
	});

	it("matches case-insensitively and ignores surrounding whitespace", async () => {
		const provider = createStaticTemplateProvider(catalog);
		expect(
			(await provider.search({ tags: [" Portrait "] })).entries.map(
				(e) => e.id,
			),
		).toEqual(["poster", "flyer"]);
	});

	it("treats an empty tag list as unfiltered", async () => {
		const provider = createStaticTemplateProvider(catalog);
		expect((await provider.search({ tags: [] })).entries).toHaveLength(3);
	});

	// The acceptance criterion cp3-006 names explicitly: the two facets narrow
	// TOGETHER. Tested as a combination because each alone passing proves
	// nothing about the `&&` between them.
	it("composes with the category facet", async () => {
		const provider = createStaticTemplateProvider(catalog);
		expect(
			(
				await provider.search({ category: "print", tags: ["portrait"] })
			).entries.map((e) => e.id),
		).toEqual(["flyer"]);
		// Same tag, other category — proves the category half is still applied.
		expect(
			(
				await provider.search({ category: "social", tags: ["portrait"] })
			).entries.map((e) => e.id),
		).toEqual(["poster"]);
		// A combination that exists on neither axis together yields nothing.
		expect(
			(await provider.search({ category: "social", tags: ["networking"] }))
				.entries,
		).toEqual([]);
	});

	it("composes with free text and with pagination", async () => {
		const provider = createStaticTemplateProvider(catalog, { pageSize: 1 });
		expect(
			(
				await provider.search({ tags: ["portrait"], text: "flyer" })
			).entries.map((e) => e.id),
		).toEqual(["flyer"]);

		const first = await provider.search({ tags: ["portrait"] });
		expect(first.entries.map((e) => e.id)).toEqual(["poster"]);
		expect(first.nextCursor).toBe("1");
		const second = await provider.search({
			tags: ["portrait"],
			cursor: first.nextCursor ?? "",
		});
		expect(second.entries.map((e) => e.id)).toEqual(["flyer"]);
		expect(second.nextCursor).toBeUndefined();
	});

	it("free-text search still reaches tags that appear in no title or description", async () => {
		const provider = createStaticTemplateProvider(catalog);
		// "networking" is only ever a tag — never in a title or description.
		expect(
			(await provider.search({ text: "networking" })).entries.map((e) => e.id),
		).toEqual(["card"]);
	});
});

/**
 * cp3-006 compatibility criterion: `tags` is OPTIONAL on `CanvasTemplateEntry`,
 * so a host catalog that predates tags — or one deserialized from a remote
 * catalog that omits the field — must behave exactly as it did before. Note
 * `Reflect.deleteProperty`, not `tags: undefined`: the failure mode being
 * guarded is a spread of a genuinely ABSENT property, which is what a JSON
 * payload without the key produces.
 */
describe("createStaticTemplateProvider — untagged catalog compatibility (cp3-006)", () => {
	function untagged(id: string, title: string): CanvasTemplateEntry {
		const base = entry(id, { title });
		Reflect.deleteProperty(base, "tags");
		return base;
	}

	const catalog = [
		untagged("alpha", "Summer Sale"),
		untagged("beta", "Winter Report"),
	];

	it("lists every entry, unfiltered", async () => {
		const provider = createStaticTemplateProvider(catalog);
		const all = await provider.search({});
		expect(all.entries.map((e) => e.id)).toEqual(["alpha", "beta"]);
		expect(all.total).toBe(2);
	});

	it("free-text search over title still works and never throws", async () => {
		const provider = createStaticTemplateProvider(catalog);
		expect(
			(await provider.search({ text: "summer" })).entries.map((e) => e.id),
		).toEqual(["alpha"]);
		expect((await provider.search({ text: "nothing" })).entries).toEqual([]);
	});

	it("category, size, and pagination behave as they did before", async () => {
		const provider = createStaticTemplateProvider(catalog, { pageSize: 1 });
		expect(
			(await provider.search({ category: "social" })).entries.map((e) => e.id),
		).toEqual(["alpha"]);
		expect((await provider.search({ category: "print" })).entries).toEqual([]);
		expect(
			(await provider.search({ size: { width: 1080, height: 1080 } })).total,
		).toBe(2);
		const first = await provider.search({});
		expect(first.nextCursor).toBe("1");
	});

	it("a tag facet simply matches nothing, rather than erroring", async () => {
		const provider = createStaticTemplateProvider(catalog);
		expect((await provider.search({ tags: ["poster"] })).entries).toEqual([]);
	});

	it("a mixed catalog filters the tagged entries and skips the untagged ones", async () => {
		const provider = createStaticTemplateProvider([
			...catalog,
			entry("gamma", { title: "Tagged", tags: ["poster"] }),
		]);
		expect(
			(await provider.search({ tags: ["poster"] })).entries.map((e) => e.id),
		).toEqual(["gamma"]);
		expect((await provider.search({})).entries).toHaveLength(3);
	});
});

describe("normalizeTemplateTag", () => {
	it("lowercases and trims, and is idempotent", () => {
		expect(normalizeTemplateTag("  Business-Card ")).toBe("business-card");
		expect(normalizeTemplateTag(normalizeTemplateTag(" PRINT "))).toBe("print");
	});
});
