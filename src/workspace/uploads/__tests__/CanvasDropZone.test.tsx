import type { CanvasNodeCreateCommand } from "@anvilkit/canvas-core";
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
import type { CanvasAssetUploader } from "@/assets/adapter-types.js";
import { CanvasStudioContext } from "@/context/canvas-studio-context.js";
import { makeHarness } from "@/tools/__tests__/_tool-test-helpers.js";
import { CanvasDropZone } from "../CanvasDropZone.js";

afterEach(cleanup);

/**
 * A stage stub whose `container()` returns a real DOM node with a
 * controllable `getBoundingClientRect` — the same shape `CanvasDropZone`
 * reads via `ctx.stage.container()` (mirroring
 * CropEditorOverlay/TextEditorOverlay's page<->screen transform).
 */
function makeStageWithRect(rect: {
	left: number;
	top: number;
	width: number;
	height: number;
}): Konva.Stage {
	const container = document.createElement("div");
	container.getBoundingClientRect = () =>
		({
			...rect,
			right: rect.left + rect.width,
			bottom: rect.top + rect.height,
			x: rect.left,
			y: rect.top,
			toJSON() {
				return this;
			},
		}) as DOMRect;
	return { container: () => container } as unknown as Konva.Stage;
}

/** Uploader resolving every file to a fixed-size asset (deterministic math). */
function fixedSizeUploader(width: number, height: number): CanvasAssetUploader {
	return {
		upload: async (files) =>
			files.map((f, i) => ({
				id: `up-${i}`,
				uri: `https://cdn/${f.name}`,
				width,
				height,
			})),
	};
}

function setup(uploader: CanvasAssetUploader, stage: Konva.Stage) {
	const h = makeHarness();
	h.studioCtx.stage = stage;
	h.studioCtx.assetUploader = uploader;
	render(
		<CanvasStudioContext.Provider value={h.studioCtx}>
			<CanvasDropZone>
				<div>content</div>
			</CanvasDropZone>
		</CanvasStudioContext.Provider>,
	);
	return { h };
}

/**
 * jsdom has no real `DragEvent` (only `dataTransfer`/`clipboardData` get
 * special-cased by `@testing-library/dom`'s `createEvent`), so a plain
 * `fireEvent.drop(el, { clientX, clientY })` silently drops those two props —
 * the underlying `Event` constructor ignores unrecognized init keys. Define
 * them directly on the event instance before dispatching, same as
 * testing-library does internally for `dataTransfer`.
 */
function dropFiles(
	files: readonly File[],
	point: { clientX: number; clientY: number },
): void {
	const zone = screen.getByTestId("canvas-drop-zone");
	const event = createEvent.drop(zone, {
		dataTransfer: { files, types: ["Files"] },
	});
	Object.defineProperty(event, "clientX", {
		value: point.clientX,
		configurable: true,
	});
	Object.defineProperty(event, "clientY", {
		value: point.clientY,
		configurable: true,
	});
	fireEvent(zone, event);
}

const file = (name: string): File =>
	new File(["x"], name, { type: "image/png" });

describe("CanvasDropZone — drop position (FR-092)", () => {
	it("inserts at the converted page position for a drop inside the visible page", async () => {
		// Active page (800x600 default from makeHarness's fixture) rendered at
		// zoom 1 with its container's screen origin at (100, 50).
		const stage = makeStageWithRect({
			left: 100,
			top: 50,
			width: 800,
			height: 600,
		});
		const { h } = setup(fixedSizeUploader(100, 50), stage);
		// clientX/clientY 140/110 -> page (40, 60).
		dropFiles([file("a.png")], { clientX: 140, clientY: 110 });
		await waitFor(() => expect(h.commits.length).toBeGreaterThan(0));
		const node = h.commits.find(
			(c) => c.type === "node.create",
		) as CanvasNodeCreateCommand;
		expect(node.node.transform).toMatchObject({ x: 40, y: 60 });
	});

	it("falls back to page-center for a drop outside the page bounds", async () => {
		const stage = makeStageWithRect({
			left: 100,
			top: 50,
			width: 800,
			height: 600,
		});
		const { h } = setup(fixedSizeUploader(100, 50), stage);
		// clientX/clientY 0/0 -> page (-100, -50): outside on both axes.
		dropFiles([file("a.png")], { clientX: 0, clientY: 0 });
		await waitFor(() => expect(h.commits.length).toBeGreaterThan(0));
		const node = h.commits.find(
			(c) => c.type === "node.create",
		) as CanvasNodeCreateCommand;
		// makeHarness's default page is 1080x1080; centered: (1080-100)/2 =
		// 490, (1080-50)/2 = 515.
		expect(node.node.transform).toMatchObject({ x: 490, y: 515 });
	});

	it("falls back to page-center when there is no live stage yet", async () => {
		const h = makeHarness();
		h.studioCtx.stage = null;
		h.studioCtx.assetUploader = fixedSizeUploader(100, 50);
		render(
			<CanvasStudioContext.Provider value={h.studioCtx}>
				<CanvasDropZone>
					<div>content</div>
				</CanvasDropZone>
			</CanvasStudioContext.Provider>,
		);
		dropFiles([file("a.png")], { clientX: 140, clientY: 110 });
		await waitFor(() => expect(h.commits.length).toBeGreaterThan(0));
		const node = h.commits.find(
			(c) => c.type === "node.create",
		) as CanvasNodeCreateCommand;
		// No stage -> no position -> falls back to centering, same as above.
		expect(node.node.transform).toMatchObject({ x: 490, y: 515 });
	});

	it("grid-arranges multiple files around the real anchor, not page center", async () => {
		const stage = makeStageWithRect({
			left: 100,
			top: 50,
			width: 800,
			height: 600,
		});
		const { h } = setup(fixedSizeUploader(100, 50), stage);
		dropFiles([file("a.png"), file("b.png")], { clientX: 140, clientY: 110 });
		await waitFor(() =>
			expect(h.commits.filter((c) => c.type === "node.create")).toHaveLength(2),
		);
		const nodes = h.commits.filter(
			(c) => c.type === "node.create",
		) as CanvasNodeCreateCommand[];
		expect(nodes[0]?.node.transform).toMatchObject({ x: 40, y: 60 });
		// GRID_STEP = 24, GRID_COLUMNS = 3: second item offsets on x only.
		expect(nodes[1]?.node.transform).toMatchObject({ x: 64, y: 60 });
	});

	it("sets data-dragging while a file drag is over the zone", () => {
		const stage = makeStageWithRect({
			left: 0,
			top: 0,
			width: 800,
			height: 600,
		});
		setup(fixedSizeUploader(100, 50), stage);
		const zone = screen.getByTestId("canvas-drop-zone");
		expect(zone).toHaveAttribute("data-dragging", "false");
		fireEvent.dragOver(zone, { dataTransfer: { types: ["Files"] } });
		expect(zone).toHaveAttribute("data-dragging", "true");
		fireEvent.dragLeave(zone);
		expect(zone).toHaveAttribute("data-dragging", "false");
	});
});
