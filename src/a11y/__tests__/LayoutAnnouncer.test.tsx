import type { CanvasIR, CanvasNode } from "@anvilkit/canvas-core";
import {
	createCanvasIR,
	createFrame,
	createPage,
	createRect,
	insertNode,
} from "@anvilkit/canvas-core";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { CanvasStudioContext } from "@/context/canvas-studio-context.js";
import { createResolvedDocumentStore } from "@/stores/resolved-document-store.js";
import { createSceneStore } from "@/stores/scene-store.js";
import { makeHarness } from "@/tools/__tests__/_tool-test-helpers.js";
import { LayoutAnnouncer } from "../LayoutAnnouncer.js";

afterEach(cleanup);

/**
 * T-M4-08 (TS-39 announcements) — the polite live region speaks LOCALIZED
 * words (flow position, direction, sizing modes), never raw enum values, and
 * says nothing outside an Auto Layout context. Diagnostics are never routed
 * through this region.
 */

const LAYOUT = {
	version: 1,
	direction: "horizontal",
	padding: { top: 0, right: 0, bottom: 0, left: 0 },
	gap: 10,
	primaryAlign: "start",
	crossAlign: "start",
} as const;

function fixtureIR(): CanvasIR {
	const frame: CanvasNode = {
		...createFrame({ id: "f1", bounds: { width: 200, height: 100 } }),
		autoLayout: LAYOUT,
		children: [
			createRect({ id: "r1", bounds: { width: 40, height: 20 } }),
			{
				...createRect({ id: "r2", bounds: { width: 40, height: 20 } }),
				layoutItem: { widthSizing: "fill" as const },
			},
			{
				...createRect({ id: "r3", bounds: { width: 40, height: 20 } }),
				layoutItem: { positioning: "absolute" as const },
			},
		],
	} as CanvasNode;
	const page = createPage({ id: "p1" });
	let ir = createCanvasIR({ id: "doc", title: "t", pages: [page] });
	ir = insertNode(ir, { parentId: page.root.id, node: frame });
	ir = insertNode(ir, {
		parentId: page.root.id,
		node: createRect({ id: "loose", bounds: { width: 10, height: 10 } }),
	});
	return ir;
}

function setup(selection: readonly string[]) {
	const ir = fixtureIR();
	const h = makeHarness({ ir, pageId: "p1" });
	const fieldPreviewStore = h.studioCtx.fieldPreviewStore;
	if (!fieldPreviewStore) throw new Error("harness lacks fieldPreviewStore");
	h.studioCtx.resolvedDocumentStore = createResolvedDocumentStore({
		sceneStore: createSceneStore({ initialIR: ir }),
		fieldPreviewStore,
	});
	h.studioCtx.selectionStore.getState().setSelection([...selection]);
	render(
		<CanvasStudioContext.Provider value={h.studioCtx}>
			<LayoutAnnouncer />
		</CanvasStudioContext.Provider>,
	);
	return h;
}

function announced(): string {
	return screen.getByTestId("layout-announcer").textContent ?? "";
}

describe("LayoutAnnouncer", () => {
	it("announces an Auto Layout frame as localized direction + child count", () => {
		setup(["f1"]);
		expect(announced()).toBe("f1: Horizontal auto layout, 3 items");
	});

	it("announces a Flow child as item N of M with localized direction", () => {
		setup(["r1"]);
		expect(announced()).toBe("r1: item 1 of 2, Horizontal");
	});

	it("appends localized sizing words for non-default modes", () => {
		setup(["r2"]);
		expect(announced()).toBe(
			"r2: item 2 of 2, Horizontal, Fill container width, Fixed height",
		);
	});

	it("announces Absolute children by positioning, not flow position", () => {
		setup(["r3"]);
		expect(announced()).toBe("r3: Absolute");
	});

	it("stays silent outside Auto Layout contexts and for multi-selection", () => {
		setup(["loose"]);
		expect(announced()).toBe("");
		cleanup();
		setup(["r1", "r2"]);
		expect(announced()).toBe("");
	});
});
