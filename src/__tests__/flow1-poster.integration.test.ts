import {
	type CanvasImageNode,
	type CanvasIR,
	createCanvasIR,
	createPage,
	createRect,
	createText,
	walk,
} from "@anvilkit/canvas-core";
import { describe, expect, it, vi } from "vitest";
import type { CanvasAssetUploader } from "@/assets/adapter-types.js";
import { uploadFilesImpl } from "@/assets/upload-actions.js";
import type { CanvasStudioContextValue } from "@/context/canvas-studio-context.js";
import { pngExporter } from "@/header/exporters.js";
import { createSaveController } from "@/persistence/save-controller.js";
import type { CanvasSaveInput } from "@/persistence/types.js";
import { alignSelection } from "@/selection/align-actions.js";
import { beginCrop, commitCrop } from "@/selection/crop-actions.js";
import { createSaveStatusStore } from "@/stores/save-status-store.js";
import { createUploadStore } from "@/stores/upload-store.js";
import { makeHarness } from "@/tools/__tests__/_tool-test-helpers.js";

const FIXED_TS = "2026-05-20T00:00:00.000Z";
/** Valid 1×1 transparent PNG — exporters must receive decodable image data. */
const TINY_PNG =
	"data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";

/**
 * PRD 0012 §17.4 Flow 1 — Create a Poster, over the REAL history store:
 * blank page → background shape → text → upload an image → crop it → align →
 * save → export PNG. Every document step is a single undo entry.
 */
function fixtureIR(): CanvasIR {
	return createCanvasIR({
		id: "doc-poster",
		title: "Poster",
		pages: [createPage({ id: "p0", size: { width: 800, height: 600 } })],
		now: () => FIXED_TS,
	});
}

function liveSetup() {
	const h = makeHarness({ ir: fixtureIR() });
	const history = h.studioCtx.historyStore;
	const applyCommit: CanvasStudioContextValue["commit"] = (cmd) => {
		const next = history.getState().commit(h.studioCtx.getIR(), cmd);
		h.setIR(next);
		return next;
	};
	const applyBatch: CanvasStudioContextValue["commitBatch"] = (cmds, label) => {
		const next = history
			.getState()
			.commitBatch(h.studioCtx.getIR(), cmds, label);
		h.setIR(next);
		return next;
	};
	h.studioCtx.commit = applyCommit;
	h.studioCtx.commitBatch = applyBatch;
	h.studioCtx.uploadStore = createUploadStore();
	return h;
}

function findImage(ir: CanvasIR): CanvasImageNode {
	let image: CanvasImageNode | undefined;
	walk(ir, ({ node }) => {
		if (node.type === "image") image = node;
	});
	if (!image) throw new Error("no image node in document");
	return image;
}

describe("Flow 1 — Create a Poster (PRD 0012 §17.4)", () => {
	it("blank page → shape → text → upload → crop → align → save → export PNG", async () => {
		const h = liveSetup();
		const s = h.studioCtx;

		// 1. Create a blank page and make it active.
		const page = createPage({ id: "p1", size: { width: 800, height: 600 } });
		s.commit({ type: "page.create", page });
		s.pagesStore.getState().setActivePageId("p1");
		// The harness ctx snapshots activePageId at creation; keep it in sync
		// the way the live provider derives it from pagesStore.
		s.activePageId = "p1";

		// 2. Add a full-bleed background shape.
		const background = createRect({
			id: "bg",
			bounds: { width: 800, height: 600 },
			transform: { x: 0, y: 0 },
			fill: "#123456",
		});
		s.commit({ type: "node.create", node: background, pageId: "p1" });

		// 3. Add text.
		const headline = createText({
			id: "headline",
			bounds: { width: 400, height: 60 },
			transform: { x: 200, y: 40 },
			text: "Grand Opening",
		});
		s.commit({ type: "node.create", node: headline, pageId: "p1" });

		// 4. Upload an image (host adapter) — inserts as ONE batch.
		const uploader: CanvasAssetUploader = {
			upload: async (files) =>
				files.map((f) => ({
					id: `up-${f.name}`,
					uri: TINY_PNG,
					width: 300,
					height: 200,
				})),
		};
		s.assetUploader = uploader;
		const inserted = await uploadFilesImpl(
			s,
			[new File(["x"], "hero.png", { type: "image/png" })],
			{ x: 250, y: 200 },
		);
		expect(inserted).toHaveLength(1);
		expect(s.getIR().assets["up-hero.png"]).toBeDefined();

		// 5. Crop the image through the crop actions (one undo entry).
		const image = findImage(s.getIR());
		expect(beginCrop(s, image.id)).toBe(true);
		s.cropStore
			.getState()
			.setDraft({ x: 0.1, y: 0.1, width: 0.6, height: 0.6 });
		commitCrop(s);
		expect(findImage(s.getIR()).crop).toEqual({
			x: 0.1,
			y: 0.1,
			width: 0.6,
			height: 0.6,
		});

		// 6. Align headline + image to the left edge (one batch).
		s.selectionStore.getState().setSelection(["headline", image.id]);
		alignSelection(s, "left");
		const alignedImage = findImage(s.getIR());
		const alignedText = s
			.getIR()
			.pages.find((p) => p.id === "p1")
			?.root.children.find((n) => n.id === "headline");
		expect(alignedImage.transform.x).toBe(alignedText?.transform.x);

		// 7. Save through the persistence controller: clean checkpoint.
		const saves: CanvasSaveInput[] = [];
		const saveStatusStore = createSaveStatusStore();
		const controller = createSaveController({
			adapter: {
				save: async (input) => {
					saves.push(input);
					return { savedAt: FIXED_TS };
				},
			},
			getIR: s.getIR,
			historyStore: s.historyStore,
			saveStatusStore,
			autoSave: false,
		});
		expect(s.historyStore.getState().isAtSaveCheckpoint()).toBe(false);
		await controller.save();
		expect(saves).toHaveLength(1);
		expect(saves[0]?.ir.id).toBe("doc-poster");
		expect(s.historyStore.getState().isAtSaveCheckpoint()).toBe(true);
		expect(saveStatusStore.getState().status).toBe("saved");
		controller.dispose();

		// 8. Export the poster as PNG off the live stage.
		const stage = {
			toDataURL: () => TINY_PNG,
			scale: () => ({ x: 1, y: 1 }),
			position: () => ({ x: 0, y: 0 }),
			batchDraw: vi.fn(),
		} as unknown as NonNullable<CanvasStudioContextValue["stage"]>;
		const artifact = await pngExporter(
			{ ir: s.getIR(), activePageId: "p1", stage },
			{ scope: "current", resolution: 1 } as never,
		);
		expect(artifact.filename).toBe("Poster.png");
		expect(artifact.mimeType).toBe("image/png");
		expect(artifact.data).toBe(TINY_PNG);

		// AC-013: the poster steps undo one entry at a time — undoing the crop
		// restores the uncropped image without disturbing the align.
		let ir = s.historyStore.getState().undo(s.getIR()); // undo align
		ir = s.historyStore.getState().undo(ir); // undo crop
		h.setIR(ir);
		expect(findImage(s.getIR()).crop).toBeUndefined();
		const redone = s.historyStore.getState().redo(s.getIR());
		h.setIR(redone);
		expect(findImage(s.getIR()).crop).toBeDefined();
	});
});
