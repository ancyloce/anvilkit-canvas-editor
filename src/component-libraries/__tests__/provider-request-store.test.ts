import { describe, expect, it, vi } from "vitest";

import type {
	CanvasComponentCatalogEntry,
	CanvasComponentProvider,
	CanvasComponentSearchResult,
} from "../component-provider.js";
import {
	classifyProviderError,
	isAbortRejection,
	providerStatusMessageKey,
} from "../provider-errors.js";
import { createProviderRequestStore } from "../provider-request-store.js";

/**
 * T-019 — the request state machine.
 *
 * The headline case is "superseded request never applies", and it is written so
 * the stale response resolves **last**. A test where the stale one resolves
 * first would pass against an implementation with no guard at all.
 */

function entry(name: string): CanvasComponentCatalogEntry {
	return {
		ref: {
			kind: "library",
			libraryId: "acme",
			componentId: name,
			version: "1.0.0",
			integrity: `sha256-${name.padEnd(43, "x").slice(0, 43)}`,
		},
		name,
	};
}

/** A provider whose responses are resolved by the test, in the test's order. */
function deferredProvider() {
	const pending: {
		query: string;
		resolve: (r: CanvasComponentSearchResult) => void;
		reject: (e: unknown) => void;
		signal: AbortSignal;
	}[] = [];
	const provider: CanvasComponentProvider = {
		search(query, context) {
			return new Promise((resolve, reject) => {
				pending.push({
					query: query.text ?? "",
					resolve,
					reject,
					signal: context.signal,
				});
			});
		},
		getEnvelope: () => Promise.resolve(null),
	};
	return { provider, pending };
}

function immediateProvider(
	result: CanvasComponentSearchResult,
): CanvasComponentProvider {
	return {
		search: () => Promise.resolve(result),
		getEnvelope: () => Promise.resolve(null),
	};
}

function failingProvider(error: unknown): CanvasComponentProvider {
	return {
		search: () => Promise.reject(error),
		getEnvelope: () => Promise.resolve(null),
	};
}

describe("createProviderRequestStore — happy path", () => {
	it("starts idle", () => {
		expect(createProviderRequestStore().getState().status).toBe("idle");
	});

	it("goes loading then ready", async () => {
		const store = createProviderRequestStore();
		const { provider, pending } = deferredProvider();
		const run = store.getState().search(provider, { text: "b" });
		expect(store.getState().status).toBe("loading");

		pending[0]?.resolve({ entries: [entry("button")] });
		await run;
		expect(store.getState().status).toBe("ready");
		expect(store.getState().entries).toHaveLength(1);
	});

	it("reports EMPTY distinctly from ready", async () => {
		// A zero-result search is not a failure and not a populated list; the
		// panel needs its own presentation for it.
		const store = createProviderRequestStore();
		await store.getState().search(immediateProvider({ entries: [] }), {});
		expect(store.getState().status).toBe("empty");
	});

	it("carries the cursor and total through", async () => {
		const store = createProviderRequestStore();
		await store
			.getState()
			.search(
				immediateProvider({ entries: [entry("a")], nextCursor: "1", total: 9 }),
				{},
			);
		expect(store.getState().nextCursor).toBe("1");
		expect(store.getState().total).toBe(9);
	});
});

describe("cancellation and stale responses (AC-013)", () => {
	it("aborts the previous request when a new one starts", async () => {
		const store = createProviderRequestStore();
		const { provider, pending } = deferredProvider();

		void store.getState().search(provider, { text: "b" });
		const first = pending[0];
		expect(first?.signal.aborted).toBe(false);

		void store.getState().search(provider, { text: "but" });
		expect(first?.signal.aborted).toBe(true);
	});

	it("NEVER applies a superseded response, even when it resolves LAST", async () => {
		const store = createProviderRequestStore();
		const { provider, pending } = deferredProvider();

		const stale = store.getState().search(provider, { text: "b" });
		const fresh = store.getState().search(provider, { text: "button" });

		// Fresh resolves first...
		pending[1]?.resolve({ entries: [entry("button")] });
		await fresh;
		expect(store.getState().entries.map((e) => e.name)).toEqual(["button"]);

		// ...and the superseded one lands afterwards. A guard that only aborted,
		// or only compared arrival order, would repaint here.
		pending[0]?.resolve({ entries: [entry("stale-b")] });
		await stale;

		expect(store.getState().entries.map((e) => e.name)).toEqual(["button"]);
		expect(store.getState().status).toBe("ready");
	});

	it("does not surface a superseded FAILURE either", async () => {
		const store = createProviderRequestStore();
		const { provider, pending } = deferredProvider();

		const stale = store.getState().search(provider, { text: "b" });
		const fresh = store.getState().search(provider, { text: "button" });
		pending[1]?.resolve({ entries: [entry("button")] });
		await fresh;

		pending[0]?.reject(new Error("stale failure"));
		await stale;
		// The old request failing must not knock the current results off screen.
		expect(store.getState().status).toBe("ready");
		expect(store.getState().entries).toHaveLength(1);
	});

	it("treats an abort rejection as silence, not as an error state", async () => {
		const store = createProviderRequestStore();
		const abort = new Error("aborted");
		abort.name = "AbortError";
		await store.getState().search(failingProvider(abort), {});
		expect(store.getState().status).toBe("loading");
	});

	it("reset() aborts in flight work and returns to idle", async () => {
		const store = createProviderRequestStore();
		const { provider, pending } = deferredProvider();
		const run = store.getState().search(provider, { text: "b" });

		store.getState().reset();
		expect(pending[0]?.signal.aborted).toBe(true);
		expect(store.getState().status).toBe("idle");

		// A response arriving after reset must not resurrect the list.
		pending[0]?.resolve({ entries: [entry("late")] });
		await run;
		expect(store.getState().status).toBe("idle");
		expect(store.getState().entries).toEqual([]);
	});
});

describe("error mapping (§7.4) — every state has its own recovery", () => {
	it.each([
		[{ status: 401 }, "unauthorized"],
		[{ status: 403 }, "unauthorized"],
		[{ status: 429 }, "rate-limited"],
		[{ status: 408 }, "offline"],
		[{ status: 500 }, "offline"],
		[{ status: 503 }, "offline"],
		[{ status: 400 }, "error"],
		[{ status: 404 }, "error"],
	])("maps %j", async (error, expected) => {
		const store = createProviderRequestStore();
		await store.getState().search(failingProvider(error), {});
		expect(store.getState().status).toBe(expected);
	});

	it("maps a bare TypeError (fetch DNS/connection failure) to offline", () => {
		expect(classifyProviderError(new TypeError("Failed to fetch"))).toBe(
			"offline",
		);
	});

	it("maps a TimeoutError to offline", () => {
		const error = new Error("timed out");
		error.name = "TimeoutError";
		expect(classifyProviderError(error)).toBe("offline");
	});

	it("reads a status off `response.status` and `statusCode` too", () => {
		expect(classifyProviderError({ response: { status: 401 } })).toBe(
			"unauthorized",
		);
		expect(classifyProviderError({ statusCode: 429 })).toBe("rate-limited");
	});

	it("falls back to `error` for anything unrecognized", () => {
		for (const value of ["a string", 42, null, undefined, {}, new Error("x")]) {
			expect(classifyProviderError(value)).toBe("error");
		}
	});

	it("does NOT pattern-match message text", () => {
		// Classifying on wording would couple the state to a host's phrasing —
		// exactly the coupling this layer removes.
		expect(classifyProviderError(new Error("401 unauthorized"))).toBe("error");
	});

	it("gives every failure state a distinct i18n key", () => {
		const keys = (
			["offline", "unauthorized", "rate-limited", "error"] as const
		).map(providerStatusMessageKey);
		expect(new Set(keys).size).toBe(keys.length);
		expect(keys.every((k) => k.startsWith("canvas."))).toBe(true);
	});

	it("recognizes an abort by name", () => {
		const abort = new Error("x");
		abort.name = "AbortError";
		expect(isAbortRejection(abort)).toBe(true);
		expect(isAbortRejection(new Error("x"))).toBe(false);
	});
});

describe("no credential leaks into rendered state", () => {
	it("stores no part of the raw error", async () => {
		const store = createProviderRequestStore();
		await store.getState().search(
			failingProvider({
				status: 401,
				body: "Bearer sk-live-SECRET-TOKEN",
				headers: { authorization: "Bearer sk-live-SECRET-TOKEN" },
			}),
			{},
		);
		const serialized = JSON.stringify(store.getState());
		expect(serialized).not.toContain("SECRET");
		expect(serialized).not.toContain("Bearer");
		expect(store.getState().status).toBe("unauthorized");
	});

	it("clears stale results on failure so nothing misleading stays rendered", async () => {
		const store = createProviderRequestStore();
		await store
			.getState()
			.search(immediateProvider({ entries: [entry("a")] }), {});
		expect(store.getState().entries).toHaveLength(1);

		await store.getState().search(failingProvider({ status: 500 }), {});
		expect(store.getState().entries).toEqual([]);
	});
});

describe("pagination", () => {
	it("appends the next page rather than replacing", async () => {
		const store = createProviderRequestStore();
		const search = vi
			.fn<CanvasComponentProvider["search"]>()
			.mockResolvedValueOnce({ entries: [entry("a")], nextCursor: "1" })
			.mockResolvedValueOnce({ entries: [entry("b")] });
		const provider = {
			search,
			getEnvelope: () => Promise.resolve(null),
		} as CanvasComponentProvider;

		await store.getState().search(provider, { text: "x" });
		await store.getState().loadMore(provider);

		expect(store.getState().entries.map((e) => e.name)).toEqual(["a", "b"]);
		expect(store.getState().nextCursor).toBeUndefined();
		// The cursor must ride on the SAME query, or page 2 is of a different search.
		expect(search.mock.calls[1]?.[0]).toMatchObject({ text: "x", cursor: "1" });
	});

	it("is a no-op without a cursor", async () => {
		const store = createProviderRequestStore();
		const provider = immediateProvider({ entries: [entry("a")] });
		await store.getState().search(provider, {});
		const before = store.getState().entries;
		await store.getState().loadMore(provider);
		expect(store.getState().entries).toBe(before);
	});

	it("keeps existing results on a failed page", async () => {
		const store = createProviderRequestStore();
		const search = vi
			.fn<CanvasComponentProvider["search"]>()
			.mockResolvedValueOnce({ entries: [entry("a")], nextCursor: "1" })
			.mockRejectedValueOnce({ status: 500 });
		const provider = {
			search,
			getEnvelope: () => Promise.resolve(null),
		} as CanvasComponentProvider;

		await store.getState().search(provider, {});
		await store.getState().loadMore(provider);

		expect(store.getState().status).toBe("offline");
		// Dropping the list would punish the user for scrolling.
		expect(store.getState().entries).toHaveLength(1);
		expect(store.getState().loadingMore).toBe(false);
	});
});
