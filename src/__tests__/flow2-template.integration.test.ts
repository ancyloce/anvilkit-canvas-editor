import {
	applyBrandColors,
	type BrandKitDefinition,
	type CanvasIR,
	type CanvasImageNode,
	type CanvasTextNode,
	createCanvasIR,
	createGroup,
	createImage,
	createPage,
	createRect,
	createText,
	walk,
} from "@anvilkit/canvas-core";
import { describe, expect, it, vi } from "vitest";
import type { CanvasStudioContextValue } from "@/context/canvas-studio-context.js";
import { pdfExporter } from "@/header/exporters.js";
import { loadTemplate } from "@/panels/template-actions.js";
import { replaceImage } from "@/selection/frame-image-actions.js";
import type { CanvasTemplateEntry } from "@/templates/template-entry.js";
import { createStaticTemplateProvider } from "@/templates/template-provider.js";
import { makeHarness } from "@/tools/__tests__/_tool-test-helpers.js";

/** Valid 1×1 transparent PNG — the PDF serializer embeds real image bytes. */
const TINY_PNG =
	"data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5CYII=";

vi.mock("../render/rasterize-page.js", () => ({
	rasterizePage: vi.fn(async ({ page }: { page: { id: string } }) => ({
		url: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
		mimeType: "image/png",
		pageId: page.id,
	})),
}));

const FIXED_TS = "2026-05-20T00:00:00.000Z";

/**
 * PRD 0012 §17.4 Flow 2 — Edit a Template, over the REAL history store:
 * search → load → change text → replace an image → apply brand colors →
 * duplicate a page → resize the design → export a multi-page PDF.
 */
function templateDocument(): CanvasIR {
	const page = createPage({
		id: "tpl-p1",
		size: { width: 800, height: 600, unit: "px" },
	});
	page.root = createGroup({
		id: "tpl-root",
		bounds: page.root.bounds,
		children: [
			createRect({
				id: "tpl-bg",
				bounds: { width: 800, height: 600 },
				transform: { x: 0, y: 0 },
				fill: "#ff0000",
			}),
			createText({
				id: "tpl-title",
				bounds: { width: 300, height: 40 },
				transform: { x: 100, y: 60 },
				text: "Summer Sale",
			}),
			createImage({
				id: "tpl-hero",
				assetId: "tpl-asset",
				bounds: { width: 200, height: 150 },
				transform: { x: 300, y: 200 },
			}),
		],
	});
	const ir = createCanvasIR({
		id: "tpl-doc",
		title: "Summer poster",
		pages: [page],
		now: () => FIXED_TS,
	});
	return {
		...ir,
		assets: { "tpl-asset": { id: "tpl-asset", uri: TINY_PNG } },
	};
}

function templateEntry(): CanvasTemplateEntry {
	return {
		id: "tpl-1",
		version: "1",
		title: "Summer poster",
		description: "A seasonal promo poster",
		category: "marketing",
		tags: ["poster", "summer"],
		supportedSizes: [],
		document: templateDocument(),
		variables: [],
		editableSlots: [],
		lockedNodeIds: [],
	};
}

const BRAND_KIT: BrandKitDefinition = {
	id: "brand-1",
	name: "Acme",
	logos: [],
	colors: [{ id: "primary", name: "Primary", value: "#ff0000" }],
	fonts: [],
	typography: [],
	rules: [],
};

function liveSetup() {
	const h = makeHarness();
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
	return h;
}

function firstOfType<T extends { type: string }>(
	ir: CanvasIR,
	type: T["type"],
): T {
	let found: T | undefined;
	walk(ir, ({ node }) => {
		if (!found && node.type === type) found = node as unknown as T;
	});
	if (!found) throw new Error(`no ${type} node in document`);
	return found;
}

describe("Flow 2 — Edit a Template (PRD 0012 §17.4)", () => {
	it("search → load → edit text → replace image → brand colors → duplicate page → resize → multi-page PDF", async () => {
		const h = liveSetup();
		const s = h.studioCtx;

		// 1. Search templates through the provider API.
		const provider = createStaticTemplateProvider([templateEntry()]);
		const results = await provider.search({ text: "summer" });
		expect(results.entries).toHaveLength(1);
		const entry = results.entries[0];
		if (!entry) throw new Error("template not found");
		const noMatch = await provider.search({ text: "winter" });
		expect(noMatch.entries).toHaveLength(0);

		// 2. Load the template (replaces the document as one batch).
		const loaded = loadTemplate(s, entry);
		if (!loaded.ok) throw new Error(`loadTemplate failed: ${loaded.message}`);
		s.activePageId = s.getIR().pages[0]?.id ?? "";
		const title = firstOfType<CanvasTextNode>(s.getIR(), "text");
		expect(title.text).toBe("Summer Sale");

		// 3. Change the text.
		s.commit({
			type: "node.update",
			nodeId: title.id,
			kind: "text",
			patch: { text: "Autumn Sale" },
		});
		expect(firstOfType<CanvasTextNode>(s.getIR(), "text").text).toBe(
			"Autumn Sale",
		);

		// 4. Replace the image through the shared replacement pipeline.
		s.commit({
			type: "asset.put",
			asset: { id: "fresh-asset", uri: TINY_PNG },
		});
		const hero = firstOfType<CanvasImageNode>(s.getIR(), "image");
		const heroBounds = hero.bounds;
		expect(replaceImage(s, hero, "fresh-asset")).toBe(true);
		const replaced = firstOfType<CanvasImageNode>(s.getIR(), "image");
		expect(replaced.assetId).toBe("fresh-asset");
		// Position and size preserved — image.replace only swaps the asset.
		expect(replaced.bounds).toEqual(heroBounds);

		// 5. Apply brand colors: the literal #ff0000 fill becomes a brand token.
		const brandResult = applyBrandColors(s.getIR(), BRAND_KIT);
		expect(brandResult.command).not.toBeNull();
		if (brandResult.command) s.commit(brandResult.command);
		const bg = s
			.getIR()
			.pages[0]?.root.children.find((n) => n.type === "rect");
		if (!bg) throw new Error("background rect missing");
		// The literal fill was lifted into a BrandTokenRef object.
		expect(typeof bg.fill).not.toBe("string");
		expect(bg.fill).toMatchObject({ type: "brand-token", id: "primary" });

		// 6. Duplicate the page.
		const sourcePageId = s.getIR().pages[0]?.id ?? "";
		s.commit({
			type: "page.duplicate",
			sourcePageId,
			newPageId: "dup-1",
		});
		expect(s.getIR().pages).toHaveLength(2);

		// 7. Resize the design, scaling content proportionally.
		s.commit({
			type: "page.resize",
			pageId: sourcePageId,
			from: { width: 800, height: 600 },
			to: { width: 400, height: 300 },
			mode: "scale-content",
		});
		const resized = s.getIR().pages.find((p) => p.id === sourcePageId);
		expect(resized?.size).toMatchObject({ width: 400, height: 300 });

		// 8. Export a multi-page PDF (raster-embed; every page packed into one).
		const artifact = await pdfExporter(
			{ ir: s.getIR(), activePageId: sourcePageId, stage: null },
			{ scope: "all", resolution: 1 } as never,
		);
		expect(artifact.mimeType).toBe("application/pdf");
		expect(artifact.filename.endsWith(".pdf")).toBe(true);
		const bytes = artifact.data as Uint8Array;
		expect(bytes.byteLength).toBeGreaterThan(500);
		// "%PDF" magic at the head — a real document, not a placeholder.
		expect(String.fromCharCode(...bytes.slice(0, 4))).toBe("%PDF");

		// AC-013: page resize undoes/redoes cleanly.
		let ir = s.historyStore.getState().undo(s.getIR());
		h.setIR(ir);
		expect(
			s.getIR().pages.find((p) => p.id === sourcePageId)?.size.width,
		).toBe(800);
		ir = s.historyStore.getState().redo(s.getIR());
		h.setIR(ir);
		expect(
			s.getIR().pages.find((p) => p.id === sourcePageId)?.size.width,
		).toBe(400);
	});
});
