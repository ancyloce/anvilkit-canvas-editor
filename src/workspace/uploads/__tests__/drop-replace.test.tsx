import {
	type CanvasImageReplaceCommand,
	createCanvasIR,
	createFrame,
	createGroup,
	createImage,
	createPage,
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
import type { CanvasAssetUploader } from "@/assets/adapter-types.js";
import { CanvasStudioContext } from "@/context/canvas-studio-context.js";
import { createUploadStore } from "@/stores/upload-store.js";
import { makeHarness } from "@/tools/__tests__/_tool-test-helpers.js";
import { ASSET_DRAG_MIME, CanvasDropZone } from "../CanvasDropZone.js";
import { resolveDropTarget } from "../drop-target.js";

afterEach(cleanup);

/**
 * FR-093 drag-to-replace: target resolution from the page point, replace vs
 * insert routing, locked/hidden exclusion, crop/geometry preservation by
 * construction (image.replace only swaps assetId), single-undo atomicity,
 * multi-file disambiguation, and the no-target insertion fallback.
 */

function fixtureIR() {
	const page = createPage({ id: "p1", size: { width: 800, height: 600 } });
	page.root = createGroup({
		id: "root",
		bounds: page.root.bounds,
		children: [
			createImage({
				id: "img-1",
				assetId: "old-asset",
				bounds: { width: 200, height: 100 },
				transform: { x: 100, y: 100 },
				crop: { x: 0.1, y: 0.1, width: 0.5, height: 0.5 },
			}),
			{
				...createImage({
					id: "img-locked",
					assetId: "old-asset",
					bounds: { width: 100, height: 100 },
					transform: { x: 400, y: 100 },
				}),
				locked: true,
			},
			{
				...createImage({
					id: "img-hidden",
					assetId: "old-asset",
					bounds: { width: 100, height: 100 },
					transform: { x: 100, y: 400 },
				}),
				visible: false,
			},
			createFrame({
				id: "well-1",
				bounds: { width: 150, height: 150 },
				transform: { x: 600, y: 300 },
				placeholder: { kind: "image" },
				children: [],
			}),
		],
	});
	const ir = createCanvasIR({ id: "doc-1", pages: [page] });
	return {
		...ir,
		assets: {
			"old-asset": { id: "old-asset", uri: "https://cdn/old.png" },
			"lib-asset": { id: "lib-asset", uri: "https://cdn/lib.png" },
		},
	};
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

const uploader: CanvasAssetUploader = {
	upload: async (files) =>
		files.map((f) => ({ id: `up-${f.name}`, uri: `https://cdn/${f.name}` })),
};

function setup(overrides?: { uploader?: CanvasAssetUploader | undefined }) {
	const h = makeHarness({ ir: fixtureIR() });
	h.studioCtx.stage = makeStage();
	h.studioCtx.assetUploader =
		overrides && "uploader" in overrides ? overrides.uploader : uploader;
	h.studioCtx.uploadStore = createUploadStore();
	render(
		<CanvasStudioContext.Provider value={h.studioCtx}>
			<CanvasDropZone>
				<div>content</div>
			</CanvasDropZone>
		</CanvasStudioContext.Provider>,
	);
	return h;
}

function dropAt(
	point: { clientX: number; clientY: number },
	data:
		| { files: readonly File[] }
		| { assetId: string },
): void {
	const zone = screen.getByTestId("canvas-drop-zone");
	const dataTransfer =
		"files" in data
			? { files: data.files, types: ["Files"], getData: () => "" }
			: {
					files: [],
					types: [ASSET_DRAG_MIME],
					getData: (type: string) =>
						type === ASSET_DRAG_MIME ? data.assetId : "",
				};
	const event = createEvent.drop(zone, { dataTransfer });
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

describe("resolveDropTarget (FR-093)", () => {
	const children = () => fixtureIR().pages[0]?.root.children ?? [];

	it("resolves the image node under the point", () => {
		const target = resolveDropTarget(children(), { x: 150, y: 150 });
		expect(target).toMatchObject({ kind: "image", node: { id: "img-1" } });
	});

	it("resolves an empty image-well frame under the point", () => {
		const target = resolveDropTarget(children(), { x: 650, y: 350 });
		expect(target).toMatchObject({ kind: "well", frame: { id: "well-1" } });
	});

	it("never targets locked or hidden images, or empty space", () => {
		expect(resolveDropTarget(children(), { x: 450, y: 150 })).toBeUndefined();
		expect(resolveDropTarget(children(), { x: 150, y: 450 })).toBeUndefined();
		expect(resolveDropTarget(children(), { x: 750, y: 50 })).toBeUndefined();
	});

	it("a plain (non-well) frame is not a target", () => {
		const plain = createFrame({
			id: "plain",
			bounds: { width: 100, height: 100 },
			transform: { x: 0, y: 0 },
			children: [],
		});
		expect(resolveDropTarget([plain], { x: 50, y: 50 })).toBeUndefined();
	});
});

describe("CanvasDropZone drag-to-replace (FR-093)", () => {
	it("a single file dropped on an image replaces it — one atomic batch, crop untouched", async () => {
		const h = setup();
		dropAt({ clientX: 150, clientY: 150 }, { files: [file("new.png")] });
		await waitFor(() => expect(h.commits.length).toBeGreaterThan(0));
		expect(h.studioCtx.commitBatch).toHaveBeenCalledTimes(1);
		expect(h.commits.map((c) => c.type)).toEqual([
			"asset.put",
			"image.replace",
		]);
		const replace = h.commits[1] as CanvasImageReplaceCommand;
		expect(replace).toMatchObject({
			nodeId: "img-1",
			fromAssetId: "old-asset",
			toAssetId: "up-new.png",
		});
		// No node.create: position/size/crop preserved by construction.
		expect(h.commits.some((c) => c.type === "node.create")).toBe(false);
	});

	it("a single file dropped on an empty image well fills the well atomically", async () => {
		const h = setup();
		dropAt({ clientX: 650, clientY: 350 }, { files: [file("new.png")] });
		await waitFor(() => expect(h.commits.length).toBeGreaterThan(0));
		expect(h.studioCtx.commitBatch).toHaveBeenCalledTimes(1);
		expect(h.commits[0]?.type).toBe("asset.put");
		// Well fill: cover-sized child + placeholder patch (existing pipeline).
		expect(h.commits.some((c) => c.type === "node.create")).toBe(true);
		expect(
			h.commits.some(
				(c) => c.type === "node.update" && "nodeId" in c && c.nodeId === "well-1",
			),
		).toBe(true);
	});

	it("a drop on a locked image falls back to insertion", async () => {
		const h = setup();
		dropAt({ clientX: 450, clientY: 150 }, { files: [file("new.png")] });
		await waitFor(() => expect(h.commits.length).toBeGreaterThan(0));
		expect(h.commits.some((c) => c.type === "image.replace")).toBe(false);
		expect(h.commits.some((c) => c.type === "node.create")).toBe(true);
	});

	it("multiple files over an image never replace — they insert as a grid", async () => {
		const h = setup();
		dropAt(
			{ clientX: 150, clientY: 150 },
			{ files: [file("a.png"), file("b.png")] },
		);
		await waitFor(() =>
			expect(h.commits.filter((c) => c.type === "node.create")).toHaveLength(2),
		);
		expect(h.commits.some((c) => c.type === "image.replace")).toBe(false);
	});

	it("a failed upload over an image commits nothing at all", async () => {
		const failing: CanvasAssetUploader = {
			upload: async () => {
				throw new Error("cdn down");
			},
		};
		const h = setup({ uploader: failing });
		dropAt({ clientX: 150, clientY: 150 }, { files: [file("new.png")] });
		await waitFor(() =>
			expect(
				h.studioCtx.uploadStore?.getState().tasks[0]?.status,
			).toBe("failed"),
		);
		expect(h.commits).toHaveLength(0);
	});

	it("an internal asset drag replaces without calling the uploader", async () => {
		const h = setup({ uploader: undefined });
		dropAt({ clientX: 150, clientY: 150 }, { assetId: "lib-asset" });
		await waitFor(() => expect(h.commits.length).toBeGreaterThan(0));
		const replace = h.commits.find(
			(c) => c.type === "image.replace",
		) as CanvasImageReplaceCommand;
		expect(replace).toMatchObject({
			nodeId: "img-1",
			toAssetId: "lib-asset",
		});
		expect(h.commits.some((c) => c.type === "asset.put")).toBe(false);
	});

	it("an internal asset drag over empty space inserts the existing asset", async () => {
		const h = setup({ uploader: undefined });
		dropAt({ clientX: 750, clientY: 50 }, { assetId: "lib-asset" });
		await waitFor(() => expect(h.commits.length).toBeGreaterThan(0));
		expect(h.commits.some((c) => c.type === "node.create")).toBe(true);
		expect(h.commits.some((c) => c.type === "image.replace")).toBe(false);
	});

	it("an unknown internal asset id is ignored", () => {
		const h = setup({ uploader: undefined });
		dropAt({ clientX: 150, clientY: 150 }, { assetId: "no-such-asset" });
		expect(h.commits).toHaveLength(0);
	});
});
