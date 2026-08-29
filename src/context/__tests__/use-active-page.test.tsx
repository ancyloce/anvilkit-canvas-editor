import { createCanvasIR, createPage } from "@anvilkit/canvas-core";
import { act, cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { createFieldPreviewStore } from "@/stores/field-preview-store.js";
import { createResolvedDocumentStore } from "@/stores/resolved-document-store.js";
import { createSceneStore } from "@/stores/scene-store.js";
import { makeHarness } from "@/tools/__tests__/_tool-test-helpers.js";
import {
	type CanvasActivePageChrome,
	CanvasStudioContext,
	useActivePage,
} from "../canvas-studio-context.js";

afterEach(cleanup);

/**
 * @file T-4.2 — `useActivePage` is the ONE place the stage overlays read the
 * active page's chrome from, and it is identity-scoped so `Grid`,
 * `DesignBackground` and `GuideLayoutOverlay` can bail out of a render.
 *
 * `withPreviews` rebuilds the page object whenever ANY node preview changes, so
 * subscribing on the page itself would re-render every overlay on every frame
 * of an unrelated drag. The narrowing must therefore depend on the chrome
 * fields alone — and on nothing the overlays do not actually read.
 */

function setup(pageName?: string) {
	const page = createPage({
		id: "p1",
		size: { width: 800, height: 600 },
		...(pageName !== undefined ? { name: pageName } : {}),
	});
	const ir = createCanvasIR({ id: "doc", pages: [page] });
	const sceneStore = createSceneStore({ initialIR: ir });
	const fieldPreviewStore = createFieldPreviewStore();
	const resolvedDocumentStore = createResolvedDocumentStore({
		sceneStore,
		fieldPreviewStore,
		schedulePreviewResolution(callback) {
			callback();
			return () => {
				// This test flushes preview frames synchronously.
			};
		},
	});
	const disconnect = resolvedDocumentStore.connect();
	const h = makeHarness({ ir });

	const seen: (CanvasActivePageChrome | undefined)[] = [];
	function Probe() {
		seen.push(useActivePage());
		return null;
	}
	render(
		<CanvasStudioContext.Provider
			value={{
				...h.studioCtx,
				ir,
				activePageId: "p1",
				fieldPreviewStore,
				resolvedDocumentStore,
			}}
		>
			<Probe />
		</CanvasStudioContext.Provider>,
	);
	return { seen, sceneStore, fieldPreviewStore, disconnect };
}

describe("useActivePage (T-4.2)", () => {
	it("exposes the chrome fields the stage overlays draw from", () => {
		const { seen, disconnect } = setup();
		const page = seen.at(-1);
		expect(page?.id).toBe("p1");
		expect(page?.size).toMatchObject({ width: 800, height: 600 });
		expect(page?.background).toBeDefined();
		disconnect();
	});

	/**
	 * `name` is read by NONE of the three consumers (`DesignBackground` takes
	 * size + background, `Grid` takes size, `GuideLayoutOverlay` takes size +
	 * layoutAids). Carrying it meant a per-keystroke `page.rename` from the
	 * PageRow inline input busted the memo and re-ran `Grid`'s full line
	 * generation — up to MAX_GRID_LINES per axis of fresh elements — on every
	 * keystroke, which is exactly the churn this hook exists to prevent.
	 */
	it("does not expose `name`, so a rename cannot re-render the overlays", () => {
		const { seen, sceneStore, disconnect } = setup("Cover");
		const before = seen.at(-1);
		expect(before).toBeDefined();
		expect("name" in (before as object)).toBe(false);

		const ir = sceneStore.getState().ir;
		const page = ir.pages[0];
		if (!page) throw new Error("fixture page missing");
		act(() => {
			sceneStore.setState({
				ir: { ...ir, pages: [{ ...page, name: "Renamed" }] },
			});
		});

		// Same object back: nothing an overlay reads moved, so React bails out.
		expect(seen.at(-1)).toBe(before);
		disconnect();
	});

	/**
	 * The identity-scoping that makes the hook worth having: a NODE preview
	 * rebuilds the page object inside `withPreviews`, and the overlays must not
	 * re-render for it.
	 */
	it("returns the same snapshot when only a node preview changes", () => {
		const { seen, fieldPreviewStore, disconnect } = setup();
		const before = seen.at(-1);
		act(() => {
			fieldPreviewStore
				.getState()
				.setPreviews({ nonexistent: { opacity: 0.5 } });
		});
		expect(seen.at(-1)).toBe(before);
		disconnect();
	});

	it("returns a NEW snapshot when a chrome field actually changes", () => {
		const { seen, fieldPreviewStore, disconnect } = setup();
		const before = seen.at(-1);
		act(() => {
			fieldPreviewStore.getState().setPagePreviews({
				p1: { size: { width: 1200, height: 600, unit: "px" } },
			});
		});
		const after = seen.at(-1);
		expect(after).not.toBe(before);
		expect(after?.size.width).toBe(1200);
		disconnect();
	});
});
