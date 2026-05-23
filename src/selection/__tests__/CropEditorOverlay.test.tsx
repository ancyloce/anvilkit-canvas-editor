import {
	type CanvasIR,
	type CanvasNodeUpdateCommand,
	createCanvasIR,
	createImage,
	createPage,
} from "@anvilkit/canvas-core";
import { fireEvent, render } from "@testing-library/react";
import type Konva from "konva";
import { describe, expect, it } from "vitest";
import {
	CanvasStudioContext,
	type CanvasStudioContextValue,
} from "../../context/canvas-studio-context.js";
import type { CropRect } from "../../stores/crop-store.js";
import { makeHarness } from "../../tools/__tests__/_tool-test-helpers.js";
import { CropEditorOverlay } from "../CropEditorOverlay.js";

/** image "img-a" (200×100) with a 200×100 source asset → 1:1 screen↔natural. */
function imageIR(): CanvasIR {
	const page = createPage({ id: "p1" });
	page.root.children = [
		createImage({
			id: "img-a",
			bounds: { width: 200, height: 100 },
			assetId: "asset-1",
		}),
	];
	const ir = createCanvasIR({ id: "ir", pages: [page] });
	ir.assets["asset-1"] = {
		id: "asset-1",
		uri: "data:image/png;base64,XXX",
		width: 200,
		height: 100,
	};
	return ir;
}

function mount(ctx: CanvasStudioContextValue) {
	return render(
		<CanvasStudioContext.Provider value={ctx}>
			<CropEditorOverlay />
		</CanvasStudioContext.Provider>,
	);
}

/**
 * A stage whose `container()` reads `this` (like real Konva, which delegates to
 * `this.getContainer()`). Calling it unbound — `const fn = stage.container;
 * fn()` — sets `this` to undefined and throws "reading 'getContainer'". The
 * default fake stage uses a `this`-less arrow, which is why it never caught the
 * binding bug.
 */
function konvaLikeStage(): Konva.Stage {
	const el = document.createElement("div");
	return {
		findOne: () => null,
		container(this: { getContainer: () => HTMLElement }) {
			return this.getContainer();
		},
		getContainer: () => el,
	} as unknown as Konva.Stage;
}

describe("CropEditorOverlay", () => {
	it("renders nothing when no crop is in progress", () => {
		const h = makeHarness({ ir: imageIR() });
		const { container } = mount(h.studioCtx);
		expect(
			container.querySelector("[data-testid='crop-editor-overlay']"),
		).toBeNull();
	});

	it("seeds the full-image draft and renders rect + corner handles", () => {
		const h = makeHarness({ ir: imageIR() });
		h.studioCtx.cropStore?.getState().begin("img-a");
		const { container } = mount(h.studioCtx);
		expect(
			container.querySelector("[data-testid='crop-editor-overlay']"),
		).not.toBeNull();
		expect(
			container.querySelector("[data-testid='crop-handle-se']"),
		).not.toBeNull();
		expect(h.studioCtx.cropStore?.getState().draft).toEqual({
			x: 0,
			y: 0,
			width: 200,
			height: 100,
		});
	});

	it("dragging the SE handle updates the draft (1:1 at zoom 1)", () => {
		const h = makeHarness({ ir: imageIR() });
		h.studioCtx.cropStore?.getState().begin("img-a");
		const { container } = mount(h.studioCtx);
		const se = container.querySelector(
			"[data-testid='crop-handle-se']",
		) as HTMLElement;
		fireEvent.pointerDown(se, { clientX: 300, clientY: 200 });
		fireEvent.pointerMove(window, { clientX: 250, clientY: 180 });
		fireEvent.pointerUp(window);
		expect(h.studioCtx.cropStore?.getState().draft).toEqual({
			x: 0,
			y: 0,
			width: 150,
			height: 80,
		});
	});

	it("confirm commits one node.update and closes the editor", () => {
		const h = makeHarness({ ir: imageIR() });
		h.studioCtx.cropStore?.getState().begin("img-a");
		const { container } = mount(h.studioCtx);
		const confirm = container.querySelector(
			"[data-testid='crop-confirm']",
		) as HTMLElement;
		fireEvent.click(confirm);
		expect(h.commits).toHaveLength(1);
		const cmd = h.commits[0] as CanvasNodeUpdateCommand<"image">;
		expect(cmd.type).toBe("node.update");
		expect((cmd.patch as { crop?: CropRect }).crop).toEqual({
			x: 0,
			y: 0,
			width: 200,
			height: 100,
		});
		expect(h.studioCtx.cropStore?.getState().cropNodeId).toBeNull();
	});

	it("calls stage.container() bound to the stage (no 'getContainer' crash)", () => {
		// Regression: the overlay used to extract `const fn = stage.container`
		// and call `fn()`, dropping the `this` binding. Against a real Konva
		// stage (whose container() reads `this`), that threw
		// "Cannot read properties of undefined (reading 'getContainer')".
		const h = makeHarness({ ir: imageIR() });
		h.studioCtx.cropStore?.getState().begin("img-a");
		h.studioCtx.stage = konvaLikeStage();
		let result: ReturnType<typeof mount> | undefined;
		expect(() => {
			result = mount(h.studioCtx);
		}).not.toThrow();
		expect(
			result?.container.querySelector("[data-testid='crop-editor-overlay']"),
		).not.toBeNull();
	});

	it("Escape cancels without committing", () => {
		const h = makeHarness({ ir: imageIR() });
		h.studioCtx.cropStore?.getState().begin("img-a");
		mount(h.studioCtx);
		fireEvent.keyDown(window, { key: "Escape" });
		expect(h.commits).toHaveLength(0);
		expect(h.studioCtx.cropStore?.getState().cropNodeId).toBeNull();
	});
});
