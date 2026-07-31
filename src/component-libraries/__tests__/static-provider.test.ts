import type { CanvasExternalComponentRef } from "@anvilkit/canvas-core";
import type { CanvasExternalComponentEnvelope } from "@anvilkit/canvas-core/component-libraries";
import { describe, expect, it } from "vitest";

import {
	type CanvasComponentProvider,
	type CanvasStaticComponentEntry,
	createStaticComponentProvider,
} from "../component-provider.js";

/**
 * T-018 — the static adapter must satisfy the same interface a hosted provider
 * does. These cases are written against `CanvasComponentProvider`, not against
 * the concrete factory, so they double as the contract a host implementation
 * has to pass.
 */

function ref(
	componentId: string,
	version = "1.0.0",
	libraryId = "acme",
): CanvasExternalComponentRef {
	return {
		kind: "library",
		libraryId,
		componentId,
		version,
		integrity: `sha256-${`${componentId}${version}`.padEnd(43, "x").slice(0, 43)}`,
	};
}

function entryOf(
	componentId: string,
	overrides: Partial<CanvasStaticComponentEntry["entry"]> = {},
	version = "1.0.0",
	libraryId = "acme",
): CanvasStaticComponentEntry {
	const self = ref(componentId, version, libraryId);
	const envelope = {
		ref: self,
		canonicalFormatVersion: 1,
		definition: {
			id: componentId,
			name: componentId,
			revision: 1,
			root: {
				id: `${componentId}-root`,
				type: "rect",
				transform: { x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1 },
				bounds: { width: 10, height: 10 },
				zIndex: 0,
			},
			properties: [],
		},
		dependencies: [],
	} as unknown as CanvasExternalComponentEnvelope;
	return {
		entry: { ref: self, name: componentId, ...overrides },
		envelope,
	};
}

const CONTEXT = () => ({ signal: new AbortController().signal });

const FIXTURES: CanvasStaticComponentEntry[] = [
	entryOf("button", {
		tags: ["form"],
		brandName: "Acme",
		category: "controls",
	}),
	entryOf("card", {
		tags: ["layout"],
		brandName: "Acme",
		category: "surfaces",
	}),
	entryOf("hero", { tags: ["layout"], brandName: "Globex" }, "2.1.0", "globex"),
	entryOf("button", {}, "2.0.0"),
];

const provider: CanvasComponentProvider =
	createStaticComponentProvider(FIXTURES);

describe("createStaticComponentProvider — search", () => {
	it("returns everything with an empty query", async () => {
		const result = await provider.search({}, CONTEXT());
		expect(result.entries).toHaveLength(4);
		expect(result.total).toBe(4);
		expect(result.nextCursor).toBeUndefined();
	});

	it.each([
		[{ text: "card" }, 1],
		[{ text: "layout" }, 2],
		[{ libraryId: "globex" }, 1],
		[{ brandName: "Acme" }, 2],
		[{ category: "controls" }, 1],
		[{ text: "nothing-matches" }, 0],
	])("filters by %j", async (query, expected) => {
		const result = await provider.search(query, CONTEXT());
		expect(result.entries).toHaveLength(expected);
	});

	it("matches text case-insensitively across name, brand and tags", async () => {
		expect(
			(await provider.search({ text: "GLOBEX" }, CONTEXT())).entries,
		).toHaveLength(1);
	});

	it("combines filters conjunctively", async () => {
		const result = await provider.search(
			{ brandName: "Acme", text: "layout" },
			CONTEXT(),
		);
		expect(result.entries).toHaveLength(1);
		expect(result.entries[0]?.name).toBe("card");
	});

	describe("offset-cursor pagination", () => {
		it("pages through every entry exactly once", async () => {
			const seen: string[] = [];
			let cursor: string | undefined;
			let guard = 0;
			do {
				const page = await provider.search(
					{ limit: 2, ...(cursor ? { cursor } : {}) },
					CONTEXT(),
				);
				seen.push(
					...page.entries.map((e) => `${e.ref.componentId}@${e.ref.version}`),
				);
				cursor = page.nextCursor;
				guard += 1;
			} while (cursor !== undefined && guard < 10);

			expect(guard).toBeLessThan(10);
			expect(seen).toHaveLength(4);
			expect(new Set(seen).size).toBe(4);
		});

		it("omits nextCursor on the final page", async () => {
			const last = await provider.search({ limit: 2, cursor: "2" }, CONTEXT());
			expect(last.entries).toHaveLength(2);
			expect(last.nextCursor).toBeUndefined();
		});

		it("treats a malformed cursor as the beginning rather than throwing", async () => {
			const result = await provider.search(
				{ cursor: "not-a-number" },
				CONTEXT(),
			);
			expect(result.entries).toHaveLength(4);
		});

		it("clamps a nonsensical limit instead of returning nothing", async () => {
			expect(
				(await provider.search({ limit: 0 }, CONTEXT())).entries,
			).toHaveLength(1);
		});
	});
});

describe("createStaticComponentProvider — getEnvelope", () => {
	it("returns the envelope for an exact ref", async () => {
		const envelope = await provider.getEnvelope(ref("button"), CONTEXT());
		expect(envelope?.ref.componentId).toBe("button");
		expect(envelope?.ref.version).toBe("1.0.0");
	});

	it("distinguishes two versions of one component", async () => {
		const v2 = await provider.getEnvelope(ref("button", "2.0.0"), CONTEXT());
		expect(v2?.ref.version).toBe("2.0.0");
	});

	it("returns null for an unknown ref — a catalog answer, not an error", async () => {
		await expect(
			provider.getEnvelope(ref("nope"), CONTEXT()),
		).resolves.toBeNull();
	});

	it("MISSES when only `integrity` differs", async () => {
		// The discriminating case. A lookup keyed on libraryId/componentId/version
		// alone would return substituted content, and admission would then reject
		// it with an integrity error that reads like a bug in the digest code.
		const substituted = {
			...ref("button"),
			integrity: `sha256-${"z".repeat(43)}`,
		};
		await expect(
			provider.getEnvelope(substituted, CONTEXT()),
		).resolves.toBeNull();
	});
});

describe("createStaticComponentProvider — cancellation (HCT)", () => {
	it("rejects an already-aborted search with an AbortError", async () => {
		const controller = new AbortController();
		controller.abort();
		await expect(
			provider.search({}, { signal: controller.signal }),
		).rejects.toMatchObject({ name: "AbortError" });
	});

	it("rejects an already-aborted getEnvelope", async () => {
		const controller = new AbortController();
		controller.abort();
		await expect(
			provider.getEnvelope(ref("button"), { signal: controller.signal }),
		).rejects.toMatchObject({ name: "AbortError" });
	});

	it("rejects an already-aborted listVersions", async () => {
		const controller = new AbortController();
		controller.abort();
		await expect(
			provider.listVersions?.(
				{ libraryId: "acme", componentId: "button" },
				{ signal: controller.signal },
			),
		).rejects.toMatchObject({ name: "AbortError" });
	});

	it("uses the `AbortError` NAME fetch uses, so host branches keep working", async () => {
		const controller = new AbortController();
		controller.abort();
		const error = await provider
			.search({}, { signal: controller.signal })
			.catch((e: unknown) => e as Error);
		expect(error.name).toBe("AbortError");
	});
});

describe("createStaticComponentProvider — listVersions", () => {
	it("returns every version of one component, and only that component", async () => {
		const result = await provider.listVersions?.(
			{ libraryId: "acme", componentId: "button" },
			CONTEXT(),
		);
		expect(result?.entries).toHaveLength(2);
		expect(result?.entries.every((e) => e.ref.componentId === "button")).toBe(
			true,
		);
	});

	it("does not cross library boundaries", async () => {
		const result = await provider.listVersions?.(
			{ libraryId: "acme", componentId: "hero" },
			CONTEXT(),
		);
		expect(result?.entries).toHaveLength(0);
	});
});

describe("no credentials leak through returned data", () => {
	it("returns only catalog fields — nothing the host used to authenticate", async () => {
		const result = await provider.search({}, CONTEXT());
		const serialized = JSON.stringify(result);
		for (const secret of [
			"authorization",
			"token",
			"cookie",
			"apiKey",
			"bearer",
		]) {
			expect(serialized.toLowerCase()).not.toContain(secret.toLowerCase());
		}
	});
});
