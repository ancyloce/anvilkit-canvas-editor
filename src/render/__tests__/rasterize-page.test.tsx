import {
	type CanvasGroupNode,
	type CanvasImageNode,
	type CanvasRectNode,
	createCanvasIR,
	createFrame,
	createImage,
	createPage,
	createRect,
} from "@anvilkit/canvas-core";
import type Konva from "konva";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const stageInstances: Array<{
	toDataURL: ReturnType<typeof vi.fn>;
	destroy: ReturnType<typeof vi.fn>;
}> = [];
const onReadyCalls: Array<Konva.Stage> = [];
/** Props of every <Group> rendered into the rasterize tree (frames included). */
const groupCalls: Array<Record<string, unknown>> = [];

vi.mock("react-konva", () => {
	const Group = (props: { children?: ReactNode }) => {
		groupCalls.push(props as Record<string, unknown>);
		return props.children ?? null;
	};
	const Container = ({ children }: { children?: ReactNode }) =>
		children ?? null;
	const Leaf = () => null;
	return {
		Stage: Container,
		Layer: Container,
		Group,
		Rect: Leaf,
		Ellipse: Leaf,
		Line: Leaf,
		Path: Leaf,
		Text: Leaf,
		Image: Leaf,
		Transformer: Leaf,
	};
});

vi.mock("use-image", () => ({
	default: () => [null, "loading"],
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

import { rasterizePage } from "../rasterize-page.js";

beforeEach(() => {
	stageInstances.length = 0;
	onReadyCalls.length = 0;
	groupCalls.length = 0;
	preloadedSrcs.length = 0;
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

	// Regression: `collectImageAssetIds` used to recurse only into groups, so an
	// image inside a frame was never preloaded and could rasterize blank.
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
});
