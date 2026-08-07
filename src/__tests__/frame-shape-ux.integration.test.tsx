import {
	type CanvasFrameNode,
	type CanvasImageNode,
	type CanvasIR,
	createCanvasIR,
	createFrame,
	createImage,
	createPage,
	findNode,
	resolveFrameClipShape,
} from "@anvilkit/canvas-core";
import {
	cleanup,
	createEvent,
	fireEvent,
	render,
	screen,
	waitFor,
} from "@testing-library/react";
import type Konva from "konva";
import { afterEach, describe, expect, it } from "vitest";
import {
	CanvasStudioContext,
	type CanvasStudioContextValue,
} from "@/context/canvas-studio-context.js";
import { selectOption } from "@/panels/__tests__/_select-test-helpers.js";
import { PropertyInspector } from "@/panels/PropertyInspector.js";
import { createUploadStore } from "@/stores/upload-store.js";
import {
	makeHarness,
	pointerEvent,
} from "@/tools/__tests__/_tool-test-helpers.js";
import { selectTool } from "@/tools/select-tool.js";
import {
	ASSET_DRAG_MIME,
	CanvasDropZone,
} from "@/workspace/uploads/CanvasDropZone.js";

/**
 * cp4-004 — the masking UX, end to end over the REAL history store.
 *
 * ADR 0008 decision 1 re-scopes this task: drag-onto, cover-fill, replace and
 * `beginCrop` reposition already shipped for image-well frames, so what is
 * exercised here is that they now work with a NON-RECTANGULAR
 * `CanvasFrameNode.shape`, that the shape is reachable from the inspector, and
 * that every operation is exactly one undo step.
 */

const PHOTO = {
	id: "asset-1",
	uri: "https://cdn/photo.png",
	width: 400,
	height: 200,
};
const OTHER = {
	id: "asset-2",
	uri: "https://cdn/other.png",
	width: 300,
	height: 300,
};

afterEach(cleanup);

interface FixtureOptions {
	clip?: boolean;
	shape?: CanvasFrameNode["shape"];
	filled?: boolean;
}

function fixtureIR(opts: FixtureOptions = {}): CanvasIR {
	const page = createPage({ id: "p1", size: { width: 800, height: 600 } });
	page.root.children = [
		{
			...createFrame({
				id: "well",
				bounds: { width: 200, height: 200 },
				transform: { x: 100, y: 100 },
				children: opts.filled
					? [
							createImage({
								id: "photo",
								assetId: "asset-1",
								bounds: { width: 400, height: 200 },
								transform: { x: -100, y: 0 },
							}),
						]
					: [],
			}),
			clip: opts.clip ?? true,
			...(opts.shape === undefined ? {} : { shape: opts.shape }),
			placeholder: {
				kind: "image" as const,
				...(opts.filled ? { assetId: "asset-1" } : {}),
			},
		},
	];
	const ir = createCanvasIR({ id: "doc", pages: [page] });
	ir.assets["asset-1"] = PHOTO;
	ir.assets["asset-2"] = OTHER;
	return ir;
}

function frameOf(ir: CanvasIR): CanvasFrameNode {
	const found = findNode(ir, "well");
	if (!found || found.node.type !== "frame") throw new Error("no frame");
	return found.node;
}

function wellChildren(ir: CanvasIR): CanvasImageNode[] {
	return frameOf(ir).children.filter(
		(c): c is CanvasImageNode => c.type === "image",
	);
}

/** Harness whose commit/commitBatch APPLY through the real history store. */
function liveSetup(ir: CanvasIR) {
	const h = makeHarness({ ir });
	const history = h.studioCtx.historyStore;
	h.studioCtx.commit = (cmd) => {
		const next = history.getState().commit(h.studioCtx.getIR(), cmd);
		h.setIR(next);
		return next;
	};
	h.studioCtx.commitBatch = (cmds, label) => {
		const next = history
			.getState()
			.commitBatch(h.studioCtx.getIR(), cmds, label);
		h.setIR(next);
		return next;
	};
	// The §10 field contract commits through `commitCoalesced`, so the
	// parameter fields (star points, polygon sides, path data) never reach the
	// document unless this seam applies too.
	h.studioCtx.commitCoalesced = (cmd, mergeKey) => {
		const next = history
			.getState()
			.commitCoalesced(h.studioCtx.getIR(), cmd, mergeKey);
		h.setIR(next);
		return next;
	};
	return h;
}

function mountInspector(ctx: CanvasStudioContextValue) {
	return render(
		<CanvasStudioContext.Provider value={ctx}>
			<PropertyInspector />
		</CanvasStudioContext.Provider>,
	);
}

/** Stage stub with the container origin at (0,0) so client == page coords. */
function makeStage(): Konva.Stage {
	const container = document.createElement("div");
	container.getBoundingClientRect = () =>
		({
			left: 0,
			top: 0,
			width: 800,
			height: 600,
			right: 800,
			bottom: 600,
			x: 0,
			y: 0,
			toJSON() {
				return this;
			},
		}) as DOMRect;
	return { container: () => container } as unknown as Konva.Stage;
}

describe("cp4-004 — apply a shape from the inspector", () => {
	it("picking Ellipse clips the frame, and ONE undo/redo round-trips it", async () => {
		const h = liveSetup(fixtureIR({ clip: false, filled: true }));
		const s = h.studioCtx;
		s.selectionStore.getState().setSelection(["well"]);
		const { container } = mountInspector(s);

		expect(
			container.querySelector("[data-testid='prop-frame-shape']"),
		).not.toBeNull();
		await selectOption("prop-frame-shape", "Ellipse", container);

		await waitFor(() =>
			expect(frameOf(s.getIR()).shape).toEqual({ kind: "ellipse" }),
		);
		// `clip` is the only on/off switch, so applying had to turn it on.
		const resolved = resolveFrameClipShape(frameOf(s.getIR()));
		expect(resolved.clipped).toBe(true);
		expect(resolved.shape).toEqual({ kind: "ellipse" });
		expect(resolved.source).toBe("declared");

		h.setIR(s.historyStore.getState().undo(s.getIR()));
		expect(frameOf(s.getIR()).shape).toBeUndefined();
		expect(frameOf(s.getIR()).clip).toBe(false);
		expect(s.historyStore.getState().canUndo()).toBe(false);

		h.setIR(s.historyStore.getState().redo(s.getIR()));
		expect(frameOf(s.getIR()).shape).toEqual({ kind: "ellipse" });
		expect(frameOf(s.getIR()).clip).toBe(true);
	});

	it("exposes the star's parameters and patches the WHOLE shape object", async () => {
		const h = liveSetup(
			fixtureIR({ shape: { kind: "star", points: 5, innerRadiusRatio: 0.5 } }),
		);
		const s = h.studioCtx;
		s.selectionStore.getState().setSelection(["well"]);
		const { container } = mountInspector(s);

		const points = container.querySelector(
			"[data-testid='prop-frame-shape-points']",
		) as HTMLInputElement;
		expect(points).not.toBeNull();
		fireEvent.change(points, { target: { value: "8" } });
		fireEvent.blur(points);

		await waitFor(() =>
			expect(frameOf(s.getIR()).shape).toEqual({
				kind: "star",
				points: 8,
				innerRadiusRatio: 0.5,
			}),
		);
	});

	it("says so when a shape is inert because Clip is off", () => {
		const h = liveSetup(fixtureIR({ clip: false, shape: { kind: "ellipse" } }));
		h.studioCtx.selectionStore.getState().setSelection(["well"]);
		const { container } = mountInspector(h.studioCtx);
		expect(
			container.querySelector("[data-testid='prop-frame-shape-note']")
				?.textContent,
		).toContain("Clip");
	});

	it("says so when the declared shape cannot be drawn", () => {
		const h = liveSetup(
			fixtureIR({
				shape: { kind: "hexagram" } as unknown as CanvasFrameNode["shape"],
			}),
		);
		h.studioCtx.selectionStore.getState().setSelection(["well"]);
		const { container } = mountInspector(h.studioCtx);
		expect(
			container.querySelector("[data-testid='prop-frame-shape-note']")
				?.textContent,
		).toContain("rectangle");
	});
});

describe("cp4-004 — release a shape", () => {
	it("leaves a sane, visible, still-clipped image and undoes in one step", async () => {
		const h = liveSetup(
			fixtureIR({ shape: { kind: "ellipse" }, filled: true }),
		);
		const s = h.studioCtx;
		s.selectionStore.getState().setSelection(["well"]);
		const { container } = mountInspector(s);

		const release = container.querySelector(
			"[data-testid='prop-frame-shape-release']",
		) as HTMLElement;
		expect(release).not.toBeNull();
		fireEvent.click(release);

		await waitFor(() => expect(frameOf(s.getIR()).shape).toBeUndefined());
		const frame = frameOf(s.getIR());
		// Releasing must not un-clip: a cover-filled photo is wider than its
		// frame by construction, and un-clipping would spill it over the page.
		expect(frame.clip).toBe(true);
		const [photo] = wellChildren(s.getIR());
		expect(photo?.bounds).toEqual({ width: 400, height: 200 });

		h.setIR(s.historyStore.getState().undo(s.getIR()));
		expect(frameOf(s.getIR()).shape).toEqual({ kind: "ellipse" });
		expect(s.historyStore.getState().canUndo()).toBe(false);
	});
});

describe("cp4-004 — double-click a clipped image to reposition it", () => {
	/** Two clicks on the same node within the double-click window. */
	function doubleClick(ctx: Parameters<typeof selectTool.onPointerDown>[1]) {
		const target = { name: () => "well", getParent: () => null };
		const evt = (t: number) => ({
			...pointerEvent(150, 150, {
				target: target as unknown as Konva.Node,
			}),
			evt: { timeStamp: t } as unknown as PointerEvent,
		});
		selectTool.onPointerDown?.(evt(1000), ctx);
		selectTool.onPointerDown?.(evt(1100), ctx);
	}

	it("opens the crop editor on the well's image, reusing beginCrop", () => {
		const h = liveSetup(
			fixtureIR({ shape: { kind: "ellipse" }, filled: true }),
		);
		h.ctx.cropStore = h.studioCtx.cropStore;
		h.ctx.getIR = h.studioCtx.getIR;
		doubleClick(h.ctx);
		expect(h.studioCtx.cropStore?.getState().cropNodeId).toBe("photo");
	});

	it("does NOT alter the frame's shape geometry", () => {
		const h = liveSetup(
			fixtureIR({
				shape: { kind: "star", points: 7, innerRadiusRatio: 0.4 },
				filled: true,
			}),
		);
		h.ctx.cropStore = h.studioCtx.cropStore;
		h.ctx.getIR = h.studioCtx.getIR;
		const before = frameOf(h.studioCtx.getIR()).shape;
		doubleClick(h.ctx);
		expect(frameOf(h.studioCtx.getIR()).shape).toEqual(before);
		expect(h.studioCtx.historyStore.getState().canUndo()).toBe(false);
	});

	it("falls back to isolation entry for a frame that is not a clipping well", () => {
		const h = liveSetup(fixtureIR({ clip: false, filled: true }));
		h.ctx.cropStore = h.studioCtx.cropStore;
		h.ctx.getIR = h.studioCtx.getIR;
		const entered: string[] = [];
		h.ctx.isolationStore = {
			getState: () => ({
				path: [],
				enter: (id: string) => entered.push(id),
			}),
			subscribe: () => () => {
				/* no store updates in this test */
			},
		} as unknown as NonNullable<typeof h.ctx.isolationStore>;
		doubleClick(h.ctx);
		expect(h.studioCtx.cropStore?.getState().cropNodeId).toBeNull();
		expect(entered).toEqual(["well"]);
	});
});

describe("cp4-004 — drag an image onto a SHAPED frame", () => {
	function mountDropZone(ctx: CanvasStudioContextValue) {
		ctx.stage = makeStage();
		ctx.uploadStore = createUploadStore();
		return render(
			<CanvasStudioContext.Provider value={ctx}>
				<CanvasDropZone>
					<div>content</div>
				</CanvasDropZone>
			</CanvasStudioContext.Provider>,
		);
	}

	function assetDrag(assetId: string) {
		return {
			files: [],
			types: [ASSET_DRAG_MIME],
			getData: (type: string) => (type === ASSET_DRAG_MIME ? assetId : ""),
		};
	}

	function at(el: HTMLElement, event: Event, x: number, y: number) {
		Object.defineProperty(event, "clientX", { value: x, configurable: true });
		Object.defineProperty(event, "clientY", { value: y, configurable: true });
		fireEvent(el, event);
	}

	it("announces the SHAPE before the drop, not just 'replace'", async () => {
		const h = liveSetup(
			fixtureIR({ shape: { kind: "star", points: 5, innerRadiusRatio: 0.5 } }),
		);
		mountDropZone(h.studioCtx);
		const zone = screen.getByTestId("canvas-drop-zone");
		at(
			zone,
			createEvent.dragOver(zone, { dataTransfer: assetDrag("asset-2") }),
			150,
			150,
		);
		await waitFor(() =>
			expect(zone.getAttribute("data-drop-target")).toBe("well"),
		);
		expect(zone.getAttribute("data-drop-target-shape")).toBe("star");
		expect(screen.getByTestId("drop-target-highlight").textContent).toBe(
			"Drop to fill shape",
		);
	});

	it("keeps the shipped wording for a plain rectangular well", async () => {
		const h = liveSetup(fixtureIR());
		mountDropZone(h.studioCtx);
		const zone = screen.getByTestId("canvas-drop-zone");
		at(
			zone,
			createEvent.dragOver(zone, { dataTransfer: assetDrag("asset-2") }),
			150,
			150,
		);
		await waitFor(() =>
			expect(zone.getAttribute("data-drop-target")).toBe("well"),
		);
		expect(zone.getAttribute("data-drop-target-shape")).toBeNull();
		expect(screen.getByTestId("drop-target-highlight").textContent).toBe(
			"Drop to replace",
		);
	});

	it("fills the shaped well as ONE undo step, leaving the shape untouched", async () => {
		const h = liveSetup(fixtureIR({ shape: { kind: "ellipse" } }));
		const s = h.studioCtx;
		mountDropZone(s);
		const zone = screen.getByTestId("canvas-drop-zone");
		at(
			zone,
			createEvent.drop(zone, { dataTransfer: assetDrag("asset-2") }),
			150,
			150,
		);

		await waitFor(() => expect(wellChildren(s.getIR())).toHaveLength(1));
		const frame = frameOf(s.getIR());
		// The photo is a CHILD clipped by the frame — never flattened into it.
		expect(frame.children[0]?.type).toBe("image");
		expect(frame.shape).toEqual({ kind: "ellipse" });
		expect(frame.placeholder?.assetId).toBe("asset-2");
		// Cover geometry: a 300×300 asset into a 200×200 box.
		expect(wellChildren(s.getIR())[0]?.bounds).toEqual({
			width: 200,
			height: 200,
		});

		h.setIR(s.historyStore.getState().undo(s.getIR()));
		expect(wellChildren(s.getIR())).toHaveLength(0);
		expect(frameOf(s.getIR()).shape).toEqual({ kind: "ellipse" });
		expect(s.historyStore.getState().canUndo()).toBe(false);

		h.setIR(s.historyStore.getState().redo(s.getIR()));
		expect(wellChildren(s.getIR())).toHaveLength(1);
	});
});
