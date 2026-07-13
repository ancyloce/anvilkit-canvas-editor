import type { CanvasSizePreset } from "@anvilkit/canvas-core";
import { createRect } from "@anvilkit/canvas-core";
import { describe, expect, it } from "vitest";
import { makeHarness } from "@/tools/__tests__/_tool-test-helpers.js";
import { resizeActivePageToVariants } from "../campaign-resize-actions.js";

const instagramPost: CanvasSizePreset = {
	id: "instagram-post",
	version: "1",
	label: "Instagram Post",
	width: 1080,
	height: 1080,
	unit: "px",
};

const youtubeThumbnail: CanvasSizePreset = {
	id: "youtube-thumbnail",
	version: "1",
	label: "YouTube Thumbnail",
	width: 1280,
	height: 720,
	unit: "px",
};

describe("resizeActivePageToVariants", () => {
	it("commits one batch and returns the generated page ids", () => {
		const { studioCtx, commits } = makeHarness({ pageId: "p1" });
		const result = resizeActivePageToVariants(studioCtx, "p1", [
			instagramPost,
			youtubeThumbnail,
		]);
		expect(result.ok).toBe(true);
		if (!result.ok) throw new Error("expected ok result");
		expect(result.pageIds).toHaveLength(2);
		expect(commits).toHaveLength(1);
		expect(commits[0]?.type).toBe("batch");
	});

	it("switches to the first generated variant page", () => {
		const { studioCtx } = makeHarness({ pageId: "p1" });
		const result = resizeActivePageToVariants(studioCtx, "p1", [instagramPost]);
		if (!result.ok) throw new Error("expected ok result");
		expect(studioCtx.pagesStore.getState().activePageId).toBe(
			result.pageIds[0],
		);
	});

	it("returns ok:false with a message for an unknown source page, without committing", () => {
		const { studioCtx, commits } = makeHarness({ pageId: "p1" });
		const result = resizeActivePageToVariants(studioCtx, "nope", [
			instagramPost,
		]);
		expect(result.ok).toBe(false);
		if (result.ok) throw new Error("expected error result");
		expect(result.message).toMatch(/no page with id/);
		expect(commits).toHaveLength(0);
	});

	it("copies the source page's content into the generated variant", () => {
		const { studioCtx, ir, commits } = makeHarness({ pageId: "p1" });
		const page = ir.pages[0];
		if (page) {
			page.root.children.push(
				createRect({ id: "r1", bounds: { width: 10, height: 10 } }),
			);
		}
		const result = resizeActivePageToVariants(studioCtx, "p1", [instagramPost]);
		expect(result.ok).toBe(true);
		const batch = commits[0];
		if (!batch || batch.type !== "batch") throw new Error("expected a batch");
		const created = batch.commands[0];
		if (!created || created.type !== "page.create") {
			throw new Error("expected a page.create");
		}
		expect(created.page.size).toEqual({
			width: 1080,
			height: 1080,
			unit: "px",
		});
		expect(created.page.root.children).toHaveLength(1);
	});
});
