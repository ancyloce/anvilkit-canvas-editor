import {
	type CanvasIR,
	createCanvasIR,
	createGroup,
	createPage,
	createRect,
	toResolvedNodeId,
} from "@anvilkit/canvas-core";
import { act, cleanup, render } from "@testing-library/react";
import type Konva from "konva";
import { afterEach, describe, expect, it } from "vitest";
import { CanvasStudioContext } from "@/context/canvas-studio-context.js";
import { makeHarness } from "@/tools/__tests__/_tool-test-helpers.js";
import type { StageWindow } from "../stage-window.js";
import { ViewportCullingController } from "../ViewportCullingController.js";

afterEach(cleanup);

const FIXED_TS = "2026-05-20T00:00:00.000Z";

/** Page with `near` at the origin and `far` at (5000, 5000), both 50×50. */
function fixtureIR(hiddenFarAway = false): CanvasIR {
	const page = createPage({ id: "p1" });
	page.root = createGroup({
		id: "p1-root",
		bounds: page.root.bounds,
		children: [
			createRect({
				id: "near",
				transform: { x: 0, y: 0 },
				bounds: { width: 50, height: 50 },
			}),
			createRect({
				id: "far",
				transform: { x: 5000, y: 5000 },
				bounds: { width: 50, height: 50 },
			}),
			...(hiddenFarAway
				? [
						{
							...createRect({
								id: "hidden-far",
								transform: { x: 9000, y: 9000 },
								bounds: { width: 50, height: 50 },
							}),
							visible: false as const,
						},
					]
				: []),
		],
	});
	return createCanvasIR({ id: "ir", pages: [page], now: () => FIXED_TS });
}

/** A trackable Konva.Node fake: id + visible + attrs. */
function fakeKonvaNode(id: string) {
	let visible = true;
	const attrs = new Map<string, unknown>();
	return {
		id: () => id,
		visible: (next?: boolean) => {
			if (next === undefined) return visible;
			visible = next;
			return undefined as unknown as boolean;
		},
		setAttr: (key: string, value: unknown) => {
			attrs.set(key, value);
		},
		getAttr: (key: string) => attrs.get(key),
		_isVisible: () => visible,
	};
}

/**
 * Minimal resolved document: identity page root plus one record per child,
 * whose page-space AABB equals its transform × bounds. Shaped exactly the way
 * `createResolvedPageSpace` reads records (`parentId` chain up to an identity
 * root ⇒ AABBs pass through untouched).
 */
function fakeResolvedDocument(ir: CanvasIR) {
	const page = ir.pages[0];
	if (!page) throw new Error("fixture has a page");
	const records = new Map();
	const rootId = toResolvedNodeId(page.root.id);
	records.set(rootId, {
		id: rootId,
		parentId: null,
		node: page.root,
		geometry: {
			worldTransform: [1, 0, 0, 1, 0, 0],
			bounds: page.root.bounds,
			worldAabb: {
				minX: 0,
				minY: 0,
				maxX: page.root.bounds.width,
				maxY: page.root.bounds.height,
			},
		},
	});
	for (const child of page.root.children) {
		const id = toResolvedNodeId(child.id);
		const { x, y } = child.transform;
		records.set(id, {
			id,
			parentId: rootId,
			node: child,
			geometry: {
				worldTransform: [1, 0, 0, 1, x, y],
				bounds: child.bounds,
				worldAabb: {
					minX: x,
					minY: y,
					maxX: x + child.bounds.width,
					maxY: y + child.bounds.height,
				},
			},
		});
	}
	return { records };
}

const WINDOW: StageWindow = { x: 0, y: 0, width: 400, height: 300 };

function setup(options?: { window?: StageWindow | null; ir?: CanvasIR }) {
	const ir = options?.ir ?? fixtureIR();
	const h = makeHarness({ ir });
	const page = ir.pages[0];
	if (!page) throw new Error("fixture has a page");
	const konvaNodes = page.root.children.map((n) => fakeKonvaNode(n.id));
	const byId = new Map(konvaNodes.map((n) => [n.id(), n]));
	const stage = {
		findOne: (predicate: (node: unknown) => boolean) =>
			konvaNodes.find((n) => predicate(n)),
		batchDraw: () => undefined,
	} as unknown as Konva.Stage;
	h.studioCtx.stage = stage;
	const resolved = fakeResolvedDocument(ir);
	h.studioCtx.resolvedDocumentStore = {
		subscribe: () => () => undefined,
		getState: () => ({ resolved }),
	} as never;

	const view = render(
		<CanvasStudioContext.Provider value={h.studioCtx}>
			<ViewportCullingController
				stageWindow={options?.window === undefined ? WINDOW : options.window}
				zoom={1}
				panX={0}
				panY={0}
				surfaceChildren={page.root.children}
			/>
		</CanvasStudioContext.Provider>,
	);
	return { h, view, byId, page };
}

describe("ViewportCullingController (K-12)", () => {
	it("culls the off-window node and marks it, leaves the on-window node alone", () => {
		const { byId } = setup();
		const near = byId.get("near");
		const far = byId.get("far");
		expect(near?._isVisible()).toBe(true);
		expect(near?.getAttr("akCulled")).toBeUndefined();
		expect(far?._isVisible()).toBe(false);
		expect(far?.getAttr("akCulled")).toBe(true);
	});

	it("culls nothing without a stage window (bare hosts, pre-measurement)", () => {
		const { byId } = setup({ window: null });
		expect(byId.get("far")?._isVisible()).toBe(true);
		expect(byId.get("far")?.getAttr("akCulled")).toBeUndefined();
	});

	it("keeps a selected node visible wherever it is", () => {
		const { h, byId } = setup();
		expect(byId.get("far")?._isVisible()).toBe(false);
		act(() => {
			h.studioCtx.selectionStore.getState().setSelection(["far"]);
		});
		expect(byId.get("far")?._isVisible()).toBe(true);
		expect(byId.get("far")?.getAttr("akCulled")).toBe(false);
	});

	it("never touches an IR-hidden node — and never marks it akCulled", () => {
		const { byId } = setup({ ir: fixtureIR(true) });
		const hidden = byId.get("hidden-far");
		// Its Konva `visible` is declared false by the renderer; the controller
		// must not write to it at all (the fake starts visible=true, so ANY
		// write would flip it or set the marker).
		expect(hidden?.getAttr("akCulled")).toBeUndefined();
	});

	it("restores every culled node on unmount", () => {
		const { view, byId } = setup();
		expect(byId.get("far")?._isVisible()).toBe(false);
		view.unmount();
		expect(byId.get("far")?._isVisible()).toBe(true);
		expect(byId.get("far")?.getAttr("akCulled")).toBe(false);
	});
});
