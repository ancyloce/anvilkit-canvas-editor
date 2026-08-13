/**
 * @file `cp3-003` — the Elements panel as a content browser.
 *
 * Every test here drives an EXPLICIT provider, so nothing in this file can
 * reach the 425-entry default catalog. The assertion that the default catalog
 * stays behind its dynamic `import()` lives in
 * `ElementsPanel.lazy-catalog.test.tsx`, which needs a module mock and would
 * leak into these tests if it shared a file.
 */

import { createRect } from "@anvilkit/canvas-core";
import {
	cleanup,
	fireEvent,
	render,
	screen,
	waitFor,
	within,
} from "@testing-library/react";
import * as React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CanvasStudioContext } from "@/context/canvas-studio-context.js";
import type { CanvasElementEntry } from "@/elements/element-entry.js";
import {
	type CanvasElementProvider,
	createStaticElementProvider,
} from "@/elements/element-provider.js";
import {
	ElementsPanel,
	type ElementsPanelProps,
} from "@/panels/ElementsPanel.js";
import { makeHarness } from "@/tools/__tests__/_tool-test-helpers.js";

// react-library vitest preset has globals:false — RTL auto-cleanup is OFF.
afterEach(cleanup);

function entry(
	over: Partial<CanvasElementEntry> & { readonly id: string },
): CanvasElementEntry {
	return {
		name: over.id,
		category: "shape",
		tags: [],
		preview: { kind: "path", d: "M0 0H24V24H0Z", viewBox: "0 0 24 24" },
		defaultSize: { width: 100, height: 100 },
		license: "MIT",
		recolor: "fill",
		build: () => createRect({ id: "n", bounds: { width: 10, height: 10 } }),
		...over,
	};
}

/** One entry per category, plus the two preview variants and a keyword-only hit. */
const CATALOG: readonly CanvasElementEntry[] = [
	entry({
		id: "square",
		name: "Square",
		category: "shape",
		tags: ["basic"],
		keywords: ["quad", "box"],
	}),
	entry({
		id: "arrow-right",
		name: "Arrow right",
		category: "icon",
		tags: ["navigation"],
		keywords: ["chevron"],
		recolor: "stroke",
		preview: { kind: "path", d: "M4 12h16", viewBox: "0 0 24 24" },
	}),
	entry({
		id: "rule-plain",
		name: "Horizontal rule",
		category: "line",
		tags: ["divider"],
		recolor: "stroke",
		preview: { kind: "path", d: "M0 24L240 24", viewBox: "0 0 240 48" },
		defaultSize: { width: 240, height: 48 },
	}),
	entry({
		id: "photo-frame",
		name: "Photo frame",
		category: "frame",
		tags: ["photo"],
	}),
	entry({
		id: "star-sticker",
		name: "Star sticker",
		category: "sticker",
		tags: ["fun"],
		recolor: "multi",
	}),
	entry({
		id: "logo-badge",
		name: "Logo badge",
		category: "sticker",
		tags: ["brand"],
		preview: { kind: "image", src: "data:image/png;base64,AAAA" },
		defaultSize: { width: 200, height: 100 },
	}),
];

function renderPanel(
	provider: CanvasElementProvider,
	props: Omit<ElementsPanelProps, "elementProvider"> = {},
): ReturnType<typeof render> {
	const harness = makeHarness();
	return render(
		<CanvasStudioContext.Provider value={harness.studioCtx}>
			<ElementsPanel elementProvider={provider} {...props} />
		</CanvasStudioContext.Provider>,
	);
}

function grid(): HTMLElement {
	return screen.getByTestId("elements-grid");
}

function options(): HTMLElement[] {
	return within(grid()).getAllByRole("option");
}

describe("ElementsPanel — content browser (cp3-003)", () => {
	it("renders a toggle button per category plus All, from CANVAS_ELEMENT_CATEGORIES", async () => {
		renderPanel(createStaticElementProvider(CATALOG));
		await screen.findByTestId("elements-grid");

		// A `group` of toggle buttons, NOT a `tablist`: nothing here controls a
		// `tabpanel`, and the buttons are each individually tabbable rather than
		// sharing one tab stop, so the tab roles promised behaviour the markup
		// does not have. `aria-pressed` is the state a toggle button carries.
		const strip = screen.getByTestId("elements-categories");
		expect(strip).toHaveAttribute("role", "group");
		const filters = within(strip).getAllByRole("button");
		expect(filters.map((f) => f.getAttribute("data-testid"))).toEqual([
			"elements-category-all",
			"elements-category-shape",
			"elements-category-icon",
			"elements-category-line",
			"elements-category-frame",
			"elements-category-sticker",
		]);
		expect(screen.getByTestId("elements-category-all")).toHaveAttribute(
			"aria-pressed",
			"true",
		);
	});

	it("shows skeletons while the first page is in flight, then the grid", async () => {
		let release: ((value: CanvasElementProvider) => void) | undefined;
		const gate = new Promise<CanvasElementProvider>((resolve) => {
			release = resolve;
		});
		const provider: CanvasElementProvider = {
			search: (query) => gate.then((p) => p.search(query)),
			getById: (id) => gate.then((p) => p.getById(id)),
		};

		renderPanel(provider);
		expect(screen.getByTestId("elements-loading")).toBeTruthy();
		expect(screen.getByTestId("elements-skeleton-0")).toBeTruthy();
		expect(screen.queryByTestId("elements-grid")).toBeNull();

		release?.(createStaticElementProvider(CATALOG));
		await screen.findByTestId("elements-grid");
		expect(screen.queryByTestId("elements-loading")).toBeNull();
	});

	it("searches by NAME", async () => {
		renderPanel(createStaticElementProvider(CATALOG), { search: "Photo" });
		await screen.findByTestId("elements-item-photo-frame");
		expect(options()).toHaveLength(1);
	});

	it("searches by TAG", async () => {
		renderPanel(createStaticElementProvider(CATALOG), { search: "navigation" });
		await screen.findByTestId("elements-item-arrow-right");
		expect(options()).toHaveLength(1);
	});

	it("searches by KEYWORD — a synonym that is in neither the name nor the tags", async () => {
		renderPanel(createStaticElementProvider(CATALOG), { search: "quad" });
		await screen.findByTestId("elements-item-square");
		expect(options()).toHaveLength(1);
		// The word really is absent from every other field, so this can only
		// have matched `keywords`.
		expect(CATALOG[0]?.name.toLowerCase()).not.toContain("quad");
		expect(CATALOG[0]?.tags.join(" ")).not.toContain("quad");
	});

	it("re-queries when the search prop changes (debounced)", async () => {
		const provider = createStaticElementProvider(CATALOG);
		const search = vi.spyOn(provider, "search");
		const harness = makeHarness();
		const view = render(
			<CanvasStudioContext.Provider value={harness.studioCtx}>
				<ElementsPanel elementProvider={provider} />
			</CanvasStudioContext.Provider>,
		);
		await screen.findByTestId("elements-grid");
		expect(options()).toHaveLength(CATALOG.length);

		view.rerender(
			<CanvasStudioContext.Provider value={harness.studioCtx}>
				<ElementsPanel elementProvider={provider} search="chevron" />
			</CanvasStudioContext.Provider>,
		);
		await waitFor(() => expect(options()).toHaveLength(1));
		expect(screen.getByTestId("elements-item-arrow-right")).toBeTruthy();
		expect(search).toHaveBeenCalledWith({ text: "chevron" });
	});

	it("filters by category tab, and combines the facet with the text query", async () => {
		const provider = createStaticElementProvider(CATALOG);
		const search = vi.spyOn(provider, "search");
		renderPanel(provider);
		await screen.findByTestId("elements-grid");

		fireEvent.click(screen.getByTestId("elements-category-sticker"));
		await waitFor(() => expect(options()).toHaveLength(2));
		expect(
			options().map((option) => option.getAttribute("data-category")),
		).toEqual(["sticker", "sticker"]);
		expect(screen.getByTestId("elements-category-sticker")).toHaveAttribute(
			"aria-pressed",
			"true",
		);
		expect(search).toHaveBeenLastCalledWith({ category: "sticker" });
	});

	it("renders the empty state when nothing matches", async () => {
		renderPanel(createStaticElementProvider(CATALOG), {
			search: "no-such-element",
		});
		await screen.findByTestId("elements-panel-no-results");
		expect(screen.queryByTestId("elements-grid")).toBeNull();
	});

	it("renders the error state and Retry re-runs the query", async () => {
		let attempts = 0;
		const provider: CanvasElementProvider = {
			search: (query) => {
				attempts += 1;
				return attempts === 1
					? Promise.reject(new Error("chunk fetch failed"))
					: createStaticElementProvider(CATALOG).search(query);
			},
			getById: () => Promise.resolve(null),
		};

		renderPanel(provider);
		await screen.findByTestId("elements-panel-error");
		expect(screen.queryByTestId("elements-grid")).toBeNull();

		fireEvent.click(screen.getByTestId("elements-retry"));
		await screen.findByTestId("elements-grid");
		expect(attempts).toBe(2);
	});

	it("paginates through the provider cursor with Load more", async () => {
		const many = Array.from({ length: 7 }, (_, i) =>
			entry({ id: `e${i}`, name: `Element ${i}` }),
		);
		renderPanel(createStaticElementProvider(many, { pageSize: 4 }));
		await screen.findByTestId("elements-grid");
		expect(options()).toHaveLength(4);

		fireEvent.click(screen.getByTestId("elements-load-more"));
		await waitFor(() => expect(options()).toHaveLength(7));
		// The last page has no cursor, so the affordance goes away rather than
		// re-fetching the same tail.
		expect(screen.queryByTestId("elements-load-more")).toBeNull();
	});

	it("calls onSelect with the entry when a cell is activated", async () => {
		const onSelect = vi.fn();
		renderPanel(createStaticElementProvider(CATALOG), { onSelect });
		await screen.findByTestId("elements-grid");

		fireEvent.click(screen.getByTestId("elements-item-square"));
		expect(onSelect).toHaveBeenCalledTimes(1);
		expect(onSelect.mock.calls[0]?.[0]).toMatchObject({ id: "square" });
	});
});

describe("ElementsPanel — preview painting (the 181-blob branch)", () => {
	it("paints a recolor:'stroke' entry as an OUTLINE, never a filled blob", async () => {
		renderPanel(createStaticElementProvider(CATALOG));
		const preview = await screen.findByTestId("elements-preview-arrow-right");

		const path = preview.querySelector("path");
		expect(path).not.toBeNull();
		// The whole point: a stroke entry rendered `fill="currentColor"` is a
		// black blob. 181 of the 425 default entries are stroke entries.
		expect(path?.getAttribute("fill")).toBe("none");
		expect(path?.getAttribute("stroke")).toBe("currentColor");
		expect(path?.getAttribute("stroke-linecap")).toBe("round");
		expect(path?.getAttribute("stroke-linejoin")).toBe("round");
	});

	it("derives the preview stroke width from the viewBox at 6.25%", async () => {
		renderPanel(createStaticElementProvider(CATALOG));
		// 24-unit box → 1.5, which is exactly how the outline icon sets are
		// authored. The contract carries no stroke width, so this ratio IS the
		// convention (see PREVIEW_STROKE_RATIO).
		const icon = await screen.findByTestId("elements-preview-arrow-right");
		expect(icon.querySelector("path")?.getAttribute("stroke-width")).toBe(
			"1.5",
		);
		// 240-unit box → 15. Scales with the box rather than being a constant.
		const rule = screen.getByTestId("elements-preview-rule-plain");
		expect(rule.querySelector("path")?.getAttribute("stroke-width")).toBe("15");
	});

	it("paints fill and multi entries as filled paths with no stroke", async () => {
		renderPanel(createStaticElementProvider(CATALOG));
		await screen.findByTestId("elements-grid");

		for (const id of ["square", "photo-frame", "star-sticker"]) {
			const path = screen
				.getByTestId(`elements-preview-${id}`)
				.querySelector("path");
			expect(path?.getAttribute("fill"), id).toBe("currentColor");
			expect(path?.getAttribute("stroke"), id).toBeNull();
		}
	});

	it("renders an <img> for an image preview and an <svg> for a path preview", async () => {
		renderPanel(createStaticElementProvider(CATALOG));
		await screen.findByTestId("elements-grid");

		expect(
			screen.getByTestId("elements-preview-logo-badge").tagName.toLowerCase(),
		).toBe("img");
		expect(
			screen.getByTestId("elements-preview-square").tagName.toLowerCase(),
		).toBe("svg");
	});
});

describe("ElementsPanel — keyboard grid (a11y)", () => {
	const seven = Array.from({ length: 7 }, (_, i) =>
		entry({ id: `k${i}`, name: `Cell ${i}` }),
	);

	async function renderGrid(): Promise<HTMLElement[]> {
		renderPanel(createStaticElementProvider(seven));
		await screen.findByTestId("elements-grid");
		return options();
	}

	it("exposes one listbox with a label and one labelled option per entry", async () => {
		const cells = await renderGrid();
		expect(grid()).toHaveAttribute("aria-label", "Elements");
		expect(cells).toHaveLength(7);
		expect(cells[3]).toHaveAttribute("aria-label", "Cell 3");
	});

	it("uses a roving tabindex — exactly one option is tabbable", async () => {
		const cells = await renderGrid();
		expect(
			cells.filter((c) => c.getAttribute("tabindex") === "0"),
		).toHaveLength(1);
		expect(cells[0]).toHaveAttribute("tabindex", "0");
		expect(cells[1]).toHaveAttribute("tabindex", "-1");
	});

	it("ArrowRight/ArrowLeft move by one cell and clamp at the ends", async () => {
		const cells = await renderGrid();
		cells[0]?.focus();

		fireEvent.keyDown(grid(), { key: "ArrowRight" });
		expect(document.activeElement).toBe(options()[1]);

		fireEvent.keyDown(grid(), { key: "ArrowLeft" });
		expect(document.activeElement).toBe(options()[0]);

		// Already at index 0 — clamped, not wrapped, so focus never escapes.
		fireEvent.keyDown(grid(), { key: "ArrowLeft" });
		expect(document.activeElement).toBe(options()[0]);
	});

	it("ArrowDown/ArrowUp move by a row of three", async () => {
		const cells = await renderGrid();
		cells[0]?.focus();

		fireEvent.keyDown(grid(), { key: "ArrowDown" });
		expect(document.activeElement).toBe(options()[3]);

		fireEvent.keyDown(grid(), { key: "ArrowDown" });
		expect(document.activeElement).toBe(options()[6]);

		// 6 + 3 = 9 is past the end of a 7-cell grid: clamp to the last cell
		// rather than dropping focus on nothing.
		fireEvent.keyDown(grid(), { key: "ArrowDown" });
		expect(document.activeElement).toBe(options()[6]);

		fireEvent.keyDown(grid(), { key: "ArrowUp" });
		expect(document.activeElement).toBe(options()[3]);
	});

	it("Home and End jump to the first and last cell", async () => {
		const cells = await renderGrid();
		cells[0]?.focus();

		fireEvent.keyDown(grid(), { key: "End" });
		expect(document.activeElement).toBe(options()[6]);
		expect(options()[6]).toHaveAttribute("tabindex", "0");
		expect(options()[0]).toHaveAttribute("tabindex", "-1");

		fireEvent.keyDown(grid(), { key: "Home" });
		expect(document.activeElement).toBe(options()[0]);
	});

	it("keeps the roving tabindex in range when the result set shrinks", async () => {
		const provider = createStaticElementProvider([
			...seven,
			entry({ id: "needle", name: "Needle", keywords: ["findme"] }),
		]);
		const harness = makeHarness();
		const view = render(
			<CanvasStudioContext.Provider value={harness.studioCtx}>
				<ElementsPanel elementProvider={provider} />
			</CanvasStudioContext.Provider>,
		);
		await screen.findByTestId("elements-grid");
		fireEvent.keyDown(grid(), { key: "End" });
		expect(options()[7]).toHaveAttribute("tabindex", "0");

		view.rerender(
			<CanvasStudioContext.Provider value={harness.studioCtx}>
				<ElementsPanel elementProvider={provider} search="findme" />
			</CanvasStudioContext.Provider>,
		);
		await waitFor(() => expect(options()).toHaveLength(1));
		// Index 7 no longer exists. A stale roving index would leave the listbox
		// with zero tabbable options — unreachable by keyboard entirely.
		expect(options()[0]).toHaveAttribute("tabindex", "0");
	});

	it("activation is a real button, so Enter and Space work with no key handler", async () => {
		const onSelect = vi.fn();
		renderPanel(createStaticElementProvider(seven), { onSelect });
		await screen.findByTestId("elements-grid");
		const cell = screen.getByTestId("elements-item-k2");
		expect(cell.tagName.toLowerCase()).toBe("button");
		expect(cell.getAttribute("type")).toBe("button");
		fireEvent.click(cell);
		expect(onSelect).toHaveBeenCalledTimes(1);
	});
});

describe("ElementsPanel — the drawing tools are GONE (cp3-009)", () => {
	/**
	 * `cp3-003` left a deprecated `LegacyToolSection` in this panel and pinned it
	 * with two tests, deliberately, so that deleting the grid without also
	 * swapping the nine E2E specs' selectors would go red. `cp3-009` did both in
	 * one change, so those two tests are gone with the code they pinned — and
	 * these replace them, asserting the ABSENCE rather than nothing at all. The
	 * positive half ("all 14 tools activate from the rail") lives in
	 * `workspace/toolstrip/__tests__/ToolStrip.test.tsx`.
	 */
	it("renders no elements-tool-<id> button for any built-in tool", async () => {
		const harness = makeHarness();
		render(
			<CanvasStudioContext.Provider value={harness.studioCtx}>
				<ElementsPanel elementProvider={createStaticElementProvider(CATALOG)} />
			</CanvasStudioContext.Provider>,
		);
		await screen.findByTestId("elements-grid");

		for (const id of ["select", "rect", "ellipse", "text", "hand", "image"]) {
			expect(screen.queryByTestId(`elements-tool-${id}`)).toBeNull();
		}
		// The whole section, its heading and its empty state went with the grid.
		expect(screen.queryByTestId("elements-tools")).toBeNull();
		expect(screen.queryByTestId("elements-panel-empty")).toBeNull();
		expect(document.querySelector("[data-deprecated]")).toBeNull();
	});

	it("never touches the tool store — activating an element does not change the active tool", async () => {
		const harness = makeHarness();
		const before = harness.studioCtx.toolStore.getState().activeTool;
		const setActiveTool = vi.spyOn(
			harness.studioCtx.toolStore.getState(),
			"setActiveTool",
		);
		render(
			<CanvasStudioContext.Provider value={harness.studioCtx}>
				<ElementsPanel
					elementProvider={createStaticElementProvider(CATALOG)}
					onSelect={() => undefined}
				/>
			</CanvasStudioContext.Provider>,
		);
		await screen.findByTestId("elements-grid");
		fireEvent.click(screen.getByTestId("elements-item-square"));

		expect(setActiveTool).not.toHaveBeenCalled();
		expect(harness.studioCtx.toolStore.getState().activeTool).toBe(before);
	});

	it("the tool registry no longer reaches this panel at all", async () => {
		// A registry carrying an extension tool used to add a cell to the grid.
		// Now it changes nothing: the option count is exactly the catalog's.
		const harness = makeHarness();
		harness.studioCtx.toolRegistry = {
			"my-ext-tool": {
				id: "my-ext-tool",
				cursor: "crosshair",
				label: "My extension tool",
			},
		};
		render(
			<CanvasStudioContext.Provider value={harness.studioCtx}>
				<ElementsPanel elementProvider={createStaticElementProvider(CATALOG)} />
			</CanvasStudioContext.Provider>,
		);
		await screen.findByTestId("elements-grid");
		expect(options()).toHaveLength(CATALOG.length);
		expect(screen.queryByTestId("elements-tool-my-ext-tool")).toBeNull();
	});
});

/**
 * A host-supplied `preview.src` is untrusted input: `elementProvider` is an open
 * extension point, so the URI comes from whatever backend serves the catalog.
 * It goes through core's ONE allowlist (`normalizeUri`) like every other URI
 * ingress in this package, rather than straight into an `<img src>`.
 */
describe("ElementsPanel — thumbnail URI safety", () => {
	const withSrc = (id: string, src: string): CanvasElementEntry =>
		entry({ id, name: id, preview: { kind: "image", src } });

	it("renders http(s), data: image and blob: thumbnails", async () => {
		renderPanel(
			createStaticElementProvider([
				withSrc("remote", "https://cdn.example/icon.png"),
				withSrc("inline", "data:image/png;base64,iVBORw0KGgo="),
				withSrc("local", "blob:https://app.example/9f2c-4c1a"),
			]),
		);
		await screen.findByTestId("elements-grid");

		for (const id of ["remote", "inline", "local"]) {
			const preview = screen.getByTestId(`elements-preview-${id}`);
			expect(preview.tagName.toLowerCase(), id).toBe("img");
			expect(preview.getAttribute("src"), id).toBeTruthy();
		}
	});

	it("renders an empty well instead of requesting a blocked scheme", async () => {
		renderPanel(
			createStaticElementProvider([
				withSrc("js", "javascript:alert(1)"),
				withSrc("file", "file:///etc/passwd"),
				// A `data:` payload that is not an image the allowlist knows.
				withSrc("svgdata", "data:image/svg+xml,<svg onload='alert(1)'/>"),
			]),
		);
		await screen.findByTestId("elements-grid");

		for (const id of ["js", "file", "svgdata"]) {
			const preview = screen.getByTestId(`elements-preview-${id}`);
			// Not an <img> at all: nothing is requested, and no src attribute
			// carrying the hostile URI reaches the DOM.
			expect(preview.tagName.toLowerCase(), id).not.toBe("img");
			expect(preview.getAttribute("data-preview-blocked"), id).toBe("true");
			expect(preview.getAttribute("src"), id).toBeNull();
		}
		// The cells themselves are untouched — a bad thumbnail is not a bad entry.
		expect(options()).toHaveLength(3);
	});
});

describe("ElementsPanel — preview aspect ratio from the viewBox", () => {
	const withViewBox = (id: string, viewBox: string): CanvasElementEntry =>
		entry({
			id,
			name: id,
			preview: { kind: "path", d: "M0 0H24V24H0Z", viewBox },
			defaultSize: { width: 100, height: 100 },
		});

	function ratioOf(id: string): string | null {
		return screen
			.getByTestId(`elements-preview-${id}`)
			.getAttribute("style");
	}

	it("reads width/height by POSITION, not from a filtered list", async () => {
		// A leading space is legal SVG. Splitting yields a leading "" whose
		// `Number("")` is a perfectly finite 0, so a "drop the non-numbers" filter
		// left five entries and shifted every index left — index 2 read the
		// y-origin and index 3 read the width, turning this 2:1 box into 1:2.
		renderPanel(
			createStaticElementProvider([
				withViewBox("padded", " 0 0 48 24"),
				withViewBox("plain", "0 0 48 24"),
			]),
		);
		await screen.findByTestId("elements-grid");

		expect(ratioOf("padded")).toContain("aspect-ratio: 2");
		expect(ratioOf("padded")).toBe(ratioOf("plain"));
	});

	it("falls back to the 24x24 default when a token is not a number", async () => {
		renderPanel(
			createStaticElementProvider([
				withViewBox("junk", "0 0 wide 24"),
				withViewBox("short", "0 0 48"),
			]),
		);
		await screen.findByTestId("elements-grid");

		// Square, from the documented 24x24 fallback — never a half-parsed box.
		expect(ratioOf("junk")).toContain("aspect-ratio: 1");
		expect(ratioOf("short")).toContain("aspect-ratio: 1");
	});
});

describe("ElementsPanel — a new query replaces the old results", () => {
	it("clears stale entries and resets the roving tabindex on a category change", async () => {
		const provider = createStaticElementProvider(CATALOG);
		renderPanel(provider);
		await screen.findByTestId("elements-grid");

		// Focus a cell that is NOT the first, so a surviving `activeIndex` is
		// visible in the next result set.
		const before = options();
		expect(before.length).toBeGreaterThan(2);
		fireEvent.focus(before[2] as HTMLElement);
		expect(before[2]?.getAttribute("tabindex")).toBe("0");

		fireEvent.click(screen.getByTestId("elements-category-sticker"));

		// The previous query's cells are gone immediately — they used to stay on
		// screen with no loading affordance until the new promise resolved,
		// because the skeleton branch only fires on an EMPTY grid.
		expect(screen.queryByTestId("elements-item-square")).toBeNull();
		expect(screen.getByTestId("elements-loading")).toBeTruthy();

		await waitFor(() => expect(options()).toHaveLength(2));
		// And the roving tabindex is back on the first cell rather than clamped to
		// whatever index the old one happened to land on.
		expect(options()[0]?.getAttribute("tabindex")).toBe("0");
		expect(options()[0]?.getAttribute("aria-selected")).toBe("true");
	});
});
