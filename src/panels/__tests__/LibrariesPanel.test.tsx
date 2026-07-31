import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import * as React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type {
	CanvasComponentCatalogEntry,
	CanvasComponentProvider,
	CanvasComponentSearchResult,
} from "../../component-libraries/component-provider.js";
import { LibrariesPanel } from "../LibrariesPanel.js";

/**
 * T-020 — the Libraries source.
 *
 * `vitest.config` sets `globals: false`, so RTL auto-cleanup is OFF and every
 * multi-render file must clean up explicitly (see the repo's react-library
 * preset note).
 */
afterEach(cleanup);

function entry(
	name: string,
	overrides: Partial<CanvasComponentCatalogEntry> = {},
): CanvasComponentCatalogEntry {
	return {
		ref: {
			kind: "library",
			libraryId: "acme",
			componentId: name,
			version: "1.4.2",
			integrity: `sha256-${name.padEnd(43, "x").slice(0, 43)}`,
		},
		name,
		...overrides,
	};
}

function providerOf(
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

function mount(provider: CanvasComponentProvider, props = {}) {
	return render(
		<LibrariesPanel
			provider={provider}
			onInsert={() => undefined}
			{...props}
		/>,
	);
}

describe("LibrariesPanel — results", () => {
	it("renders a row per catalog entry", async () => {
		mount(providerOf({ entries: [entry("button"), entry("card")] }));
		await waitFor(() =>
			expect(screen.getByTestId("libraries-results")).toBeTruthy(),
		);
		expect(screen.getByTestId("library-row-button")).toBeTruthy();
		expect(screen.getByTestId("library-row-card")).toBeTruthy();
	});

	it("shows the version verbatim", async () => {
		// Canvas treats `version` as opaque; anything that prettified it here
		// would show a string that no longer matches what is stored.
		mount(providerOf({ entries: [entry("button")] }));
		await waitFor(() =>
			expect(screen.getByTestId("library-version")).toBeTruthy(),
		);
		expect(screen.getByTestId("library-version").textContent).toBe("1.4.2");
	});

	it("marks a deprecated version without hiding it", async () => {
		mount(
			providerOf({
				entries: [entry("old", { deprecationNotice: "Use v2 instead" })],
			}),
		);
		await waitFor(() =>
			expect(screen.getByTestId("library-deprecated")).toBeTruthy(),
		);
		expect(screen.getByTestId("library-version").textContent).toBe("1.4.2");
	});

	it("calls onInsert with the entry when a row is activated", async () => {
		const onInsert = vi.fn();
		render(
			<LibrariesPanel
				provider={providerOf({ entries: [entry("button")] })}
				onInsert={onInsert}
			/>,
		);
		await waitFor(() =>
			expect(screen.getByTestId("library-row-button")).toBeTruthy(),
		);
		await userEvent.click(screen.getByTestId("library-row-button"));
		expect(onInsert).toHaveBeenCalledTimes(1);
		expect(onInsert.mock.calls[0]?.[0]?.ref.componentId).toBe("button");
	});

	it("does not insert while disabled", async () => {
		const onInsert = vi.fn();
		render(
			<LibrariesPanel
				provider={providerOf({ entries: [entry("button")] })}
				onInsert={onInsert}
				insertDisabled
			/>,
		);
		await waitFor(() =>
			expect(screen.getByTestId("library-row-button")).toBeTruthy(),
		);
		await userEvent.click(screen.getByTestId("library-row-button"));
		expect(onInsert).not.toHaveBeenCalled();
	});
});

describe("LibrariesPanel — untrusted URLs never reach the DOM", () => {
	it.each([
		"javascript:alert(1)",
		"data:text/html,<script>x</script>",
	])("drops a %s thumbnail", async (thumbnailUrl) => {
		mount(providerOf({ entries: [entry("evil", { thumbnailUrl })] }));
		await waitFor(() =>
			expect(screen.getByTestId("library-row-evil")).toBeTruthy(),
		);
		// Rendered as the placeholder, with no <img> carrying the hostile URL.
		expect(screen.getByTestId("library-thumbnail-placeholder")).toBeTruthy();
		expect(screen.queryByTestId("library-thumbnail")).toBeNull();
	});

	it("keeps an https thumbnail", async () => {
		mount(
			providerOf({
				entries: [entry("ok", { thumbnailUrl: "https://cdn.example/x.png" })],
			}),
		);
		await waitFor(() =>
			expect(screen.getByTestId("library-thumbnail")).toBeTruthy(),
		);
	});
});

describe("LibrariesPanel — every provider state is distinct and recoverable", () => {
	it("renders EMPTY separately from a populated list", async () => {
		mount(providerOf({ entries: [] }));
		await waitFor(() =>
			expect(screen.getByTestId("libraries-empty")).toBeTruthy(),
		);
	});

	it("names the search term in the empty state", async () => {
		mount(providerOf({ entries: [] }), { search: "widget" });
		await waitFor(() =>
			expect(screen.getByTestId("libraries-empty")).toBeTruthy(),
		);
		expect(screen.getByTestId("libraries-empty").textContent).toContain(
			"widget",
		);
	});

	it.each([
		[{ status: 401 }, "libraries-unauthorized"],
		[{ status: 429 }, "libraries-rate-limited"],
		[{ status: 503 }, "libraries-offline"],
		[{ status: 400 }, "libraries-error"],
	])("renders %j as its own state with a retry", async (error, testId) => {
		mount(failingProvider(error));
		await waitFor(() => expect(screen.getByTestId(testId)).toBeTruthy());
		expect(screen.getByTestId("libraries-retry")).toBeTruthy();
	});

	it("recovers when retry succeeds", async () => {
		let fail = true;
		const provider: CanvasComponentProvider = {
			search: () =>
				fail
					? Promise.reject({ status: 503 })
					: Promise.resolve({ entries: [entry("button")] }),
			getEnvelope: () => Promise.resolve(null),
		};
		mount(provider);
		await waitFor(() =>
			expect(screen.getByTestId("libraries-offline")).toBeTruthy(),
		);

		fail = false;
		await userEvent.click(screen.getByTestId("libraries-retry"));
		await waitFor(() =>
			expect(screen.getByTestId("library-row-button")).toBeTruthy(),
		);
	});

	it("announces state changes politely to assistive tech", async () => {
		mount(providerOf({ entries: [] }));
		await waitFor(() =>
			expect(screen.getByTestId("libraries-empty")).toBeTruthy(),
		);
		const region = screen.getByTestId("libraries-empty");
		expect(region.getAttribute("role")).toBe("status");
		expect(region.getAttribute("aria-live")).toBe("polite");
	});
});

describe("LibrariesPanel — pagination", () => {
	it("offers Load more only when the provider reported a cursor", async () => {
		mount(providerOf({ entries: [entry("a")] }));
		await waitFor(() =>
			expect(screen.getByTestId("libraries-results")).toBeTruthy(),
		);
		expect(screen.queryByTestId("libraries-load-more")).toBeNull();

		cleanup();
		mount(providerOf({ entries: [entry("a")], nextCursor: "1" }));
		await waitFor(() =>
			expect(screen.getByTestId("libraries-load-more")).toBeTruthy(),
		);
	});

	it("appends the next page to the visible list", async () => {
		const search = vi
			.fn<CanvasComponentProvider["search"]>()
			.mockResolvedValueOnce({ entries: [entry("a")], nextCursor: "1" })
			.mockResolvedValueOnce({ entries: [entry("b")] });
		mount({ search, getEnvelope: () => Promise.resolve(null) });

		await waitFor(() =>
			expect(screen.getByTestId("libraries-load-more")).toBeTruthy(),
		);
		await userEvent.click(screen.getByTestId("libraries-load-more"));
		await waitFor(() =>
			expect(screen.getByTestId("library-row-b")).toBeTruthy(),
		);
		expect(screen.getByTestId("library-row-a")).toBeTruthy();
	});
});

describe("LibrariesPanel — accessibility", () => {
	it("exposes the results as a labelled list", async () => {
		mount(providerOf({ entries: [entry("button")] }));
		await waitFor(() =>
			expect(screen.getByTestId("libraries-results")).toBeTruthy(),
		);
		const list = screen.getByTestId("libraries-results");
		expect(list.getAttribute("role")).toBe("list");
		expect(list.getAttribute("aria-label")).toBeTruthy();
	});

	it("gives each row an accessible name carrying name AND version", async () => {
		// The visual row conveys ownership through layout; a screen-reader user
		// would otherwise hear only "button".
		mount(providerOf({ entries: [entry("button")] }));
		await waitFor(() =>
			expect(screen.getByTestId("library-row-button")).toBeTruthy(),
		);
		const label = screen
			.getByTestId("library-row-button")
			.getAttribute("aria-label");
		expect(label).toContain("button");
		expect(label).toContain("1.4.2");
	});
});
