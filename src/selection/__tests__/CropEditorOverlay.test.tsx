import {
	type CanvasIR,
	type CanvasNodeUpdateCommand,
	createCanvasIR,
	createImage,
	createPage,
} from "@anvilkit/canvas-core";
import { fireEvent, render } from "@testing-library/react";
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

	it("Escape cancels without committing", () => {
		const h = makeHarness({ ir: imageIR() });
		h.studioCtx.cropStore?.getState().begin("img-a");
		mount(h.studioCtx);
		fireEvent.keyDown(window, { key: "Escape" });
		expect(h.commits).toHaveLength(0);
		expect(h.studioCtx.cropStore?.getState().cropNodeId).toBeNull();
	});
});
