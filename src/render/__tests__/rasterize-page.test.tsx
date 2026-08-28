import {
	type CanvasFrameNode,
	type CanvasGroupNode,
	type CanvasImageNode,
	type CanvasRectNode,
	type CanvasSvgNode,
	createCanvasIR,
	createFrame,
	createImage,
	createPage,
	createRect,
	createRichText,
	createSvg,
	createVideo,
	resolveCanvasDocument,
} from "@anvilkit/canvas-core";
import type Konva from "konva";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const stageInstances: Array<{
	toDataURL: ReturnType<typeof vi.fn>;
	destroy: ReturnType<typeof vi.fn>;
	scaleX: ReturnType<typeof vi.fn>;
	scaleY: ReturnType<typeof vi.fn>;
}> = [];
const onReadyCalls: Array<Konva.Stage> = [];
/** Props of every <Group> rendered into the rasterize tree (frames included). */
const groupCalls: Array<Record<string, unknown>> = [];
/** Props of every <Rect> rendered into the rasterize tree. */
const rectCalls: Array<Record<string, unknown>> = [];

vi.mock("react-konva", () => {
	const Group = (props: { children?: ReactNode }) => {
		groupCalls.push(props as Record<string, unknown>);
		return props.children ?? null;
	};
	const Rect = (props: Record<string, unknown>) => {
		rectCalls.push(props);
		return null;
	};
	const Container = ({ children }: { children?: ReactNode }) =>
		children ?? null;
	const Leaf = () => null;
	return {
		Stage: Container,
		Layer: Container,
		Group,
		Rect,
		Ellipse: Leaf,
		Line: Leaf,
		Path: Leaf,
		Text: Leaf,
		Image: Leaf,
		Transformer: Leaf,
	};
});

const useImageMock = vi.fn(() => [null, "loading"] as const);
vi.mock("use-image", () => ({
	default: (...args: unknown[]) =>
		(useImageMock as unknown as (...a: unknown[]) => unknown)(...args),
}));

vi.mock("../../stage/CanvasStage.js", () => ({
	CanvasStage: ({
		children,
		onReady,
	}: {
		children?: ReactNode;
		onReady?: (stage: Konva.Stage) => void;
	}) => {
		const instance = {
			toDataURL: vi.fn(
				(opts?: { mimeType?: string }) =>
					`data:${opts?.mimeType ?? "image/png"};base64,STUB`,
			),
			destroy: vi.fn(),
			scaleX: vi.fn(),
			scaleY: vi.fn(),
		};
		stageInstances.push(instance);
		if (onReady) {
			const stage = instance as unknown as Konva.Stage;
			onReadyCalls.push(stage);
			queueMicrotask(() => onReady(stage));
		}
		return <>{children}</>;
	},
}));

import {
	RasterizePageCancelledError,
	rasterizePage,
} from "../rasterize-page.js";

beforeEach(() => {
	stageInstances.length = 0;
	onReadyCalls.length = 0;
	groupCalls.length = 0;
	rectCalls.length = 0;
	preloadedSrcs.length = 0;
	useImageMock.mockClear();
});

afterEach(() => {
	const stragglers = document.querySelectorAll("[data-rasterize-page]");
	for (const node of Array.from(stragglers)) {
		node.parentNode?.removeChild(node);
	}
	vi.unstubAllGlobals();
});

/** Every `uri` the rasterizer pushed through `loadImage`'s `new Image()`. */
const preloadedSrcs: string[] = [];

/** Swap in an Image that records `src` and resolves `onload` immediately. */
function stubImageLoader(): void {
	class RecordingImage {
		crossOrigin: string | null = null;
		onload: (() => void) | null = null;
		onerror: (() => void) | null = null;
		set src(uri: string) {
			preloadedSrcs.push(uri);
			queueMicrotask(() => this.onload?.());
		}
	}
	vi.stubGlobal("Image", RecordingImage);
}

function buildPage(extraChildren: CanvasGroupNode["children"] = []) {
	const ir = createCanvasIR({
		pages: [createPage({ id: "p1" })],
		now: () => "2026-01-01T00:00:00.000Z",
	});
	const [page] = ir.pages;
	if (!page) throw new Error("createCanvasIR must produce at least one page");
	const rect: CanvasRectNode = {
		id: "r1",
		type: "rect",
		transform: { x: 4, y: 4, rotation: 0, scaleX: 1, scaleY: 1 },
		bounds: { width: 32, height: 32 },
		zIndex: 0,
		fill: "#ff0000",
	};
	const root: CanvasGroupNode = {
		...page.root,
		children: [rect, ...extraChildren],
	};
	return { ...page, root };
}

describe("rasterizePage", () => {
	it("honors cancellation before allocating an offscreen stage", async () => {
		await expect(
			rasterizePage({
				page: buildPage(),
				isCancelled: () => true,
			}),
		).rejects.toBeInstanceOf(RasterizePageCancelledError);
		expect(document.querySelector("[data-rasterize-page]")).toBeNull();
	});
	it("returns a data URL via stage.toDataURL with the requested options", async () => {
		const page = buildPage();
		const result = await rasterizePage({
			page,
			pixelRatio: 3,
			mimeType: "image/webp",
			quality: 0.8,
		});
		expect(stageInstances).toHaveLength(1);
		const stage = stageInstances[0];
		if (!stage) throw new Error("stage was not created");
		expect(stage.toDataURL).toHaveBeenCalledTimes(1);
		const callArgs = stage.toDataURL.mock.calls[0]?.[0] as
			| { pixelRatio?: number; mimeType?: string; quality?: number }
			| undefined;
		expect(callArgs).toMatchObject({
			pixelRatio: 3,
			mimeType: "image/webp",
			quality: 0.8,
		});
		expect(result).toEqual({
			url: "data:image/webp;base64,STUB",
			mimeType: "image/webp",
		});
	});

	it("defaults to png at pixelRatio 2", async () => {
		const page = buildPage();
		const result = await rasterizePage({ page });
		const stage = stageInstances[0];
		if (!stage) throw new Error("stage was not created");
		expect(stage.toDataURL).toHaveBeenCalledTimes(1);
		const callArgs = stage.toDataURL.mock.calls[0]?.[0] as
			| { pixelRatio?: number; mimeType?: string }
			| undefined;
		expect(callArgs?.pixelRatio).toBe(2);
		expect(callArgs?.mimeType).toBe("image/png");
		expect(result.mimeType).toBe("image/png");
	});

	it("removes the off-screen container from the DOM after resolving", async () => {
		const page = buildPage();
		await rasterizePage({ page });
		expect(document.querySelectorAll("[data-rasterize-page]")).toHaveLength(0);
	});

	it("removes the off-screen container even when toDataURL throws", async () => {
		const page = buildPage();
		// Patch the next mock instance so toDataURL throws.
		const originalMock = stageInstances;
		void originalMock;
		// Instead of pre-patching (the mock factory creates the instance after
		// the call starts), wrap the rasterizer with an after-the-fact swap.
		const promise = rasterizePage({ page }).catch((err) => err);
		// Allow the mock factory's queueMicrotask onReady to schedule first.
		await Promise.resolve();
		const stage = stageInstances[0];
		if (!stage) throw new Error("stage was not created");
		stage.toDataURL.mockImplementation(() => {
			throw new Error("synthetic toDataURL failure");
		});
		const result = await promise;
		expect(result).toBeInstanceOf(Error);
		expect(document.querySelectorAll("[data-rasterize-page]")).toHaveLength(0);
	});

	it("walks image nodes when preloading assets without crashing", async () => {
		const imageNode: CanvasImageNode = {
			id: "i1",
			type: "image",
			transform: { x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1 },
			bounds: { width: 32, height: 32 },
			zIndex: 1,
			assetId: "a1",
		};
		const page = buildPage([imageNode]);
		const result = await rasterizePage({
			page,
			assets: { a1: { id: "a1", uri: "data:image/png;base64,iVBORw0=" } },
		});
		expect(result.url.startsWith("data:")).toBe(true);
	});

	it("walks svg nodes when preloading assets, same as image nodes", async () => {
		stubImageLoader();
		const svgNode: CanvasSvgNode = {
			id: "s1",
			type: "svg",
			transform: { x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1 },
			bounds: { width: 32, height: 32 },
			zIndex: 1,
			assetId: "a1",
		};
		const page = buildPage([svgNode]);
		const result = await rasterizePage({
			page,
			assets: { a1: { id: "a1", uri: "data:image/svg+xml;base64,PHN2Zz4=" } },
		});
		expect(result.url.startsWith("data:")).toBe(true);
		expect(preloadedSrcs).toContain("data:image/svg+xml;base64,PHN2Zz4=");
	});

	// Regression: a video node's poster is an asset-id reference resolved the
	// same way as an image/svg's, but `collectImageAssetIds` never walked
	// `"video"` nodes — the poster was left unpreloaded and could rasterize
	// blank if `useImage` hadn't already settled by capture time (E-12).
	it("preloads a video node's poster image, same as image nodes", async () => {
		stubImageLoader();
		const videoNode = createVideo({
			id: "v1",
			bounds: { width: 32, height: 32 },
			assetId: "video-asset",
			poster: "poster-asset",
		});
		const page = buildPage([videoNode]);
		const result = await rasterizePage({
			page,
			assets: {
				"poster-asset": {
					id: "poster-asset",
					uri: "data:image/png;base64,POSTER=",
				},
			},
		});
		expect(result.url.startsWith("data:")).toBe(true);
		expect(preloadedSrcs).toContain("data:image/png;base64,POSTER=");
	});

	it("does not attempt to preload a video node without a poster", async () => {
		const videoNode = createVideo({
			id: "v1",
			bounds: { width: 32, height: 32 },
			assetId: "video-asset",
		});
		const page = buildPage([videoNode]);
		const result = await rasterizePage({ page, assets: {} });
		expect(result.url.startsWith("data:")).toBe(true);
		expect(preloadedSrcs).toHaveLength(0);
	});

	// PDF/PNG export fidelity (canvas-m1-003) rides on the rasterizer honouring
	// the frame's clip — it renders through the same CanvasNodeRenderer as the
	// live stage, so the clip must reach the Konva tree here too.
	it("clips a frame's children in the rasterized tree", async () => {
		const frame = createFrame({
			id: "f1",
			bounds: { width: 120, height: 80 },
			clip: true,
			children: [
				createRect({ id: "clipped", bounds: { width: 999, height: 999 } }),
			],
		});
		await rasterizePage({ page: buildPage([frame]) });
		const frameGroup = groupCalls.find((p) => p.id === "f1");
		expect(frameGroup).toBeDefined();
		expect(frameGroup?.clipWidth).toBe(120);
		expect(frameGroup?.clipHeight).toBe(80);
	});

	it("emits a rounded clipFunc for a frame with a radius", async () => {
		const frame = createFrame({
			id: "f1",
			bounds: { width: 120, height: 80 },
			clip: true,
			radius: 10,
			children: [createRect({ id: "c", bounds: { width: 10, height: 10 } })],
		});
		await rasterizePage({ page: buildPage([frame]) });
		const frameGroup = groupCalls.find((p) => p.id === "f1");
		const clipFunc = frameGroup?.clipFunc as
			| ((ctx: { roundRect: (...a: number[]) => void }) => void)
			| undefined;
		expect(clipFunc).toBeTypeOf("function");
		const ctx = { roundRect: vi.fn() };
		clipFunc?.(ctx);
		expect(ctx.roundRect).toHaveBeenCalledWith(0, 0, 120, 80, 10);
	});

	// cp4-003 (ADR 0008 decision 2): PNG/JPEG/WebP *and* PDF all rasterize
	// through this function — `pdfExporter` calls `rasterizePage` per page and
	// hands the data URLs to core's raster-embed `serializeDocumentToPdf` — so a
	// shape clip reaching the Konva tree HERE is what gives raster and PDF export
	// shape clipping. There is no second code path to keep in step: the clip is
	// emitted by the same `CanvasNodeRenderer` the live stage uses.
	it("emits a shape clipFunc for a shaped frame in the rasterized tree", async () => {
		const frame: CanvasFrameNode = {
			...createFrame({
				id: "f1",
				bounds: { width: 120, height: 80 },
				clip: true,
				children: [
					createRect({ id: "clipped", bounds: { width: 999, height: 999 } }),
				],
			}),
			shape: { kind: "ellipse" },
		};
		await rasterizePage({ page: buildPage([frame]) });
		const frameGroup = groupCalls.find((p) => p.id === "f1");
		// A shape clip can never ride the declarative box props.
		expect(frameGroup?.clipWidth).toBeUndefined();
		const clipFunc = frameGroup?.clipFunc as
			| ((ctx: { ellipse: (...a: number[]) => void }) => void)
			| undefined;
		expect(clipFunc).toBeTypeOf("function");
		const ctx = { ellipse: vi.fn() };
		clipFunc?.(ctx);
		expect(ctx.ellipse).toHaveBeenCalledWith(60, 40, 60, 40, 0, 0, Math.PI * 2);
	});

	// Regression: `collectImageAssetIds` used to recurse only into groups, so an
	// image inside a frame was never preloaded and could rasterize blank.
	// Plan 0023 M6-02: a component's images live in the DEFINITION tree, not the
	// page, so preloading from the raw page would miss them and every image
	// inside a component would race `use-image` and rasterize blank.
	it("preloads image assets that only exist inside a component's Source", async () => {
		stubImageLoader();
		const instance = {
			type: "component-instance",
			id: "inst-1",
			source: { kind: "local", componentId: "cmp-card" },
			transform: { x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1 },
			bounds: { width: 64, height: 64 },
			zIndex: 0,
		} as unknown as CanvasRectNode;
		const page = buildPage([instance]);
		const ir = {
			...createCanvasIR({ id: "doc", title: "t", pages: [page] }),
			components: {
				"cmp-card": {
					id: "cmp-card",
					name: "Card",
					revision: 1,
					properties: [],
					root: createFrame({
						id: "src-root",
						bounds: { width: 64, height: 64 },
						children: [
							createImage({
								id: "src-img",
								bounds: { width: 32, height: 32 },
								assetId: "in-component",
							}),
						],
					}),
				},
			},
		};
		const assets = {
			"in-component": {
				id: "in-component",
				uri: "data:image/png;base64,INCOMPONENT=",
			},
		};
		await rasterizePage({
			page,
			assets,
			// The COMPOSED resolution is what carries the expansion; a layout-only
			// one would leave the instance unexpanded and the asset unseen.
			resolvedDocument: resolveCanvasDocument(
				{ ...ir, assets } as Parameters<typeof resolveCanvasDocument>[0],
				{},
			),
		});
		expect(preloadedSrcs).toContain("data:image/png;base64,INCOMPONENT=");
	});

	it("preloads image assets nested inside a frame", async () => {
		stubImageLoader();
		const frame = createFrame({
			id: "f1",
			bounds: { width: 100, height: 100 },
			clip: true,
			children: [
				createImage({
					id: "i-in-frame",
					bounds: { width: 32, height: 32 },
					assetId: "nested",
				}),
			],
		});
		await rasterizePage({
			page: buildPage([frame]),
			assets: {
				nested: { id: "nested", uri: "data:image/png;base64,NESTED=" },
			},
		});
		expect(preloadedSrcs).toContain("data:image/png;base64,NESTED=");
	});

	// canvas-m1-008 acceptance criterion: rich text renders in rasterizePage
	// output. `Text` is mocked to a no-op leaf here (this file only asserts
	// structure/wiring), so the meaningful check is that the real
	// `CanvasRichTextNodeRenderer` runs end-to-end without throwing and its
	// clip wiring reaches the Group exactly like every other node kind's does
	// — per-run text content/styling is covered by
	// `stage/__tests__/CanvasNodeRenderer.test.tsx`.
	it("renders a rich-text node without throwing, with overflow clip wired to its Group", async () => {
		const richText = createRichText({
			id: "rt1",
			bounds: { width: 120, height: 40 },
			height: 40,
			overflow: "clip",
			paragraphs: [{ spans: [{ text: "Hello rich text" }] }],
		});
		await rasterizePage({ page: buildPage([richText]) });
		const richTextGroup = groupCalls.find((g) => g.id === "rt1");
		expect(richTextGroup).toBeDefined();
		expect(richTextGroup?.clipWidth).toBe(120);
		expect(richTextGroup?.clipHeight).toBe(40);
	});

	// canvas-m1-013: the rasterizer must resolve `BrandTokenRef` fills the
	// SAME way the live stage does — "one resolver, three consumers" — so a
	// raster export of a token-filled node isn't blank/wrong relative to the
	// canvas the user is looking at.
	it("resolves a color-token fill against a provided brandKit", async () => {
		const tokenRect: CanvasRectNode = {
			id: "r-token",
			type: "rect",
			transform: { x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1 },
			bounds: { width: 10, height: 10 },
			zIndex: 2,
			fill: { type: "brand-token", tokenType: "color", id: "brand.primary" },
		};
		await rasterizePage({
			page: buildPage([tokenRect]),
			brandKit: {
				colors: [{ id: "brand.primary", name: "Primary", value: "#2563eb" }],
				fonts: [],
			},
		});
		expect(rectCalls.some((p) => p.fill === "#2563eb")).toBe(true);
	});

	it("degrades a color-token fill to no fill when rasterized without a brandKit, without throwing", async () => {
		const tokenRect: CanvasRectNode = {
			id: "r-token",
			type: "rect",
			transform: { x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1 },
			bounds: { width: 10, height: 10 },
			zIndex: 2,
			fill: { type: "brand-token", tokenType: "color", id: "brand.primary" },
		};
		await expect(
			rasterizePage({ page: buildPage([tokenRect]) }),
		).resolves.toMatchObject({ mimeType: "image/png" });
		const tokenRectCall = rectCalls.find(
			(p) => p.width === 10 && p.height === 10,
		);
		expect(tokenRectCall?.fill).toBeUndefined();
	});

	// Bug 1 (FR-153 custom size): an unlocked, non-proportional width × height
	// pair must actually reach the rasterizer instead of being silently
	// collapsed to a single width-derived ratio.
	// K-17. The rasterizer preloads and decodes every asset, but the renderer
	// used to go through `use-image` and start its OWN load — so this function
	// had nothing to wait on and guessed with two animation frames. Handing the
	// decoded elements down makes the first render already-loaded.
	describe("decoded image handoff", () => {
		it("renders the preloaded element without starting a second load", async () => {
			stubImageLoader();
			const imageNode: CanvasImageNode = {
				id: "i1",
				type: "image",
				transform: { x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1 },
				bounds: { width: 32, height: 32 },
				zIndex: 1,
				assetId: "a1",
			};
			const uri = "data:image/png;base64,iVBORw0=";
			await rasterizePage({
				page: buildPage([imageNode]),
				assets: { a1: { id: "a1", uri } },
			});

			// Exactly ONE element was ever constructed for this asset: the
			// preload's. Without the handoff `use-image` built a second one, and
			// the export raced it.
			expect(preloadedSrcs.filter((src) => src === uri)).toHaveLength(1);
			// And the renderer drew that element rather than the loading
			// placeholder — an image node reaching Konva at all proves it
			// resolved, since an unloaded one renders nothing in an export pass.
			expect(useImageMock).not.toHaveBeenCalledWith(uri, "anonymous");
		});

		it("still falls back to use-image when the preload could not decode", async () => {
			// No `stubImageLoader`, so jsdom's Image never fires onload and the
			// preload times out with an empty map.
			const imageNode: CanvasImageNode = {
				id: "i1",
				type: "image",
				transform: { x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1 },
				bounds: { width: 32, height: 32 },
				zIndex: 1,
				assetId: "a1",
			};
			const result = await rasterizePage({
				page: buildPage([imageNode]),
				assets: { a1: { id: "a1", uri: "https://example.test/x.png" } },
			});
			// The export still completes; the renderer took the legacy path.
			expect(result.url.startsWith("data:")).toBe(true);
			expect(useImageMock).toHaveBeenCalledWith(
				"https://example.test/x.png",
				"anonymous",
			);
		});
	});

	// K-17. Konva measures and draws text with whatever font is resolved at
	// draw time, so serializing while a web font is still in flight bakes the
	// fallback face — and its metrics — into the export.
	describe("font readiness", () => {
		it("does not serialize until in-flight fonts have resolved", async () => {
			let resolveFonts: (() => void) | undefined;
			const ready = new Promise<void>((r) => {
				resolveFonts = r;
			});
			const original = (document as { fonts?: unknown }).fonts;
			Object.defineProperty(document, "fonts", {
				value: { ready },
				configurable: true,
			});
			try {
				const run = rasterizePage({ page: buildPage() });
				// Long enough that BOTH `waitFrame()` rAF ticks have fired (jsdom
				// schedules them ~16ms apart) — otherwise this would pass on the
				// frame waits alone and say nothing about the font gate.
				await new Promise((r) => setTimeout(r, 120));
				const stage = stageInstances[0];
				if (!stage) throw new Error("stage was not created");
				expect(stage.toDataURL).not.toHaveBeenCalled();

				resolveFonts?.();
				await run;
				expect(stage.toDataURL).toHaveBeenCalledTimes(1);
			} finally {
				Object.defineProperty(document, "fonts", {
					value: original,
					configurable: true,
				});
			}
		});

		it("serializes anyway when the environment has no font API", async () => {
			const original = (document as { fonts?: unknown }).fonts;
			Object.defineProperty(document, "fonts", {
				value: undefined,
				configurable: true,
			});
			try {
				const result = await rasterizePage({ page: buildPage() });
				expect(result.url.startsWith("data:")).toBe(true);
			} finally {
				Object.defineProperty(document, "fonts", {
					value: original,
					configurable: true,
				});
			}
		});
	});

	// K-2. `toDataURL` with no rect resolves its origin and size from
	// `getClientRect()` — for a Stage, the union of every visible child, taken
	// WITH stroke/shadow and BEFORE any clip. So the exported size used to
	// follow the content rather than the page. react-konva is mocked here, so
	// what these tests pin is the mechanism that makes content irrelevant: an
	// explicit page rect on every call.
	describe("capture rectangle", () => {
		it("captures the page rect", async () => {
			const page = buildPage();
			await rasterizePage({ page });
			const stage = stageInstances[0];
			if (!stage) throw new Error("stage was not created");
			expect(stage.toDataURL.mock.calls[0]?.[0]).toMatchObject({
				x: 0,
				y: 0,
				width: page.size.width,
				height: page.size.height,
			});
		});

		it("captures the page rect even with a node overhanging the page edge", async () => {
			// The node that used to grow the export: it starts inside the page and
			// extends well past its right/bottom edge.
			const overhang: CanvasRectNode = {
				id: "overhang",
				type: "rect",
				transform: {
					x: 1000,
					y: 1000,
					rotation: 0,
					scaleX: 1,
					scaleY: 1,
				},
				bounds: { width: 900, height: 900 },
				zIndex: 1,
				fill: "#00ff00",
			};
			const page = buildPage([overhang]);
			await rasterizePage({ page });
			const stage = stageInstances[0];
			if (!stage) throw new Error("stage was not created");
			expect(stage.toDataURL.mock.calls[0]?.[0]).toMatchObject({
				x: 0,
				y: 0,
				width: page.size.width,
				height: page.size.height,
			});
		});

		// FR-150 transparent background. This path has no page-sized <Rect> at
		// all, so nothing anchored the client-rect union at (0,0) — the export
		// cropped to whatever the content spanned, at whatever origin it began.
		it("captures the page rect when the background is excluded", async () => {
			const page = buildPage();
			await rasterizePage({ page, includeBackground: false });
			const stage = stageInstances[0];
			if (!stage) throw new Error("stage was not created");
			expect(stage.toDataURL.mock.calls[0]?.[0]).toMatchObject({
				x: 0,
				y: 0,
				width: page.size.width,
				height: page.size.height,
			});
		});
	});

	describe("independent x/y pixelRatio (FR-153 custom size, Bug 1)", () => {
		it("uses a single Konva pixelRatio when x and y match", async () => {
			const page = buildPage();
			await rasterizePage({ page, pixelRatio: { x: 4, y: 4 } });
			const stage = stageInstances[0];
			if (!stage) throw new Error("stage was not created");
			expect(stage.scaleX).not.toHaveBeenCalled();
			expect(stage.scaleY).not.toHaveBeenCalled();
			const callArgs = stage.toDataURL.mock.calls[0]?.[0] as
				| { pixelRatio?: number }
				| undefined;
			expect(callArgs?.pixelRatio).toBe(4);
		});

		it("stretches non-proportionally via stage.scaleX/scaleY when x and y differ", async () => {
			const page = buildPage();
			const result = await rasterizePage({
				page,
				pixelRatio: { x: 3, y: 5 },
			});
			const stage = stageInstances[0];
			if (!stage) throw new Error("stage was not created");
			expect(stage.scaleX).toHaveBeenCalledWith(3);
			expect(stage.scaleY).toHaveBeenCalledWith(5);
			const callArgs = stage.toDataURL.mock.calls[0]?.[0] as
				| { pixelRatio?: number }
				| undefined;
			// The x/y stretch already encodes the full target scale via Konva's
			// own axis scale — no additional uniform pixelRatio multiplier.
			expect(callArgs?.pixelRatio).toBe(1);
			expect(result.url.startsWith("data:")).toBe(true);
		});

		// The capture rect is in POST-scale units here: `_toKonvaCanvas` sizes
		// its canvas from `config.width` and then draws the scene THROUGH the
		// stage transform, so the requested output is `page × per-axis ratio`.
		it("requests a rect scaled per axis when x and y differ", async () => {
			const page = buildPage();
			await rasterizePage({ page, pixelRatio: { x: 3, y: 5 } });
			const stage = stageInstances[0];
			if (!stage) throw new Error("stage was not created");
			expect(stage.toDataURL.mock.calls[0]?.[0]).toMatchObject({
				x: 0,
				y: 0,
				width: page.size.width * 3,
				height: page.size.height * 5,
			});
		});
	});
});
