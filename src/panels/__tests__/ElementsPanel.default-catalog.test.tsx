/**
 * @file The stroke-vs-fill preview branch, against the REAL 425-entry catalog.
 *
 * `ElementsPanel.test.tsx` proves the branch with fixtures; this proves it with
 * the data that actually ships. 181 of the 425 default entries are
 * `recolor: "stroke"`, and every one of them rendered as a filled path is a
 * black blob — the single most visible way this panel could ship broken, and
 * one that no type check and no schema test can see, because
 * `CanvasElementPreview` carries the same `{ kind: "path", d, viewBox }` either
 * way.
 *
 * Two categories make the assertion total rather than sampled: the default
 * catalog's 25 `line` entries are ALL `recolor: "stroke"` and its 53 `shape`
 * entries are ALL `recolor: "fill"`, so one page of each is a clean split with
 * no per-entry expectations to maintain.
 *
 * This file imports the catalog on purpose — in a test, where the 189 KB costs
 * nothing. The assertion that PRODUCTION code never does is in
 * `ElementsPanel.lazy-catalog.test.tsx`.
 */

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import * as React from "react";
import { afterEach, describe, expect, it } from "vitest";
import { CanvasStudioContext } from "@/context/canvas-studio-context.js";
import { DEFAULT_ELEMENTS } from "@/elements/default-element-catalog.js";
import type { CanvasElementCategory } from "@/elements/element-entry.js";
import { createStaticElementProvider } from "@/elements/element-provider.js";
import { ElementsPanel } from "@/panels/ElementsPanel.js";
import { makeHarness } from "@/tools/__tests__/_tool-test-helpers.js";

// react-library vitest preset has globals:false — RTL auto-cleanup is OFF.
afterEach(cleanup);

/** Mount on the real catalog and switch to one category tab. */
async function showCategory(category: CanvasElementCategory): Promise<void> {
	const harness = makeHarness();
	render(
		<CanvasStudioContext.Provider value={harness.studioCtx}>
			<ElementsPanel
				elementProvider={createStaticElementProvider(DEFAULT_ELEMENTS)}
			/>
		</CanvasStudioContext.Provider>,
	);
	await screen.findByTestId("elements-grid");
	fireEvent.click(screen.getByTestId(`elements-category-${category}`));
	await screen.findByTestId("elements-grid");
}

/** Every rendered preview's `<path>`, keyed by the entry id in its testid. */
function renderedPaths(): Array<[string, SVGPathElement]> {
	return [...screen.getByTestId("elements-grid").querySelectorAll("svg")]
		.map((svg): [string, SVGPathElement | null] => [
			svg.getAttribute("data-testid") ?? "?",
			svg.querySelector("path"),
		])
		.filter((pair): pair is [string, SVGPathElement] => pair[1] !== null);
}

describe("ElementsPanel — real catalog previews", () => {
	it("the fixture assumptions still hold: every line entry strokes, every shape entry fills", () => {
		const byCategory = (category: CanvasElementCategory) =>
			DEFAULT_ELEMENTS.filter((entry) => entry.category === category);
		expect(byCategory("line").length).toBeGreaterThan(0);
		expect(
			byCategory("line").filter((entry) => entry.recolor !== "stroke"),
		).toEqual([]);
		expect(byCategory("shape").length).toBeGreaterThan(0);
		expect(
			byCategory("shape").filter((entry) => entry.recolor !== "fill"),
		).toEqual([]);
	});

	it("renders every real stroke entry as an outline — no black blobs", async () => {
		await showCategory("line");
		const paths = renderedPaths();
		expect(paths.length).toBeGreaterThan(0);
		const blobs = paths
			.filter(([, path]) => path.getAttribute("fill") !== "none")
			.map(([id]) => id);
		expect(blobs).toEqual([]);
		for (const [id, path] of paths) {
			expect(path.getAttribute("stroke"), id).toBe("currentColor");
			expect(Number(path.getAttribute("stroke-width")), id).toBeGreaterThan(0);
		}
	});

	it("renders every real fill entry as a filled path with no stroke", async () => {
		await showCategory("shape");
		const paths = renderedPaths();
		expect(paths.length).toBeGreaterThan(0);
		const outlined = paths
			.filter(([, path]) => path.getAttribute("fill") !== "currentColor")
			.map(([id]) => id);
		expect(outlined).toEqual([]);
		for (const [id, path] of paths) {
			expect(path.getAttribute("stroke"), id).toBeNull();
		}
	});
});
