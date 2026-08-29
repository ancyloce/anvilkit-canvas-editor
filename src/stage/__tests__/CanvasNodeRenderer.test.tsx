import {
	type CanvasFrameNode,
	type CanvasFrameShape,
	type CanvasImageNode,
	computePolygonVertices,
	computeStarVertices,
	createAudio,
	createCanvasIR,
	createEllipse,
	createFrame,
	createGroup,
	createImage,
	createLine,
	createPage,
	createPolygon,
	createRect,
	createRichText,
	createStar,
	createSvg,
	createText,
	createVideo,
} from "@anvilkit/canvas-core";
import { cleanup, render, waitFor } from "@testing-library/react";
import { type ReactNode, useEffect } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * The imperative half of a Konva node. Real react-konva attaches a
 * `Konva.Node` to whatever `ref` a renderer passes, so anything driven through
 * that handle — `AdjustedKonvaImage`'s filter cache (E-11) — is invisible
 * behind a props-only mock. Only the methods the renderer actually calls are
 * stubbed.
 */
type KonvaNodeStub = {
	cache: ReturnType<typeof vi.fn>;
	clearCache: ReturnType<typeof vi.fn>;
	getLayer: () => null;
};
/**
 * Real react-konva accepts either form, and the renderer now uses BOTH: the
 * `commonProps` node-registry ref (K-6) is a callback, while
 * `AdjustedKonvaImage` keeps an object ref for its filter cache and composes
 * the two. The mock has to honour whichever it is handed, or the cache handle
 * silently never arrives.
 */
type KonvaNodeRef =
	| { current: KonvaNodeStub | null }
	| ((node: KonvaNodeStub | null) => unknown);

type ElementCall = {
	type: string;
	props: Record<string, unknown>;
	/** The stub attached to this element's `ref`, or null when it had none. */
	node: KonvaNodeStub | null;
};
const calls: ElementCall[] = [];

// One stub per ref, so the same instance survives re-renders the way a real
// Konva node does (and its call counts stay comparable across them). Callback
// refs are stable per node id, so they key this map just as well as an object.
const nodeStubs = new WeakMap<object, KonvaNodeStub>();

function attachNodeStub(ref: KonvaNodeRef): KonvaNodeStub {
	let stub = nodeStubs.get(ref);
	if (!stub) {
		stub = { cache: vi.fn(), clearCache: vi.fn(), getLayer: () => null };
		nodeStubs.set(ref, stub);
	}
	if (typeof ref === "function") ref(stub);
	else ref.current = stub;
	return stub;
}

function makeMock(type: string) {
	return (props: Record<string, unknown>) => {
		// React 19 hands `ref` to function components as an ordinary prop.
		const ref = props.ref as KonvaNodeRef | undefined;
		calls.push({ type, props, node: ref ? attachNodeStub(ref) : null });
		const { children } = props as { children?: ReactNode };
		return (
			<div data-testid={type} data-id={props.id as string}>
				{children}
			</div>
		);
	};
}

vi.mock("react-konva", () => ({
	Group: makeMock("Group"),
	Rect: makeMock("Rect"),
	Ellipse: makeMock("Ellipse"),
	RegularPolygon: makeMock("RegularPolygon"),
	Star: makeMock("Star"),
	Line: makeMock("Line"),
	Path: makeMock("Path"),
	Text: makeMock("Text"),
	Image: makeMock("Image"),
}));

const useImageMock = vi.fn(() => [null, "loading"]);
vi.mock("use-image", () => ({
	default: (uri: string, crossOrigin?: string) =>
		useImageMock(uri, crossOrigin),
}));

import {
	CanvasStudioContext,
	type CanvasStudioContextValue,
} from "@/context/canvas-studio-context.js";
import {
	CanvasToastContext,
	type CanvasToastInput,
} from "@/context/toast-context.js";
import { CanvasSimplifiedEffectsContext } from "@/stage/isolation-render-context.js";
import { createAiJobStore } from "@/stores/ai-job-store.js";
import type { BrandKit } from "../../brand/brand-kit.js";
import { resetFontStatusesForTests } from "../../text/font-status.js";
import { CanvasAssetsContext } from "../CanvasAssetsContext.js";
import { CanvasBrandKitContext } from "../CanvasBrandKitContext.js";
import {
	CanvasNodeRenderer,
	resetMissingAssetToastForTests,
} from "../CanvasNodeRenderer.js";

function callsOfType(type: string): ElementCall[] {
	return calls.filter((c) => c.type === type);
}

describe("CanvasNodeRenderer", () => {
	beforeEachReset();

	it("dispatches to Group + recurses children", () => {
		const rect = createRect({
			id: "r1",
			bounds: { width: 10, height: 10 },
		});
		const inner = createGroup({
			id: "g-inner",
			bounds: { width: 20, height: 20 },
			children: [rect],
		});
		const outer = createGroup({
			id: "g-outer",
			bounds: { width: 30, height: 30 },
			children: [inner],
		});
		render(<CanvasNodeRenderer node={outer} />);
		expect(callsOfType("Group")).toHaveLength(2);
		expect(callsOfType("Rect")).toHaveLength(1);
		// Outermost Group emitted with id matching outer.
		expect(callsOfType("Group")[0]?.props.id).toBe("g-outer");
	});

	it("dispatches to Rect with bounds + fill + transform", () => {
		const rect = createRect({
			id: "r1",
			bounds: { width: 100, height: 50 },
			fill: "#abc",
			transform: { x: 5, y: 10 },
		});
		render(<CanvasNodeRenderer node={rect} />);
		const p = callsOfType("Rect")[0]?.props;
		expect(p?.id).toBe("r1");
		expect(p?.width).toBe(100);
		expect(p?.height).toBe(50);
		expect(p?.fill).toBe("#abc");
		expect(p?.x).toBe(5);
		expect(p?.y).toBe(10);
	});

	it("dispatches to Ellipse with center-translated x/y", () => {
		const e = createEllipse({
			id: "e1",
			bounds: { width: 40, height: 20 },
			transform: { x: 100, y: 200 },
		});
		render(<CanvasNodeRenderer node={e} />);
		const p = callsOfType("Ellipse")[0]?.props;
		expect(p?.radiusX).toBe(20);
		expect(p?.radiusY).toBe(10);
		// Centered: x' = x + radiusX, y' = y + radiusY
		expect(p?.x).toBe(120);
		expect(p?.y).toBe(210);
	});

	it("dispatches to RegularPolygon with center-translated x/y and sides", () => {
		const p = createPolygon({
			id: "poly1",
			bounds: { width: 40, height: 20 },
			transform: { x: 100, y: 200 },
			sides: 6,
		});
		render(<CanvasNodeRenderer node={p} />);
		const props = callsOfType("RegularPolygon")[0]?.props;
		expect(props?.sides).toBe(6);
		expect(props?.radius).toBe(20);
		// Centered: x' = x + radius, y' = y + radius
		expect(props?.x).toBe(120);
		expect(props?.y).toBe(210);
		// Non-square bounds: aspect-fit scaleY = height / width = 20 / 40.
		expect(props?.scaleY).toBe(0.5);
	});

	it("dispatches to Star with center-translated x/y, points, and radii", () => {
		const s = createStar({
			id: "star1",
			bounds: { width: 40, height: 20 },
			transform: { x: 50, y: 60 },
			points: 5,
			innerRadiusRatio: 0.5,
		});
		render(<CanvasNodeRenderer node={s} />);
		const props = callsOfType("Star")[0]?.props;
		expect(props?.numPoints).toBe(5);
		expect(props?.outerRadius).toBe(20);
		expect(props?.innerRadius).toBe(10);
		expect(props?.x).toBe(70);
		expect(props?.y).toBe(70);
		expect(props?.scaleY).toBe(0.5);
	});

	it("dispatches to Line with points", () => {
		const line = createLine({
			id: "ln1",
			points: [0, 0, 100, 50],
			stroke: "#000",
		});
		render(<CanvasNodeRenderer node={line} />);
		const p = callsOfType("Line")[0]?.props;
		expect(p?.points).toEqual([0, 0, 100, 50]);
		expect(p?.stroke).toBe("#000");
	});

	it("dispatches to Path with SVG data", () => {
		const path = {
			id: "p1",
			type: "path" as const,
			transform: { x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1 },
			bounds: { width: 50, height: 50 },
			zIndex: 0,
			d: "M 0 0 L 10 10",
		};
		render(<CanvasNodeRenderer node={path} />);
		const p = callsOfType("Path")[0]?.props;
		expect(p?.data).toBe("M 0 0 L 10 10");
	});

	/**
	 * A `Konva.Path` whose data yields no measurable point reports an all-`NaN`
	 * client rect, and a container unions its children's rects with
	 * `Math.min`/`Math.max` — so ONE such node turns its whole ancestor chain's
	 * box into `NaN`. `Konva.Transformer` then reads that box and writes `NaN`
	 * onto every selected node's `rotation`/`scaleX`/… The IR only requires
	 * `d.length >= 1`, so `"Z"` and friends are valid documents.
	 */
	it.each(["", "Z", "M", "garbage"])(
		"draws no Path for unmeasurable path data %o",
		(d) => {
			render(
				<CanvasNodeRenderer
					node={{
						id: "p-bad",
						type: "path" as const,
						transform: { x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1 },
						bounds: { width: 50, height: 50 },
						zIndex: 0,
						d,
					}}
				/>,
			);
			expect(callsOfType("Path")).toHaveLength(0);
		},
	);

	/**
	 * Undrawable is not the same as absent. Every geometry lookup goes through
	 * `findNodeById(stage, id)` — selection box, `measureSelection`,
	 * `collectTransformEndCommands`, the Transformer — so rendering NOTHING made
	 * a schema-valid path (`d.length >= 1` admits `"Z"`, and SVG import produces
	 * it) unselectable and untransformable, with no selection border or handles
	 * even when picked from the LayerPanel and no diagnostic anywhere.
	 */
	it.each(["", "Z", "M", "garbage"])(
		"keeps an unmeasurable path ADDRESSABLE via a placeholder %o",
		(d) => {
			render(
				<CanvasNodeRenderer
					node={{
						id: "p-bad",
						type: "path" as const,
						transform: { x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1 },
						bounds: { width: 50, height: 50 },
						zIndex: 0,
						d,
					}}
				/>,
			);
			const placeholder = callsOfType("Rect").find(
				(c) => c.props.id === "p-bad",
			)?.props;
			expect(placeholder).toBeDefined();
			// `name` is what `findHitNodeId`/`findNodeById` walk up to.
			expect(placeholder?.name).toBe("p-bad");
			expect(placeholder?.width).toBe(50);
			expect(placeholder?.height).toBe(50);
			// Nothing is painted, so it must not swallow clicks meant for what is
			// underneath it.
			expect(placeholder?.listening).toBe(false);
		},
	);

	it("never hands Konva a non-finite transform or bounds", () => {
		render(
			<CanvasNodeRenderer
				node={createRect({
					id: "r-nan",
					transform: {
						x: Number.NaN,
						y: 4,
						rotation: Number.NaN,
						scaleX: Number.POSITIVE_INFINITY,
						scaleY: 1,
					},
					bounds: { width: Number.NaN, height: 10 },
				})}
			/>,
		);
		const p = callsOfType("Rect")[0]?.props;
		expect(p).toMatchObject({ x: 0, y: 4, rotation: 0, scaleX: 1, scaleY: 1 });
		expect(p?.width).toBe(0);
		expect(p?.height).toBe(10);
	});

	it("clamps a non-finite opacity to 1", () => {
		render(
			<CanvasNodeRenderer
				node={{
					...createRect({ id: "r-op", bounds: { width: 10, height: 10 } }),
					opacity: Number.NaN,
				}}
			/>,
		);
		expect(callsOfType("Rect")[0]?.props.opacity).toBe(1);
	});

	/**
	 * The aspect-fit factor polygon/star layer on top of their own `scaleY`
	 * divides by `bounds.width`; a non-finite bound would otherwise reach Konva
	 * as a `NaN` scale, which is one of the matrix entries
	 * `Transform.decompose()` turns into a `NaN` rotation.
	 */
	it("keeps polygon aspect-fit scaleY finite for degenerate bounds", () => {
		render(
			<CanvasNodeRenderer
				node={createPolygon({
					id: "poly-nan",
					sides: 5,
					bounds: { width: 40, height: Number.NaN },
				})}
			/>,
		);
		expect(callsOfType("RegularPolygon")[0]?.props.scaleY).toBe(0);
	});

	it("dispatches to Text with text + font + alignment", () => {
		const text = createText({
			id: "t1",
			bounds: { width: 200, height: 24 },
			text: "hello",
			fontFamily: "Inter",
			fontSize: 18,
			fill: "#111",
			align: "center",
		});
		render(<CanvasNodeRenderer node={text} />);
		const p = callsOfType("Text")[0]?.props;
		expect(p?.text).toBe("hello");
		expect(p?.fontFamily).toBe("Inter");
		expect(p?.fontSize).toBe(18);
		expect(p?.fill).toBe("#111");
		expect(p?.align).toBe("center");
		expect(p?.width).toBe(200);
	});

	it("renders nothing for an image whose assetId is missing", () => {
		const image = createImage({
			id: "i1",
			bounds: { width: 100, height: 100 },
			assetId: "missing",
		});
		render(<CanvasNodeRenderer node={image} />);
		expect(callsOfType("Image")).toHaveLength(0);
	});

	it("renders nothing while the image is loading", () => {
		useImageMock.mockReturnValueOnce([null, "loading"]);
		const ir = createCanvasIR({
			pages: [createPage({ id: "p1" })],
			now: () => "2026-01-01T00:00:00.000Z",
		});
		ir.assets["a1"] = { id: "a1", uri: "data:image/png;base64,XXX" };
		const image = createImage({
			id: "i1",
			bounds: { width: 100, height: 100 },
			assetId: "a1",
		});
		render(
			<CanvasAssetsContext.Provider value={ir.assets}>
				<CanvasNodeRenderer node={image} />
			</CanvasAssetsContext.Provider>,
		);
		expect(callsOfType("Image")).toHaveLength(0);
	});

	it("renders Image when use-image returns a loaded image", () => {
		const fakeImg = { src: "data:image/png;base64,XXX" } as HTMLImageElement;
		useImageMock.mockReturnValueOnce([fakeImg, "loaded"]);
		const image = createImage({
			id: "i1",
			bounds: { width: 100, height: 100 },
			assetId: "a1",
		});
		render(
			<CanvasAssetsContext.Provider
				value={{ a1: { id: "a1", uri: "data:image/png;base64,XXX" } }}
			>
				<CanvasNodeRenderer node={image} />
			</CanvasAssetsContext.Provider>,
		);
		expect(callsOfType("Image")).toHaveLength(1);
		expect(callsOfType("Image")[0]?.props.image).toBe(fakeImg);
	});

	it("loads the image in CORS mode so an exported stage doesn't taint (E-1)", () => {
		const fakeImg = { src: "data:image/png;base64,XXX" } as HTMLImageElement;
		useImageMock.mockReturnValueOnce([fakeImg, "loaded"]);
		const image = createImage({
			id: "i1",
			bounds: { width: 100, height: 100 },
			assetId: "a1",
		});
		render(
			<CanvasAssetsContext.Provider
				value={{ a1: { id: "a1", uri: "https://example.com/a.png" } }}
			>
				<CanvasNodeRenderer node={image} />
			</CanvasAssetsContext.Provider>,
		);
		expect(useImageMock).toHaveBeenCalledWith(
			"https://example.com/a.png",
			"anonymous",
		);
	});

	it("passes the crop rect to Image when the node has a crop", () => {
		const fakeImg = { src: "data:image/png;base64,XXX" } as HTMLImageElement;
		useImageMock.mockReturnValueOnce([fakeImg, "loaded"]);
		const image = createImage({
			id: "i1",
			bounds: { width: 100, height: 100 },
			assetId: "a1",
			crop: { x: 10, y: 20, width: 30, height: 40 },
		});
		render(
			<CanvasAssetsContext.Provider
				value={{ a1: { id: "a1", uri: "data:image/png;base64,XXX" } }}
			>
				<CanvasNodeRenderer node={image} />
			</CanvasAssetsContext.Provider>,
		);
		expect(callsOfType("Image")[0]?.props.crop).toEqual({
			x: 10,
			y: 20,
			width: 30,
			height: 40,
		});
	});

	it("omits the crop prop when the node has no crop", () => {
		const fakeImg = { src: "data:image/png;base64,XXX" } as HTMLImageElement;
		useImageMock.mockReturnValueOnce([fakeImg, "loaded"]);
		const image = createImage({
			id: "i1",
			bounds: { width: 100, height: 100 },
			assetId: "a1",
		});
		render(
			<CanvasAssetsContext.Provider
				value={{ a1: { id: "a1", uri: "data:image/png;base64,XXX" } }}
			>
				<CanvasNodeRenderer node={image} />
			</CanvasAssetsContext.Provider>,
		);
		expect(callsOfType("Image")[0]?.props.crop).toBeUndefined();
	});

	it("honors a non-stretch fit mode when a crop is also present (FR-094)", () => {
		// 200×100 natural image, cropped to a 100×100 square sub-rect, placed
		// with fitMode "fit" inside a 100×100 node. The crop must compose
		// within the fitted (letterboxed) placement — not force a stretch —
		// mirroring core's SVG serializer, which layers the crop clip-path on
		// top of the fit-mode placement (see `serialize/svg.ts`).
		const fakeImg = {
			src: "data:image/png;base64,XXX",
			width: 200,
			height: 100,
		} as HTMLImageElement;
		useImageMock.mockReturnValueOnce([fakeImg, "loaded"]);
		const image = {
			...createImage({
				id: "i1",
				bounds: { width: 100, height: 100 },
				assetId: "a1",
				crop: { x: 50, y: 0, width: 100, height: 100 },
			}),
			fitMode: "fit",
		} as CanvasImageNode;
		render(
			<CanvasAssetsContext.Provider
				value={{ a1: { id: "a1", uri: "data:image/png;base64,XXX" } }}
			>
				<CanvasNodeRenderer node={image} />
			</CanvasAssetsContext.Provider>,
		);
		const p = callsOfType("Image")[0]?.props;
		// fit scale = min(100/200, 100/100) = 0.5; the crop (a source-pixel
		// sub-rect) is projected through that same scale, not stretched to
		// fill the full 100×100 bounds (the pre-fix bug).
		expect(p?.width).toBe(50);
		expect(p?.height).toBe(50);
		expect(p?.x).toBe(25);
		expect(p?.y).toBe(25);
		expect(p?.crop).toEqual({ x: 50, y: 0, width: 100, height: 100 });
		// Still wrapped in the fit-mode's bounds clip, like the no-crop case.
		expect(
			callsOfType("Group").some(
				(c) => c.props.clipWidth === 100 && c.props.clipHeight === 100,
			),
		).toBe(true);
	});

	it("composes an explicit crop within fitMode 'fill's covering placement", () => {
		// 200×100 natural image covering a 100×100 node (fill scale = 1, so
		// the whole image is centered and overhangs left/right by 50 each);
		// a crop then selects a sub-rect of the SOURCE image, projected
		// through that same cover scale.
		const fakeImg = {
			src: "data:image/png;base64,XXX",
			width: 200,
			height: 100,
		} as HTMLImageElement;
		useImageMock.mockReturnValueOnce([fakeImg, "loaded"]);
		const image = {
			...createImage({
				id: "i1",
				bounds: { width: 100, height: 100 },
				assetId: "a1",
				crop: { x: 20, y: 10, width: 40, height: 20 },
			}),
			fitMode: "fill",
		} as CanvasImageNode;
		render(
			<CanvasAssetsContext.Provider
				value={{ a1: { id: "a1", uri: "data:image/png;base64,XXX" } }}
			>
				<CanvasNodeRenderer node={image} />
			</CanvasAssetsContext.Provider>,
		);
		const p = callsOfType("Image")[0]?.props;
		expect(p?.width).toBe(40);
		expect(p?.height).toBe(20);
		expect(p?.x).toBe(-30);
		expect(p?.y).toBe(10);
		expect(p?.crop).toEqual({ x: 20, y: 10, width: 40, height: 20 });
	});

	it("fitMode 'stretch' plus crop is unchanged (regression)", () => {
		const fakeImg = { src: "data:image/png;base64,XXX" } as HTMLImageElement;
		useImageMock.mockReturnValueOnce([fakeImg, "loaded"]);
		const image = {
			...createImage({
				id: "i1",
				bounds: { width: 100, height: 100 },
				assetId: "a1",
				crop: { x: 10, y: 20, width: 30, height: 40 },
			}),
			fitMode: "stretch",
		} as CanvasImageNode;
		render(
			<CanvasAssetsContext.Provider
				value={{ a1: { id: "a1", uri: "data:image/png;base64,XXX" } }}
			>
				<CanvasNodeRenderer node={image} />
			</CanvasAssetsContext.Provider>,
		);
		const p = callsOfType("Image")[0]?.props;
		// Stretch draws at the full node bounds; the crop passes straight
		// through to Konva's native source-rect crop, unscaled — exactly the
		// pre-existing behavior.
		expect(p?.width).toBe(100);
		expect(p?.height).toBe(100);
		expect(p?.crop).toEqual({ x: 10, y: 20, width: 30, height: 40 });
	});

	it("renders nothing for an svg node whose assetId is missing", () => {
		const svg = createSvg({
			id: "s1",
			bounds: { width: 100, height: 100 },
			assetId: "missing",
		});
		render(<CanvasNodeRenderer node={svg} />);
		expect(callsOfType("Image")).toHaveLength(0);
	});

	it("renders nothing while the svg asset is loading", () => {
		useImageMock.mockReturnValueOnce([null, "loading"]);
		const svg = createSvg({
			id: "s1",
			bounds: { width: 100, height: 100 },
			assetId: "a1",
		});
		render(
			<CanvasAssetsContext.Provider
				value={{ a1: { id: "a1", uri: "data:image/svg+xml;base64,XXX" } }}
			>
				<CanvasNodeRenderer node={svg} />
			</CanvasAssetsContext.Provider>,
		);
		expect(callsOfType("Image")).toHaveLength(0);
	});

	it("renders Image (asset-reference path) when use-image returns a loaded svg", () => {
		const fakeImg = {
			src: "data:image/svg+xml;base64,XXX",
		} as HTMLImageElement;
		useImageMock.mockReturnValueOnce([fakeImg, "loaded"]);
		const svg = createSvg({
			id: "s1",
			bounds: { width: 100, height: 100 },
			assetId: "a1",
		});
		render(
			<CanvasAssetsContext.Provider
				value={{ a1: { id: "a1", uri: "data:image/svg+xml;base64,XXX" } }}
			>
				<CanvasNodeRenderer node={svg} />
			</CanvasAssetsContext.Provider>,
		);
		expect(callsOfType("Image")).toHaveLength(1);
		expect(callsOfType("Image")[0]?.props.image).toBe(fakeImg);
	});

	it("loads the svg asset in CORS mode too (E-1)", () => {
		const fakeImg = { src: "https://example.com/a.svg" } as HTMLImageElement;
		useImageMock.mockReturnValueOnce([fakeImg, "loaded"]);
		const svg = createSvg({
			id: "s1",
			bounds: { width: 100, height: 100 },
			assetId: "a1",
		});
		render(
			<CanvasAssetsContext.Provider
				value={{ a1: { id: "a1", uri: "https://example.com/a.svg" } }}
			>
				<CanvasNodeRenderer node={svg} />
			</CanvasAssetsContext.Provider>,
		);
		expect(useImageMock).toHaveBeenCalledWith(
			"https://example.com/a.svg",
			"anonymous",
		);
	});

	const placeholderFixture = (
		status: "pending" | "complete" | "error",
		jobId = "job-1",
	) => ({
		id: "ai1",
		type: "ai-placeholder" as const,
		transform: { x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1 },
		bounds: { width: 200, height: 200 },
		zIndex: 0,
		jobId,
		status,
	});

	const cancelGroupCall = () =>
		callsOfType("Group").find((c) => typeof c.props.onClick === "function");

	it("renders a pending ai-placeholder with a dashed border + loading label", () => {
		render(<CanvasNodeRenderer node={placeholderFixture("pending")} />);
		const border = callsOfType("Rect").find((c) => Array.isArray(c.props.dash));
		expect(border?.props.dash).toEqual([6, 4]);
		expect(
			callsOfType("Text").some((c) => c.props.text === "Generating…"),
		).toBe(true);
	});

	it("shows no Cancel control without a CanvasStudio context", () => {
		render(<CanvasNodeRenderer node={placeholderFixture("pending")} />);
		expect(cancelGroupCall()).toBeUndefined();
	});

	it("renders a Cancel control that cancels the registered job when pending", () => {
		const store = createAiJobStore();
		const abort = vi.fn();
		store.getState().register("job-1", { nodeId: "ai1", abort });
		render(
			<CanvasStudioContext.Provider
				value={{ aiJobStore: store } as unknown as CanvasStudioContextValue}
			>
				<CanvasNodeRenderer node={placeholderFixture("pending")} />
			</CanvasStudioContext.Provider>,
		);
		const cancel = cancelGroupCall();
		expect(cancel).toBeDefined();
		expect(callsOfType("Text").some((c) => c.props.text === "Cancel")).toBe(
			true,
		);

		if (!cancel) throw new Error("expected a Cancel control");
		(cancel.props.onClick as (e: { cancelBubble: boolean }) => void)({
			cancelBubble: false,
		});
		expect(abort).toHaveBeenCalledTimes(1);
		expect(store.getState().get("job-1")?.status).toBe("cancelled");
	});

	it("shows no Cancel control when the status is not pending", () => {
		const store = createAiJobStore();
		store.getState().register("job-1", { nodeId: "ai1", abort: vi.fn() });
		render(
			<CanvasStudioContext.Provider
				value={{ aiJobStore: store } as unknown as CanvasStudioContextValue}
			>
				<CanvasNodeRenderer node={placeholderFixture("complete")} />
			</CanvasStudioContext.Provider>,
		);
		expect(cancelGroupCall()).toBeUndefined();
		expect(callsOfType("Text").some((c) => c.props.text === "AI ready")).toBe(
			true,
		);
	});

	it("labels an errored placeholder and shows no Cancel", () => {
		render(<CanvasNodeRenderer node={placeholderFixture("error")} />);
		expect(callsOfType("Text").some((c) => c.props.text === "AI failed")).toBe(
			true,
		);
		expect(cancelGroupCall()).toBeUndefined();
	});
});

describe("CanvasNodeRenderer — brand tokens", () => {
	beforeEachReset();

	const kit: BrandKit = {
		colors: [{ id: "brand.primary", name: "Primary", value: "#2563eb" }],
		fonts: ["Inter"],
	};

	const renderWithKit = (
		node: Parameters<typeof CanvasNodeRenderer>[0]["node"],
		brandKit: BrandKit = kit,
	) =>
		render(
			<CanvasBrandKitContext.Provider value={brandKit}>
				<CanvasNodeRenderer node={node} />
			</CanvasBrandKitContext.Provider>,
		);

	it("resolves a color-token fill against the provided brand kit", () => {
		const rect = createRect({
			id: "r1",
			bounds: { width: 10, height: 10 },
			fill: { type: "brand-token", tokenType: "color", id: "brand.primary" },
		});
		renderWithKit(rect);
		expect(callsOfType("Rect")[0]?.props.fill).toBe("#2563eb");
	});

	it("resolves a font-token fontFamily against the provided brand kit", () => {
		const text = createText({
			id: "t1",
			bounds: { width: 100, height: 20 },
			text: "hi",
			fontFamily: { type: "brand-token", tokenType: "font", id: "inter" },
		});
		renderWithKit(text);
		expect(callsOfType("Text")[0]?.props.fontFamily).toBe("Inter");
	});

	it("degrades an unresolved color token to no fill, without crashing", () => {
		const rect = createRect({
			id: "r1",
			bounds: { width: 10, height: 10 },
			fill: { type: "brand-token", tokenType: "color", id: "does-not-exist" },
		});
		expect(() => renderWithKit(rect)).not.toThrow();
		expect(callsOfType("Rect")[0]?.props.fill).toBeUndefined();
	});

	it("degrades a token fill to no fill when rendered with no CanvasBrandKitContext at all", () => {
		const rect = createRect({
			id: "r1",
			bounds: { width: 10, height: 10 },
			fill: { type: "brand-token", tokenType: "color", id: "brand.primary" },
		});
		expect(() => render(<CanvasNodeRenderer node={rect} />)).not.toThrow();
		expect(callsOfType("Rect")[0]?.props.fill).toBeUndefined();
	});

	it("still renders a plain string fill unchanged inside a brand-kit provider", () => {
		const rect = createRect({
			id: "r1",
			bounds: { width: 10, height: 10 },
			fill: "#abc",
		});
		renderWithKit(rect);
		expect(callsOfType("Rect")[0]?.props.fill).toBe("#abc");
	});
});

describe("CanvasNodeRenderer — frame", () => {
	beforeEachReset();

	const frameFixture = (
		over: Partial<Parameters<typeof createFrame>[0]> = {},
	) =>
		createFrame({
			id: "f1",
			bounds: { width: 200, height: 100 },
			transform: { x: 10, y: 20 },
			children: [createRect({ id: "r1", bounds: { width: 10, height: 10 } })],
			...over,
		});

	/** The Group emitted for the frame itself (children may emit their own). */
	const frameGroup = () =>
		callsOfType("Group").find((c) => c.props.id === "f1");

	it("renders a Group carrying the frame's id + transform, and recurses children", () => {
		render(<CanvasNodeRenderer node={frameFixture()} />);
		const g = frameGroup();
		expect(g).toBeDefined();
		expect(g?.props.x).toBe(10);
		expect(g?.props.y).toBe(20);
		// The child rect rendered inside the frame.
		expect(callsOfType("Rect").some((c) => c.props.id === "r1")).toBe(true);
	});

	it("emits no clip props when clip is off", () => {
		render(<CanvasNodeRenderer node={frameFixture({ clip: false })} />);
		const p = frameGroup()?.props ?? {};
		expect(p.clipWidth).toBeUndefined();
		expect(p.clipFunc).toBeUndefined();
	});

	it("clips to the frame box in LOCAL space when clip is on", () => {
		render(<CanvasNodeRenderer node={frameFixture({ clip: true })} />);
		const p = frameGroup()?.props;
		// Local space: the clip box is (0,0,w,h) — NOT offset by the frame's x/y.
		expect(p?.clipX).toBe(0);
		expect(p?.clipY).toBe(0);
		expect(p?.clipWidth).toBe(200);
		expect(p?.clipHeight).toBe(100);
		expect(p?.clipFunc).toBeUndefined();
	});

	it("uses a rounded clipFunc when clip + radius are both set", () => {
		render(
			<CanvasNodeRenderer node={frameFixture({ clip: true, radius: 12 })} />,
		);
		const p = frameGroup()?.props;
		// Konva has no `clipRadius` — a rounded clip must go through clipFunc.
		expect(p?.clipWidth).toBeUndefined();
		const clipFunc = p?.clipFunc as
			| ((ctx: { roundRect: (...a: number[]) => void }) => void)
			| undefined;
		expect(clipFunc).toBeTypeOf("function");
		const ctx = { roundRect: vi.fn() };
		clipFunc?.(ctx);
		// Konva calls beginPath() before and clip() after, so the callback only
		// draws the path — and does so in the frame's local space.
		expect(ctx.roundRect).toHaveBeenCalledWith(0, 0, 200, 100, 12);
	});

	it("paints a background Rect covering the frame box", () => {
		render(
			<CanvasNodeRenderer
				node={frameFixture({ background: "#0af", radius: 8 })}
			/>,
		);
		const backdrop = callsOfType("Rect").find((c) => c.props.fill === "#0af");
		expect(backdrop).toBeDefined();
		expect(backdrop?.props.x).toBe(0);
		expect(backdrop?.props.y).toBe(0);
		expect(backdrop?.props.width).toBe(200);
		expect(backdrop?.props.height).toBe(100);
		expect(backdrop?.props.cornerRadius).toBe(8);
	});

	// `findHitNodeId` walks UP the Konva tree to the first node whose name matches
	// a top-level IR id. The backdrop must therefore stay anonymous AND listening,
	// or clicking a frame's background would select nothing (or the wrong node).
	it("leaves the background Rect anonymous and hit-testable, so a click resolves to the frame", () => {
		render(<CanvasNodeRenderer node={frameFixture({ background: "#0af" })} />);
		const backdrop = callsOfType("Rect").find((c) => c.props.fill === "#0af");
		expect(backdrop?.props.id).toBeUndefined();
		expect(backdrop?.props.name).toBeUndefined();
		expect(backdrop?.props.listening).not.toBe(false);
		// The Group above it is what carries the frame's id for the walk-up.
		expect(frameGroup()?.props.name).toBe("f1");
	});

	it("paints nothing for the frame box when a childless frame has no background", () => {
		render(<CanvasNodeRenderer node={frameFixture({ children: [] })} />);
		const box = callsOfType("Rect").find((c) => c.props.id === undefined);
		// The box Rect is still emitted (see below) — it just carries no paint.
		expect(box?.props.fill).toBeUndefined();
		expect(box?.props.stroke).toBeUndefined();
	});

	/**
	 * The measurement fix is scoped to the case that can actually degenerate:
	 * a CHILDLESS frame. `Container.getClientRect` unions children and ignores
	 * `listening`, so emitting the bounds-sized Rect unconditionally would
	 * re-measure every background-less frame that HAS children from its content
	 * to its declared bounds — silently moving the selection border, the
	 * Transformer's `oldBox` (and so the resize ratio) and the ElementControls
	 * anchor for frames that were never broken.
	 */
	it("emits NO box Rect for a background-less frame that has children", () => {
		render(<CanvasNodeRenderer node={frameFixture()} />);
		expect(
			callsOfType("Rect").find((c) => c.props.id === undefined),
		).toBeUndefined();
		// The child rect is untouched.
		expect(callsOfType("Rect").some((c) => c.props.id === "r1")).toBe(true);
	});

	it("still paints the box Rect for a frame with BOTH a background and children", () => {
		render(<CanvasNodeRenderer node={frameFixture({ background: "#0af" })} />);
		const box = callsOfType("Rect").find((c) => c.props.id === undefined);
		expect(box?.props.fill).toBe("#0af");
		expect(box?.props.width).toBe(200);
		expect(box?.props.listening).toBe(true);
	});

	// A frame OWNS its bounds, but a Konva Container measures itself PURELY from
	// its children — so a background-less, childless frame (what the frame tool
	// drags out) measured 0×0. That fed `Transformer._fitNodesInto` a singular
	// `oldTr`, whose `oldTr.invert()` divided by a zero determinant and wrote
	// `NaN` geometry onto the node ("NaN is a not valid value for …" bursts).
	// The box Rect is what keeps the frame measurable.
	it("emits a bounds-sized box Rect even with no background, so the frame is measurable", () => {
		render(<CanvasNodeRenderer node={frameFixture({ children: [] })} />);
		const box = callsOfType("Rect").find((c) => c.props.id === undefined);
		expect(box).toBeDefined();
		expect(box?.props.x).toBe(0);
		expect(box?.props.y).toBe(0);
		expect(box?.props.width).toBe(200);
		expect(box?.props.height).toBe(100);
	});

	// Contributing geometry must not make an unfilled frame's interior clickable:
	// `findHitNodeId` would then resolve clicks that used to pass through.
	it("keeps the box Rect non-listening when the frame has no background", () => {
		render(<CanvasNodeRenderer node={frameFixture({ children: [] })} />);
		const box = callsOfType("Rect").find((c) => c.props.id === undefined);
		expect(box?.props.listening).toBe(false);
	});

	it("routes a gradient background through the shared fillProps helper", () => {
		render(
			<CanvasNodeRenderer
				node={frameFixture({
					background: {
						kind: "linear",
						from: { x: 0, y: 0 },
						to: { x: 1, y: 0 },
						stops: [
							{ offset: 0, color: "#000" },
							{ offset: 1, color: "#fff" },
						],
					},
				})}
			/>,
		);
		const backdrop = callsOfType("Rect").find(
			(c) => c.props.fillLinearGradientColorStops !== undefined,
		);
		expect(backdrop?.props.fillLinearGradientColorStops).toEqual([
			0,
			"#000",
			1,
			"#fff",
		]);
		// Gradient endpoints are scaled by the frame's bounds.
		expect(backdrop?.props.fillLinearGradientEndPoint).toEqual({
			x: 200,
			y: 0,
		});
	});
});

/**
 * K-5 / K-3 — the render-and-reapply budget.
 *
 * react-konva re-renders its ENTIRE bridged child tree whenever the component
 * owning `<CanvasStage>` renders (`StageWrap` calls `updateContainer` from a
 * `useLayoutEffect` with no dep array), and Konva's `Node._setAttr`
 * short-circuits on `oldVal === val` for PRIMITIVES ONLY:
 * `if (oldVal === val && !Util.isObject(val)) return;`. Together those two
 * facts mean an unmemoised renderer re-applies every object-valued attribute
 * on every commit anywhere in the document — and a gradient fill drops
 * Konva's cached `CanvasGradient` each time it does.
 *
 * Both halves are invisible to a props-value assertion (the VALUES are always
 * correct), so they are pinned here by identity instead.
 */
describe("CanvasNodeRenderer — re-render budget (K-5, K-3)", () => {
	beforeEachReset();
	afterEach(() => {
		cleanup();
	});

	const LINEAR_FILL = {
		kind: "linear" as const,
		from: { x: 0, y: 0 },
		to: { x: 1, y: 0 },
		stops: [
			{ offset: 0, color: "#000" },
			{ offset: 1, color: "#fff" },
		],
	};

	/**
	 * Move a node the way the IR actually does it — `updateNode` spreads the
	 * node and replaces only `transform`, so `bounds`, `fill` and the stroke
	 * fields keep their identity. Rebuilding the fixture with `createRect`
	 * instead would allocate a fresh `bounds` and defeat the very memo under
	 * test, so these assertions would pass for the wrong reason.
	 */
	const movedTo = <T extends { transform: { x: number; y: number } }>(
		node: T,
		x: number,
	): T => ({ ...node, transform: { ...node.transform, x } });

	it("does not re-render a sibling whose node reference is unchanged", () => {
		const a = createRect({ id: "a", bounds: { width: 10, height: 10 } });
		const b1 = createRect({ id: "b", bounds: { width: 10, height: 10 } });
		const tree = (b: typeof b1) => (
			<>
				<CanvasNodeRenderer node={a} />
				<CanvasNodeRenderer node={b} />
			</>
		);
		const { rerender } = render(tree(b1));
		expect(callsOfType("Rect")).toHaveLength(2);

		// Edit ONLY b. The IR is updated immutably, so `a` keeps its identity —
		// which is exactly what makes reference equality a sound memo key.
		const b2 = createRect({
			id: "b",
			bounds: { width: 10, height: 10 },
			transform: { x: 99, y: 0 },
		});
		rerender(tree(b2));

		const rects = callsOfType("Rect");
		// One further render: b. Not two.
		expect(rects).toHaveLength(3);
		expect(rects[2]?.props.id).toBe("b");
		expect(rects[2]?.props.x).toBe(99);
	});

	it("keeps the gradient stop array reference stable when a node only moves", () => {
		// Same `fill` object across both renders — the immutable-update shape a
		// drag produces (new node, new transform, untouched fill/bounds).
		const first = createRect({
			id: "grad",
			bounds: { width: 100, height: 50 },
			fill: LINEAR_FILL as Parameters<typeof createRect>[0]["fill"],
		});
		const { rerender } = render(<CanvasNodeRenderer node={first} />);
		const before = callsOfType("Rect").at(-1)?.props;
		expect(before?.fillLinearGradientColorStops).toEqual([
			0,
			"#000",
			1,
			"#fff",
		]);

		const moved = movedTo(first, 40);
		// Sanity: the node really is a different object, so memo cannot bail out
		// and the component genuinely re-rendered.
		expect(moved).not.toBe(first);
		rerender(<CanvasNodeRenderer node={moved} />);
		const after = callsOfType("Rect").at(-1)?.props;
		expect(after?.x).toBe(40);

		// Identity, not equality: a fresh-but-equal array still trips Konva's
		// `fillLinearGradientColorStopsChange`, which is what drops the cached
		// CanvasGradient and forces it to be rebuilt.
		expect(
			Object.is(
				before?.fillLinearGradientColorStops,
				after?.fillLinearGradientColorStops,
			),
		).toBe(true);
		expect(
			Object.is(
				before?.fillLinearGradientStartPoint,
				after?.fillLinearGradientStartPoint,
			),
		).toBe(true);
	});

	it("keeps the dash array reference stable when a node only moves", () => {
		// `strokeDash` is not a `createRect` option, so it is attached directly.
		const first = {
			...createRect({
				id: "dashed",
				bounds: { width: 10, height: 10 },
				stroke: "#f00",
				strokeWidth: 2,
			}),
			strokeDash: [4, 2],
		};
		const { rerender } = render(<CanvasNodeRenderer node={first} />);
		const before = callsOfType("Rect").at(-1)?.props;
		expect(before?.dash).toEqual([4, 2]);

		rerender(<CanvasNodeRenderer node={movedTo(first, 7)} />);
		const after = callsOfType("Rect").at(-1)?.props;
		expect(after?.x).toBe(7);
		expect(Object.is(before?.dash, after?.dash)).toBe(true);
	});

	// K-16. Rich text is one `<Text>` per RUN, so a styled paragraph is dozens
	// of Konva nodes. Rebuilding that element list on every render also rebuilt
	// every run's `fillProps` object; the run list is memoised on the measured
	// layout (itself cached on `node.paragraphs`), so a move re-renders the
	// block without rebuilding a single run.
	it("does not rebuild rich-text runs when the block only moves", () => {
		const first = createRichText({
			id: "rt",
			bounds: { width: 300, height: 60 },
			paragraphs: [
				{ spans: [{ text: "Hello " }, { text: "World", fontWeight: "700" }] },
			],
		});
		const { rerender } = render(<CanvasNodeRenderer node={first} />);
		const afterFirst = callsOfType("Text").length;
		expect(afterFirst).toBeGreaterThan(0);

		// A real move keeps `paragraphs` (and so the measured layout) identical.
		rerender(<CanvasNodeRenderer node={movedTo(first, 40)} />);

		// The Group moved…
		expect(callsOfType("Group").at(-1)?.props.x).toBe(40);
		// …and not one run re-rendered: React reuses the memoised elements, so
		// the mock is never called for them again.
		expect(callsOfType("Text")).toHaveLength(afterFirst);
	});

	// K-16 (hit graph). Konva rasterises a listening `Text` into the hit canvas
	// glyph by glyph on every layer redraw. Collapsing a block's hit geometry to
	// one rect is the cheapest hit shape there is, and it is what the user
	// actually clicks.
	it("gives rich text one block hit rect and stops the runs listening", () => {
		const node = createRichText({
			id: "rt-hit",
			bounds: { width: 300, height: 80 },
			height: 80,
			paragraphs: [{ spans: [{ text: "Hello " }, { text: "World" }] }],
		});
		render(<CanvasNodeRenderer node={node} />);

		const runs = callsOfType("Text");
		expect(runs.length).toBeGreaterThan(1);
		for (const run of runs) expect(run.props.listening).toBe(false);

		const hit = callsOfType("Rect");
		expect(hit).toHaveLength(1);
		expect(hit[0]?.props).toMatchObject({
			x: 0,
			y: 0,
			width: 300,
			fill: "transparent",
		});
		// Sized to the declared box here (text is shorter than 80).
		expect(hit[0]?.props.height).toBe(80);
	});

	it("sizes the hit rect to the text when it overflows the declared box", () => {
		// `overflow: visible` (the default) paints past the box, so a hit rect
		// clamped to the box would leave those lines unclickable.
		const node = createRichText({
			id: "rt-overflow",
			bounds: { width: 60, height: 4 },
			height: 4,
			paragraphs: [
				{
					spans: [
						{ text: "wrapping text that is definitely taller than four px" },
					],
				},
			],
		});
		render(<CanvasNodeRenderer node={node} />);
		const hit = callsOfType("Rect")[0]?.props;
		expect(hit?.height).toBeGreaterThan(4);
	});

	it("keeps a frame's clipFunc reference stable when the frame only moves", () => {
		const first = createFrame({
			id: "f",
			bounds: { width: 100, height: 100 },
			clip: true,
			radius: 8,
			children: [],
		});
		const { rerender } = render(<CanvasNodeRenderer node={first} />);
		const before = callsOfType("Group").at(-1)?.props;
		expect(typeof before?.clipFunc).toBe("function");

		rerender(<CanvasNodeRenderer node={movedTo(first, 30)} />);
		const after = callsOfType("Group").at(-1)?.props;
		expect(after?.x).toBe(30);
		// A `clipFunc` is a function, so Konva never short-circuits it either.
		expect(Object.is(before?.clipFunc, after?.clipFunc)).toBe(true);
	});
});

/**
 * cp4-003 — Konva shape clipping (ADR 0008 decision 2).
 *
 * Every case asserts the DRAWING CALLS the `clipFunc` makes, not the shape of
 * the props object: the props are an implementation detail, the outline is the
 * contract the SVG serializer has to match.
 */
type ClipContextCall = {
	readonly op: string;
	readonly args: readonly unknown[];
};

/** A stand-in for Konva's scene context that records the path it is asked to trace. */
function recordingClipContext(): {
	ops: ClipContextCall[];
	ctx: Record<string, (...args: unknown[]) => void>;
} {
	const ops: ClipContextCall[] = [];
	const record =
		(op: string) =>
		(...args: unknown[]) => {
			ops.push({ op, args });
		};
	return {
		ops,
		ctx: {
			moveTo: record("moveTo"),
			lineTo: record("lineTo"),
			closePath: record("closePath"),
			ellipse: record("ellipse"),
			roundRect: record("roundRect"),
			rect: record("rect"),
		},
	};
}

/** The `[x, y]` pairs a traced polyline visited, in order. */
function tracedPoints(ops: readonly ClipContextCall[]): unknown[][] {
	return ops
		.filter((o) => o.op === "moveTo" || o.op === "lineTo")
		.map((o) => [...o.args]);
}

describe("CanvasNodeRenderer — frame shape clipping (cp4-003)", () => {
	beforeEachReset();

	const SQUARE = { width: 200, height: 200 };

	/**
	 * `createFrame` does not accept `shape` (it omits `cornerRadii`/`autoLayout`
	 * too), so the field is attached to the built node — which is also how a
	 * document carrying it arrives from a parse.
	 */
	const shaped = (
		shape: CanvasFrameShape | undefined,
		over: Partial<Parameters<typeof createFrame>[0]> = {},
	): CanvasFrameNode => ({
		...createFrame({
			id: "f1",
			bounds: { width: 200, height: 100 },
			clip: true,
			children: [createRect({ id: "r1", bounds: { width: 10, height: 10 } })],
			...over,
		}),
		...(shape ? { shape } : {}),
	});

	const frameProps = () =>
		callsOfType("Group").find((c) => c.props.id === "f1")?.props ?? {};

	/** Run the emitted `clipFunc` against a recording context. */
	function traceClip(props: Record<string, unknown>): ClipContextCall[] {
		const clipFunc = props.clipFunc as ((ctx: unknown) => unknown) | undefined;
		expect(clipFunc).toBeTypeOf("function");
		const { ops, ctx } = recordingClipContext();
		clipFunc?.(ctx);
		return ops;
	}

	it("clips an ellipse frame to the same centre and radii core's emitEllipse uses", () => {
		render(<CanvasNodeRenderer node={shaped({ kind: "ellipse" })} />);
		const props = frameProps();
		// A shape clip can never ride the declarative box props.
		expect(props.clipWidth).toBeUndefined();
		expect(traceClip(props)).toEqual([
			{ op: "ellipse", args: [100, 50, 100, 50, 0, 0, Math.PI * 2] },
		]);
	});

	// ADR 0008 decision 1 records that a square frame with `radius = side / 2`
	// already clips to a circle, and flags the Konva half as derived from markup
	// rather than executed. cp4-001 executed the SVG half; this is the Konva one.
	it("agrees with the radius-half-the-side circle ADR 0008 decision 1 claims", () => {
		render(
			<CanvasNodeRenderer
				node={shaped({ kind: "ellipse" }, { bounds: SQUARE })}
			/>,
		);
		const viaShape = traceClip(frameProps());
		calls.length = 0;
		render(
			<CanvasNodeRenderer
				node={shaped(undefined, { bounds: SQUARE, radius: 100 })}
			/>,
		);
		const viaRadius = traceClip(frameProps());
		// Both describe the circle inscribed in a 200×200 box: the ellipse by its
		// centre + equal radii, the rounded rect by a radius of half the side.
		expect(viaShape).toEqual([
			{ op: "ellipse", args: [100, 100, 100, 100, 0, 0, Math.PI * 2] },
		]);
		expect(viaRadius).toEqual([
			{ op: "roundRect", args: [0, 0, 200, 200, 100] },
		]);
	});

	it("traces a polygon clip through core's computePolygonVertices, vertex for vertex", () => {
		const bounds = { width: 200, height: 100 };
		render(<CanvasNodeRenderer node={shaped({ kind: "polygon", sides: 6 })} />);
		const ops = traceClip(frameProps());
		// The anti-drift assertion: the outline IS core's shared maths, not a
		// Konva-side re-derivation. `emitPolygon` reads the same function.
		expect(tracedPoints(ops)).toEqual(
			computePolygonVertices(bounds, 6).map((v) => [v.x, v.y]),
		);
		expect(ops[0]?.op).toBe("moveTo");
		expect(ops.at(-1)?.op).toBe("closePath");
	});

	it("traces a star clip through core's computeStarVertices, vertex for vertex", () => {
		const bounds = { width: 200, height: 100 };
		render(
			<CanvasNodeRenderer
				node={shaped({ kind: "star", points: 5, innerRadiusRatio: 0.4 })}
			/>,
		);
		const ops = traceClip(frameProps());
		expect(tracedPoints(ops)).toEqual(
			computeStarVertices(bounds, 5, 0.4).map((v) => [v.x, v.y]),
		);
		// 5 points ⇒ 10 alternating vertices.
		expect(tracedPoints(ops)).toHaveLength(10);
	});

	it("clips a path shape by returning a Path2D built from `d`, not by tracing it", () => {
		const built: string[] = [];
		class FakePath2D {
			constructor(d: string) {
				built.push(d);
			}
		}
		vi.stubGlobal("Path2D", FakePath2D);
		try {
			render(
				<CanvasNodeRenderer
					node={shaped({ kind: "path", d: "M0 0 L10 10 Z" })}
				/>,
			);
			const props = frameProps();
			const clipFunc = props.clipFunc as (ctx: unknown) => unknown;
			expect(clipFunc).toBeTypeOf("function");
			// Konva forwards a returned array straight to `context.clip(...)`.
			const returned = clipFunc({}) as unknown[];
			expect(returned).toHaveLength(1);
			expect(returned[0]).toBeInstanceOf(FakePath2D);
			// Built ONCE per render, not once per draw: calling again reuses it.
			clipFunc({});
			expect(built).toEqual(["M0 0 L10 10 Z"]);
		} finally {
			vi.unstubAllGlobals();
		}
	});

	// A `d` Konva's parser yields no points for is VALID per the IR (it only
	// requires a non-empty string) and arrives from SVG import. Clipping to it
	// would erase the frame's whole content — a silent wrong render.
	it("degrades an undrawable path `d` to the frame box instead of clipping everything away", () => {
		vi.stubGlobal("Path2D", class {});
		try {
			render(<CanvasNodeRenderer node={shaped({ kind: "path", d: "Z" })} />);
			const props = frameProps();
			expect(props.clipFunc).toBeUndefined();
			expect(props.clipWidth).toBe(200);
			expect(props.clipHeight).toBe(100);
		} finally {
			vi.unstubAllGlobals();
		}
	});

	// jsdom has no `Path2D` at all, so this is also the environment this suite
	// runs in by default — the guard is what keeps it from throwing here.
	it("degrades a path shape to the frame box where the DOM has no Path2D", () => {
		expect(typeof Path2D).toBe("undefined");
		render(
			<CanvasNodeRenderer
				node={shaped({ kind: "path", d: "M0 0 L10 10 Z" })}
			/>,
		);
		expect(frameProps().clipWidth).toBe(200);
	});

	// `clip` is the ONLY on/off switch (ADR 0008 decision 2). A `shape` on an
	// unclipped frame is inert; reading it as a second trigger would be the
	// parallel clipping model the ADR rules out.
	it("emits no clip at all for a shaped frame whose `clip` is off", () => {
		render(
			<CanvasNodeRenderer
				node={shaped({ kind: "ellipse" }, { clip: false })}
			/>,
		);
		const props = frameProps();
		expect(props.clipFunc).toBeUndefined();
		expect(props.clipWidth).toBeUndefined();
	});

	it("degrades a shape the resolver cannot honour to the frame box", () => {
		render(<CanvasNodeRenderer node={shaped({ kind: "polygon", sides: 2 })} />);
		const props = frameProps();
		expect(props.clipFunc).toBeUndefined();
		expect(props.clipWidth).toBe(200);
		expect(props.clipHeight).toBe(100);
	});

	// The resolver drops `radius`/`cornerRadii` for every non-rect kind, so the
	// renderer must not re-introduce them from the raw node.
	it("ignores `radius` on a non-rect shape rather than rounding it", () => {
		render(
			<CanvasNodeRenderer node={shaped({ kind: "ellipse" }, { radius: 24 })} />,
		);
		expect(traceClip(frameProps())[0]?.op).toBe("ellipse");
	});

	// Behaviour preservation for the rounding the resolver normalises: per-corner
	// radii win outright over `radius`, and a zero radius is no radius. Both rules
	// moved OUT of this renderer and into `resolveFrameClipShape`, so the emitted
	// clip has to be unchanged for every pre-ADR-0008 document.
	it("keeps per-corner radii winning over `radius`, as the pre-resolver clip did", () => {
		const node: CanvasFrameNode = {
			...shaped(undefined, { radius: 40 }),
			cornerRadii: { topLeft: 1, topRight: 2, bottomRight: 3, bottomLeft: 4 },
		};
		render(<CanvasNodeRenderer node={node} />);
		expect(traceClip(frameProps())).toEqual([
			{ op: "roundRect", args: [0, 0, 200, 100, [1, 2, 3, 4]] },
		]);
	});

	it("treats a zero radius as no radius and stays on the declarative box clip", () => {
		render(<CanvasNodeRenderer node={shaped(undefined, { radius: 0 })} />);
		const props = frameProps();
		expect(props.clipFunc).toBeUndefined();
		expect(props.clipWidth).toBe(200);
	});

	// An explicit `{ kind: "rect" }` means "deliberately no shape mask" and must
	// stay behaviourally identical to an absent shape, rounding included.
	it("keeps an explicitly rectangular shape byte-identical to today's rounded clip", () => {
		render(
			<CanvasNodeRenderer node={shaped({ kind: "rect" }, { radius: 12 })} />,
		);
		expect(traceClip(frameProps())).toEqual([
			{ op: "roundRect", args: [0, 0, 200, 100, 12] },
		]);
	});

	// The renderer already maps `blendMode` onto `globalCompositeOperation`
	// (`commonProps`). Konva pushes the clip BEFORE the composite op in
	// `Container._drawChildren`, so the two compose — but only if both actually
	// reach the same Group.
	it("carries a blend mode and a shape clip on the SAME Group so they compose", () => {
		const node = shaped({ kind: "ellipse" });
		render(
			<CanvasNodeRenderer
				node={{ ...node, blendMode: "multiply" } as CanvasFrameNode}
			/>,
		);
		const props = frameProps();
		expect(props.globalCompositeOperation).toBe("multiply");
		expect(traceClip(props)[0]?.op).toBe("ellipse");
	});

	it("re-renders a new outline when the shape changes, with no manual refresh", () => {
		const { rerender } = render(
			<CanvasNodeRenderer node={shaped({ kind: "ellipse" })} />,
		);
		expect(traceClip(frameProps())[0]?.op).toBe("ellipse");
		calls.length = 0;
		rerender(
			<CanvasNodeRenderer node={shaped({ kind: "polygon", sides: 3 })} />,
		);
		const ops = traceClip(frameProps());
		expect(ops[0]?.op).toBe("moveTo");
		expect(tracedPoints(ops)).toEqual(
			computePolygonVertices({ width: 200, height: 100 }, 3).map((v) => [
				v.x,
				v.y,
			]),
		);
	});

	// Nothing is cached, so this is a dependency-correctness property rather than
	// an invalidation one: the closure must never outlive the bounds it captured.
	it("re-renders a new outline when the clipped geometry changes", () => {
		const { rerender } = render(
			<CanvasNodeRenderer node={shaped({ kind: "ellipse" })} />,
		);
		expect(traceClip(frameProps())).toEqual([
			{ op: "ellipse", args: [100, 50, 100, 50, 0, 0, Math.PI * 2] },
		]);
		calls.length = 0;
		rerender(
			<CanvasNodeRenderer
				node={shaped(
					{ kind: "ellipse" },
					{ bounds: { width: 60, height: 40 } },
				)}
			/>,
		);
		expect(traceClip(frameProps())).toEqual([
			{ op: "ellipse", args: [30, 20, 30, 20, 0, 0, Math.PI * 2] },
		]);
	});

	// The well interaction is the point of shape clipping: a photo dropped into a
	// shaped frame has to come out shaped.
	it("clips a filled image well to the shape", () => {
		useImageMock.mockReturnValue([
			{ src: "data:image/png;base64,AA=" } as HTMLImageElement,
			"loaded",
		]);
		const well = shaped(
			{ kind: "ellipse" },
			{
				placeholder: { kind: "image", assetId: "a1" },
				children: [
					createImage({
						id: "img",
						bounds: { width: 200, height: 100 },
						assetId: "a1",
					}),
				],
			},
		);
		render(
			<CanvasAssetsContext.Provider
				value={{ a1: { id: "a1", uri: "data:image/png;base64,AA=" } }}
			>
				<CanvasNodeRenderer node={well} />
			</CanvasAssetsContext.Provider>,
		);
		// The image is a real child of the clipped Group — never flattened.
		expect(callsOfType("Image").some((c) => c.props.id === "img")).toBe(true);
		expect(traceClip(frameProps())[0]?.op).toBe("ellipse");
	});

	afterEach(() => {
		cleanup();
	});
});

function beforeEachReset() {
	const { beforeEach } = import.meta.vitest!;
	beforeEach(() => {
		calls.length = 0;
		useImageMock.mockReset();
		useImageMock.mockImplementation(() => [null, "loading"]);
		resetMissingAssetToastForTests();
	});
}

describe("CanvasNodeRenderer — frame image well (placeholder)", () => {
	beforeEachReset();

	const wellFixture = (over: Partial<Parameters<typeof createFrame>[0]> = {}) =>
		createFrame({
			id: "well",
			bounds: { width: 200, height: 100 },
			clip: true,
			placeholder: { kind: "image" },
			...over,
		});

	const frameGroup = () =>
		callsOfType("Group").find((c) => c.props.id === "well");

	/** Mount inside a studio provider — i.e. the interactive stage, not an export. */
	const renderInteractive = (
		node: Parameters<typeof CanvasNodeRenderer>[0]["node"],
	) =>
		render(
			<CanvasStudioContext.Provider
				value={{} as unknown as CanvasStudioContextValue}
			>
				<CanvasNodeRenderer node={node} />
			</CanvasStudioContext.Provider>,
		);

	it("paints the neutral fallback fill for an EMPTY well", () => {
		renderInteractive(wellFixture());
		// Must match core's FRAME_PLACEHOLDER_FALLBACK_FILL, or stage and SVG diverge.
		expect(callsOfType("Rect").some((c) => c.props.fill === "#e2e8f0")).toBe(
			true,
		);
	});

	it("prefers the frame's own background over the fallback", () => {
		renderInteractive(wellFixture({ background: "#ff0000" }));
		const fills = callsOfType("Rect").map((c) => c.props.fill);
		expect(fills).toContain("#ff0000");
		expect(fills).not.toContain("#e2e8f0");
	});

	it("shows a dashed outline + label affordance so an empty well differs from an empty group", () => {
		renderInteractive(wellFixture());
		expect(callsOfType("Rect").some((c) => Array.isArray(c.props.dash))).toBe(
			true,
		);
		expect(callsOfType("Text")[0]?.props.text).toBe("Add an image");
	});

	it("labels a logo well differently", () => {
		renderInteractive(wellFixture({ placeholder: { kind: "logo" } }));
		expect(callsOfType("Text")[0]?.props.text).toBe("Add a logo");
	});

	// The rasterizer renders this component with NO studio provider. The
	// affordance is editor chrome and must never reach an exported PNG.
	it("omits the affordance when rendered WITHOUT a studio context (export path)", () => {
		render(<CanvasNodeRenderer node={wellFixture()} />);
		expect(callsOfType("Rect").some((c) => Array.isArray(c.props.dash))).toBe(
			false,
		);
		expect(callsOfType("Text")).toHaveLength(0);
		// ...but the fallback FILL is document content, so it still paints.
		expect(callsOfType("Rect").some((c) => c.props.fill === "#e2e8f0")).toBe(
			true,
		);
	});

	it("drops the affordance and the fallback once the well is filled", () => {
		// Loaded image: with FR-095 a still-loading child would legitimately show
		// its own loading chrome, which is not what this test is about.
		const fakeImg = { src: "data:image/png;base64,AA=" } as HTMLImageElement;
		useImageMock.mockReturnValue([fakeImg, "loaded"]);
		const filled = wellFixture({
			placeholder: { kind: "image", assetId: "a1" },
			children: [
				createImage({
					id: "img",
					bounds: { width: 200, height: 100 },
					assetId: "a1",
				}),
			],
		});
		render(
			<CanvasStudioContext.Provider
				value={{} as unknown as CanvasStudioContextValue}
			>
				<CanvasAssetsContext.Provider
					value={{ a1: { id: "a1", uri: "data:image/png;base64,AA=" } }}
				>
					<CanvasNodeRenderer node={filled} />
				</CanvasAssetsContext.Provider>
			</CanvasStudioContext.Provider>,
		);
		useImageMock.mockReturnValue([null, "loading"]);
		expect(callsOfType("Rect").some((c) => c.props.fill === "#e2e8f0")).toBe(
			false,
		);
		expect(callsOfType("Text")).toHaveLength(0);
	});

	// A placeholder whose assetId points at an asset the document does not have is
	// still an EMPTY well — same rule core's SVG serializer applies.
	it("treats a dangling assetId as unfilled", () => {
		renderInteractive(
			wellFixture({ placeholder: { kind: "image", assetId: "gone" } }),
		);
		expect(callsOfType("Rect").some((c) => c.props.fill === "#e2e8f0")).toBe(
			true,
		);
	});

	it("gives a plain frame (no placeholder) no affordance at all", () => {
		renderInteractive(
			createFrame({ id: "well", bounds: { width: 50, height: 50 } }),
		);
		expect(frameGroup()).toBeDefined();
		// The bounds-sized box Rect is always emitted (it is what keeps the frame
		// measurable), but it must carry no paint: no fallback fill, and none of
		// the dashed outline / label an empty WELL gets.
		const rects = callsOfType("Rect");
		expect(rects).toHaveLength(1);
		expect(rects[0]?.props.fill).toBeUndefined();
		expect(rects[0]?.props.stroke).toBeUndefined();
		expect(callsOfType("Text")).toHaveLength(0);
	});
});

/**
 * P1-1: video/audio are built-in kinds that used to fall through to the
 * EXTENSION fallback (`CanvasCustomNodeRenderer`), which renders nothing for
 * a built-in type — the node was present in the IR but invisible on the
 * stage. Mirrors the frame-image-well tests above: an editor-chrome-only
 * placeholder is interactive-context-gated, and a video's poster (when
 * resolved) renders as real content in every context.
 */
describe("CanvasNodeRenderer — video / audio", () => {
	beforeEachReset();

	const renderInteractive = (
		node: Parameters<typeof CanvasNodeRenderer>[0]["node"],
		assets: Record<string, { id: string; uri: string }> = {},
	) =>
		render(
			<CanvasStudioContext.Provider
				value={{} as unknown as CanvasStudioContextValue}
			>
				<CanvasAssetsContext.Provider value={assets}>
					<CanvasNodeRenderer node={node} />
				</CanvasAssetsContext.Provider>
			</CanvasStudioContext.Provider>,
		);

	it("video with no poster: renders nothing outside a studio context (export path)", () => {
		render(
			<CanvasNodeRenderer
				node={createVideo({
					id: "v1",
					bounds: { width: 100, height: 60 },
					assetId: "asset-1",
				})}
			/>,
		);
		expect(callsOfType("Group")).toHaveLength(0);
		expect(callsOfType("Rect")).toHaveLength(0);
	});

	it("video with no poster: shows a chrome-only placeholder inside a studio context", () => {
		renderInteractive(
			createVideo({
				id: "v1",
				bounds: { width: 100, height: 60 },
				assetId: "asset-1",
			}),
		);
		expect(callsOfType("Group").some((c) => c.props.id === "v1")).toBe(true);
		expect(callsOfType("Rect").some((c) => Array.isArray(c.props.dash))).toBe(
			true,
		);
		expect(callsOfType("Text")[0]?.props.text).toBe("Video");
		expect(callsOfType("Image")).toHaveLength(0);
	});

	it("video with a resolved poster: renders the poster as content in EVERY context", () => {
		const fakeImg = { src: "data:image/png;base64,XXX" } as HTMLImageElement;
		useImageMock.mockReturnValueOnce([fakeImg, "loaded"]);
		render(
			<CanvasAssetsContext.Provider
				value={{ poster1: { id: "poster1", uri: "data:image/png;base64,AA=" } }}
			>
				<CanvasNodeRenderer
					node={createVideo({
						id: "v1",
						bounds: { width: 100, height: 60 },
						assetId: "asset-1",
						poster: "poster1",
					})}
				/>
			</CanvasAssetsContext.Provider>,
		);
		expect(callsOfType("Image")[0]?.props.image).toBe(fakeImg);
		// No editor chrome outside a studio context.
		expect(callsOfType("Rect")).toHaveLength(0);
		expect(callsOfType("Text")).toHaveLength(0);
	});

	it("loads the video poster in CORS mode too (E-1)", () => {
		const fakeImg = {
			src: "https://example.com/poster.png",
		} as HTMLImageElement;
		useImageMock.mockReturnValueOnce([fakeImg, "loaded"]);
		render(
			<CanvasAssetsContext.Provider
				value={{
					poster1: { id: "poster1", uri: "https://example.com/poster.png" },
				}}
			>
				<CanvasNodeRenderer
					node={createVideo({
						id: "v1",
						bounds: { width: 100, height: 60 },
						assetId: "asset-1",
						poster: "poster1",
					})}
				/>
			</CanvasAssetsContext.Provider>,
		);
		expect(useImageMock).toHaveBeenCalledWith(
			"https://example.com/poster.png",
			"anonymous",
		);
	});

	it("video with a dangling poster assetId falls back to the placeholder like no poster at all", () => {
		renderInteractive(
			createVideo({
				id: "v1",
				bounds: { width: 100, height: 60 },
				assetId: "asset-1",
				poster: "gone",
			}),
		);
		expect(callsOfType("Image")).toHaveLength(0);
		expect(callsOfType("Text")[0]?.props.text).toBe("Video");
	});

	it("audio: renders nothing outside a studio context (matches core's emitAudio)", () => {
		render(
			<CanvasNodeRenderer
				node={createAudio({
					id: "a1",
					bounds: { width: 80, height: 24 },
					assetId: "asset-1",
				})}
			/>,
		);
		expect(callsOfType("Group")).toHaveLength(0);
		expect(callsOfType("Rect")).toHaveLength(0);
	});

	it("audio: shows a chrome-only placeholder inside a studio context", () => {
		renderInteractive(
			createAudio({
				id: "a1",
				bounds: { width: 80, height: 24 },
				assetId: "asset-1",
			}),
		);
		expect(callsOfType("Group").some((c) => c.props.id === "a1")).toBe(true);
		expect(callsOfType("Rect").some((c) => Array.isArray(c.props.dash))).toBe(
			true,
		);
		expect(callsOfType("Text")[0]?.props.text).toBe("Audio");
	});
});

describe("CanvasNodeRenderer — rich text", () => {
	beforeEachReset();
	// jsdom has no canvas 2D backend, so the real glyph measurer falls back to
	// a deterministic estimate (`canvas-glyph-measurer.ts`) — wrap-point precision
	// is covered by `text/__tests__/rich-text-layout.test.ts`'s controlled stub;
	// these tests assert structure and per-run prop mapping instead.
	afterEach(() => {
		cleanup();
	});

	it("renders one Konva.Text per run, carrying that run's own style + fill", () => {
		const node = createRichText({
			id: "rt1",
			bounds: { width: 300, height: 60 },
			paragraphs: [
				{
					spans: [
						{ text: "Hello " },
						{
							text: "World",
							fontWeight: "700",
							italic: true,
							underline: true,
							fill: "#ff0000",
						},
					],
				},
			],
		});
		render(<CanvasNodeRenderer node={node} />);
		const texts = callsOfType("Text");
		expect(texts).toHaveLength(2);
		expect(texts[0]?.props.text).toBe("Hello ");
		expect(texts[0]?.props.textDecoration).toBe("");
		expect(texts[1]?.props.text).toBe("World");
		expect(texts[1]?.props.fontStyle).toBe("italic 700");
		expect(texts[1]?.props.textDecoration).toBe("underline");
		expect(texts[1]?.props.fill).toBe("#ff0000");
	});

	it("applies textTransform to the displayed string without mutating the source span", () => {
		const node = createRichText({
			id: "rt2",
			bounds: { width: 300, height: 40 },
			paragraphs: [{ spans: [{ text: "shout", textTransform: "uppercase" }] }],
		});
		render(<CanvasNodeRenderer node={node} />);
		expect(callsOfType("Text")[0]?.props.text).toBe("SHOUT");
		expect(node.paragraphs[0]?.spans[0]?.text).toBe("shout");
	});

	it("wraps a narrow block into multiple Konva.Text runs", () => {
		const node = createRichText({
			id: "rt3",
			bounds: { width: 40, height: 200 },
			width: 40,
			paragraphs: [{ spans: [{ text: "one two three four five" }] }],
		});
		render(<CanvasNodeRenderer node={node} />);
		expect(callsOfType("Text").length).toBeGreaterThan(1);
	});

	it("clips the Group to the box for overflow 'clip', not for the 'visible' default", () => {
		const clipped = createRichText({
			id: "rt-clip",
			bounds: { width: 100, height: 40 },
			height: 40,
			overflow: "clip",
			paragraphs: [{ spans: [{ text: "Hi" }] }],
		});
		render(<CanvasNodeRenderer node={clipped} />);
		const clippedGroup = callsOfType("Group").find(
			(c) => c.props.id === "rt-clip",
		);
		expect(clippedGroup?.props.clipWidth).toBe(100);
		expect(clippedGroup?.props.clipHeight).toBe(40);

		cleanup();
		calls.length = 0;
		const visible = createRichText({
			id: "rt-visible",
			bounds: { width: 100, height: 40 },
			paragraphs: [{ spans: [{ text: "Hi" }] }],
		});
		render(<CanvasNodeRenderer node={visible} />);
		const visibleGroup = callsOfType("Group").find(
			(c) => c.props.id === "rt-visible",
		);
		expect(visibleGroup?.props.clipWidth).toBeUndefined();
	});

	it("renders no Text for an empty paragraph but still emits the wrapping Group", () => {
		const node = createRichText({
			id: "rt-empty",
			bounds: { width: 100, height: 40 },
		});
		render(<CanvasNodeRenderer node={node} />);
		expect(callsOfType("Text")).toHaveLength(0);
		expect(callsOfType("Group").some((c) => c.props.id === "rt-empty")).toBe(
			true,
		);
	});
});

describe("effects → Konva shadow props (C-03)", () => {
	beforeEachReset();
	const originalFontsDescriptor = Object.getOwnPropertyDescriptor(
		document,
		"fonts",
	);
	afterEach(() => {
		cleanup();
		resetFontStatusesForTests();
		if (originalFontsDescriptor) {
			Object.defineProperty(document, "fonts", originalFontsDescriptor);
		} else {
			Reflect.deleteProperty(document, "fonts");
		}
	});

	it("legacy shadow still renders (resolver fallback)", () => {
		const rect = createRect({
			id: "r-legacy",
			bounds: { width: 10, height: 10 },
		});
		(rect as { shadow?: unknown }).shadow = {
			color: "#112233",
			blur: 4,
			offsetX: 2,
			offsetY: 3,
		};
		render(<CanvasNodeRenderer node={rect} />);
		expect(callsOfType("Rect")[0]?.props).toMatchObject({
			shadowColor: "#112233",
			shadowBlur: 4,
			shadowOffsetX: 2,
			shadowOffsetY: 3,
		});
	});

	it("effects win over legacy shadow; a spread routes to the ghost draw, never to a widened blur (K-10)", () => {
		const rect = createRect({ id: "r-fx", bounds: { width: 10, height: 10 } });
		(rect as { shadow?: unknown; effects?: unknown }).shadow = {
			color: "#000000",
			blur: 1,
			offsetX: 0,
			offsetY: 0,
		};
		(rect as { effects?: unknown }).effects = [
			{
				type: "drop-shadow",
				color: "#ff0000",
				blur: 4,
				offsetX: 1,
				offsetY: 1,
				spread: 3,
			},
		];
		render(<CanvasNodeRenderer node={rect} />);
		const props = callsOfType("Rect")[0]?.props as Record<string, unknown>;
		// `spread` used to be faked by drawing a blur of 4 + 3 = 7, which is not
		// what the SVG serializer renders. It is now a real dilation drawn by
		// `shadow-ghosts.ts`, so Konva's native shadow props must be ABSENT —
		// leaving one behind would paint the shadow twice.
		expect(props.sceneFunc).toBeTypeOf("function");
		expect(props.hitFunc).toBeTypeOf("function");
		expect(props.shadowBlur).toBeUndefined();
		expect(props.shadowColor).toBeUndefined();
	});

	it("a single spread-less shadow keeps Konva's native props, with the blur unwidened (K-10)", () => {
		const rect = createRect({
			id: "r-native",
			bounds: { width: 10, height: 10 },
		});
		(rect as { effects?: unknown }).effects = [
			{
				type: "drop-shadow",
				color: "#00ff00",
				blur: 5,
				offsetX: 2,
				offsetY: 2,
			},
		];
		render(<CanvasNodeRenderer node={rect} />);
		const props = callsOfType("Rect")[0]?.props as Record<string, unknown>;
		// Konva expresses this one exactly, so it must NOT pay for the ghost path.
		expect(props.shadowBlur).toBe(5);
		expect(props.shadowColor).toBe("#00ff00");
		expect(props.sceneFunc).toBeUndefined();
		expect(props.hitFunc).toBeUndefined();
	});

	it("a blur effect reaches Konva as a filter — the canvas used to render it as nothing (K-18)", () => {
		const rect = createRect({
			id: "r-blur",
			bounds: { width: 10, height: 10 },
		});
		(rect as { effects?: unknown }).effects = [{ type: "blur", radius: 6 }];
		render(<CanvasNodeRenderer node={rect} />);
		const props = callsOfType("Rect")[0]?.props as Record<string, unknown>;
		expect(Array.isArray(props.filters)).toBe(true);
		expect((props.filters as unknown[]).length).toBe(1);
		expect(props.blurRadius).toBeGreaterThan(0);
	});

	it("temporarily removes blur and shadow work in simplified interaction mode", () => {
		const rect = {
			...createRect({ id: "r-simplified", bounds: { width: 10, height: 10 } }),
			effects: [
				{ type: "blur" as const, radius: 6 },
				{
					type: "drop-shadow" as const,
					color: "#112233",
					blur: 4,
					offsetX: 2,
					offsetY: 3,
				},
			],
		};
		const tree = (simplified: boolean) => (
			<CanvasSimplifiedEffectsContext.Provider value={simplified}>
				<CanvasNodeRenderer node={rect} />
			</CanvasSimplifiedEffectsContext.Provider>
		);
		const view = render(tree(false));
		const stub = callsOfType("Rect").at(-1)?.node;
		expect(stub?.cache).toHaveBeenCalledTimes(1);

		view.rerender(tree(true));
		const props = callsOfType("Rect").at(-1)?.props as Record<string, unknown>;
		expect(props.filters).toBeUndefined();
		expect(props.blurRadius).toBeUndefined();
		expect(props.shadowColor).toBeUndefined();
		expect(props.sceneFunc).toBeUndefined();
		expect(stub?.clearCache).toHaveBeenCalled();
	});

	it("rebuilds a blurred token-fill cache when its resolved brand paint changes", () => {
		const rect = {
			...createRect({
				id: "r-brand-blur",
				bounds: { width: 10, height: 10 },
				fill: { type: "brand-token", tokenType: "color", id: "primary" },
			}),
			effects: [{ type: "blur" as const, radius: 3 }],
		};
		const tree = (value: string) => (
			<CanvasBrandKitContext.Provider
				value={{
					colors: [{ id: "primary", name: "Primary", value }],
					fonts: [],
				}}
			>
				<CanvasNodeRenderer node={rect} />
			</CanvasBrandKitContext.Provider>
		);
		const view = render(tree("#ff0000"));
		const stub = callsOfType("Rect").at(-1)?.node;
		expect(stub?.cache).toHaveBeenCalledTimes(1);

		view.rerender(tree("#0000ff"));
		expect(callsOfType("Rect").at(-1)?.props.fill).toBe("#0000ff");
		expect(stub?.cache).toHaveBeenCalledTimes(2);
	});

	it("rebuilds a blurred text cache when its web font finishes loading", async () => {
		let resolveLoad: (faces: unknown[]) => void = () => undefined;
		const load = vi.fn(
			() =>
				new Promise<unknown[]>((resolve) => {
					resolveLoad = resolve;
				}),
		);
		Object.defineProperty(document, "fonts", {
			configurable: true,
			value: { check: () => false, load },
		});
		const text = {
			...createText({
				id: "t-font-blur",
				bounds: { width: 100, height: 20 },
				text: "Blurred",
				fontFamily: "Pending Blur Font",
			}),
			effects: [{ type: "blur" as const, radius: 3 }],
		};
		render(<CanvasNodeRenderer node={text} />);
		await waitFor(() => expect(load).toHaveBeenCalledTimes(1));
		const stub = callsOfType("Text").at(-1)?.node;
		const loadingCacheCount = stub?.cache.mock.calls.length ?? 0;

		resolveLoad([{}]);
		await waitFor(() =>
			expect(stub?.cache.mock.calls.length).toBeGreaterThan(loadingCacheCount),
		);
	});

	it("leaves an unblurred node with no filters, cache or ref override (K-18)", () => {
		const rect = createRect({
			id: "r-sharp",
			bounds: { width: 10, height: 10 },
		});
		render(<CanvasNodeRenderer node={rect} />);
		const props = callsOfType("Rect")[0]?.props as Record<string, unknown>;
		expect(props.filters).toBeUndefined();
		expect(props.blurRadius).toBeUndefined();
	});

	it("a shadow STACK routes to the ghost draw — the live canvas no longer drops all but the first (K-10)", () => {
		const rect = createRect({
			id: "r-stack",
			bounds: { width: 10, height: 10 },
		});
		(rect as { effects?: unknown }).effects = [
			{
				type: "drop-shadow",
				color: "#ff0000",
				blur: 2,
				offsetX: 1,
				offsetY: 1,
			},
			{
				type: "drop-shadow",
				color: "#0000ff",
				blur: 6,
				offsetX: 4,
				offsetY: 4,
			},
		];
		render(<CanvasNodeRenderer node={rect} />);
		const props = callsOfType("Rect")[0]?.props as Record<string, unknown>;
		expect(props.sceneFunc).toBeTypeOf("function");
		expect(props.shadowColor).toBeUndefined();
	});

	it("effects: [] suppresses the legacy shadow entirely", () => {
		const rect = createRect({
			id: "r-none",
			bounds: { width: 10, height: 10 },
		});
		(rect as { shadow?: unknown; effects?: unknown }).shadow = {
			color: "#000000",
			blur: 4,
			offsetX: 2,
			offsetY: 2,
		};
		(rect as { effects?: unknown }).effects = [];
		render(<CanvasNodeRenderer node={rect} />);
		expect(callsOfType("Rect")[0]?.props.shadowColor).toBeUndefined();
	});
});

describe("CanvasNodeRenderer — FR-095 asset placeholders", () => {
	beforeEachReset();

	const interactive = (
		node: Parameters<typeof CanvasNodeRenderer>[0]["node"],
	) =>
		render(
			<CanvasStudioContext.Provider
				value={{} as unknown as CanvasStudioContextValue}
			>
				<CanvasNodeRenderer node={node} />
			</CanvasStudioContext.Provider>,
		);

	const textLabels = () =>
		callsOfType("Text").map((c) => c.props.text as string);

	it("image with a missing asset shows selectable 'Missing image' chrome in the editor", () => {
		const image = createImage({
			id: "i-missing",
			bounds: { width: 100, height: 80 },
			assetId: "nope",
		});
		interactive(image);
		expect(textLabels()).toContain("Missing image");
		// The wrapping Group carries the node id, keeping it hit-testable.
		expect(callsOfType("Group").some((c) => c.props.id === "i-missing")).toBe(
			true,
		);
	});

	it("image whose load failed shows 'Image failed to load' chrome in the editor", () => {
		useImageMock.mockReturnValueOnce([null, "failed"]);
		const image = createImage({
			id: "i-err",
			bounds: { width: 100, height: 80 },
			assetId: "a1",
		});
		render(
			<CanvasStudioContext.Provider
				value={{} as unknown as CanvasStudioContextValue}
			>
				<CanvasAssetsContext.Provider
					value={{ a1: { id: "a1", uri: "https://example.com/broken.png" } }}
				>
					<CanvasNodeRenderer node={image} />
				</CanvasAssetsContext.Provider>
			</CanvasStudioContext.Provider>,
		);
		expect(textLabels()).toContain("Image failed to load");
	});

	it("image with a known-unsupported mimeType shows 'Unsupported image format' chrome (FR-095)", () => {
		useImageMock.mockReturnValueOnce([null, "failed"]);
		const image = createImage({
			id: "i-unsupported",
			bounds: { width: 100, height: 80 },
			assetId: "a1",
		});
		render(
			<CanvasStudioContext.Provider
				value={{} as unknown as CanvasStudioContextValue}
			>
				<CanvasAssetsContext.Provider
					value={{
						a1: {
							id: "a1",
							uri: "https://example.com/scan.tif",
							mimeType: "image/tiff",
						},
					}}
				>
					<CanvasNodeRenderer node={image} />
				</CanvasAssetsContext.Provider>
			</CanvasStudioContext.Provider>,
		);
		expect(textLabels()).toContain("Unsupported image format");
		expect(textLabels()).not.toContain("Image failed to load");
	});

	it("a KNOWN-supported mimeType still shows the generic load-error chrome, not unsupported", () => {
		useImageMock.mockReturnValueOnce([null, "failed"]);
		const image = createImage({
			id: "i-err-known-type",
			bounds: { width: 100, height: 80 },
			assetId: "a1",
		});
		render(
			<CanvasStudioContext.Provider
				value={{} as unknown as CanvasStudioContextValue}
			>
				<CanvasAssetsContext.Provider
					value={{
						a1: {
							id: "a1",
							uri: "https://example.com/broken.png",
							mimeType: "image/png",
						},
					}}
				>
					<CanvasNodeRenderer node={image} />
				</CanvasAssetsContext.Provider>
			</CanvasStudioContext.Provider>,
		);
		expect(textLabels()).toContain("Image failed to load");
		expect(textLabels()).not.toContain("Unsupported image format");
	});

	it("image still loading shows the loading chrome in the editor", () => {
		useImageMock.mockReturnValueOnce([null, "loading"]);
		const image = createImage({
			id: "i-loading",
			bounds: { width: 100, height: 80 },
			assetId: "a1",
		});
		render(
			<CanvasStudioContext.Provider
				value={{} as unknown as CanvasStudioContextValue}
			>
				<CanvasAssetsContext.Provider
					value={{ a1: { id: "a1", uri: "data:image/png;base64,XXX" } }}
				>
					<CanvasNodeRenderer node={image} />
				</CanvasAssetsContext.Provider>
			</CanvasStudioContext.Provider>,
		);
		expect(textLabels()).toContain("Loading image…");
	});

	it("svg with a missing asset shows 'Missing graphic' chrome in the editor", () => {
		const svg = createSvg({
			id: "s-missing",
			bounds: { width: 60, height: 60 },
			assetId: "nope",
		});
		interactive(svg);
		expect(textLabels()).toContain("Missing graphic");
	});

	it("missing-asset chrome never renders outside the editor (export path)", () => {
		const image = createImage({
			id: "i-export",
			bounds: { width: 100, height: 80 },
			assetId: "nope",
		});
		render(<CanvasNodeRenderer node={image} />);
		expect(callsOfType("Text")).toHaveLength(0);
		expect(callsOfType("Rect")).toHaveLength(0);
	});
});

/**
 * FR-170 asset-missing toast: `AssetPlaceholder` chrome above (FR-095) is a
 * pure render, so a real toast side effect can't live there — this covers
 * the `useEffect`-driven `useMissingAssetToast` seam instead (dedupe +
 * batching), not the visual chrome.
 */
describe("CanvasNodeRenderer — FR-170 asset missing toast", () => {
	beforeEachReset();
	afterEach(() => {
		cleanup();
	});

	function renderWithToaster(
		nodes: readonly Parameters<typeof CanvasNodeRenderer>[0]["node"][],
		toasts: CanvasToastInput[],
	) {
		return render(
			<CanvasStudioContext.Provider
				value={{} as unknown as CanvasStudioContextValue}
			>
				<CanvasToastContext.Provider
					value={{ add: (input) => toasts.push(input) }}
				>
					{nodes.map((n) => (
						<CanvasNodeRenderer key={n.id} node={n} />
					))}
				</CanvasToastContext.Provider>
			</CanvasStudioContext.Provider>,
		);
	}

	it("fires one warning toast, after a short batch window, when a single image goes missing", async () => {
		const toasts: CanvasToastInput[] = [];
		const image = createImage({
			id: "i-missing-toast",
			bounds: { width: 100, height: 80 },
			assetId: "nope",
		});
		renderWithToaster([image], toasts);
		await waitFor(() => {
			expect(toasts).toHaveLength(1);
		});
		expect(toasts[0]?.type).toBe("warning");
		expect(toasts[0]?.title).toBe("An asset is missing");
	});

	it("batches several simultaneously-missing nodes (image + svg) into ONE combined toast", async () => {
		const toasts: CanvasToastInput[] = [];
		const nodes = [
			createImage({
				id: "batch-1",
				bounds: { width: 10, height: 10 },
				assetId: "nope",
			}),
			createImage({
				id: "batch-2",
				bounds: { width: 10, height: 10 },
				assetId: "nope",
			}),
			createSvg({
				id: "batch-3",
				bounds: { width: 10, height: 10 },
				assetId: "nope",
			}),
		];
		renderWithToaster(nodes, toasts);
		await waitFor(() => {
			expect(toasts).toHaveLength(1);
		});
		expect(toasts[0]?.title).toBe("3 assets are missing");
	});

	it("does not toast for a load FAILURE (status: failed) — only for a genuinely missing reference", async () => {
		useImageMock.mockReturnValueOnce([null, "failed"]);
		const toasts: CanvasToastInput[] = [];
		const image = createImage({
			id: "i-err-no-toast",
			bounds: { width: 100, height: 80 },
			assetId: "a1",
		});
		render(
			<CanvasStudioContext.Provider
				value={{} as unknown as CanvasStudioContextValue}
			>
				<CanvasToastContext.Provider
					value={{ add: (input) => toasts.push(input) }}
				>
					<CanvasAssetsContext.Provider
						value={{ a1: { id: "a1", uri: "https://example.com/broken.png" } }}
					>
						<CanvasNodeRenderer node={image} />
					</CanvasAssetsContext.Provider>
				</CanvasToastContext.Provider>
			</CanvasStudioContext.Provider>,
		);
		// Give the batch window a chance to fire — it must not.
		await new Promise((resolve) => setTimeout(resolve, 80));
		expect(toasts).toHaveLength(0);
	});

	it("does not toast outside the editor (export/rasterize path — no CanvasStudioContext)", async () => {
		const toasts: CanvasToastInput[] = [];
		const image = createImage({
			id: "i-export-no-toast",
			bounds: { width: 100, height: 80 },
			assetId: "nope",
		});
		render(
			<CanvasToastContext.Provider
				value={{ add: (input) => toasts.push(input) }}
			>
				<CanvasNodeRenderer node={image} />
			</CanvasToastContext.Provider>,
		);
		await new Promise((resolve) => setTimeout(resolve, 80));
		expect(toasts).toHaveLength(0);
	});
});

describe("CanvasNodeRenderer — FR-081 vertical align + auto-width", () => {
	beforeEachReset();

	function vNode(verticalAlign: "top" | "middle" | "bottom") {
		return createRichText({
			id: `rt-${verticalAlign}`,
			bounds: { width: 300, height: 200 },
			height: 200,
			verticalAlign,
			paragraphs: [{ spans: [{ text: "hi" }] }],
		});
	}

	it("shifts the block down for middle/bottom vertical align", () => {
		render(<CanvasNodeRenderer node={vNode("top")} />);
		const topY = callsOfType("Text")[0]?.props.y as number;
		calls.length = 0;
		render(<CanvasNodeRenderer node={vNode("middle")} />);
		const midY = callsOfType("Text")[0]?.props.y as number;
		calls.length = 0;
		render(<CanvasNodeRenderer node={vNode("bottom")} />);
		const botY = callsOfType("Text")[0]?.props.y as number;
		expect(topY).toBe(0);
		expect(midY).toBeGreaterThan(topY);
		expect(botY).toBeGreaterThan(midY);
	});

	it("auto-width reconciles bounds.width to the measured content width", () => {
		const commitCoalesced = vi.fn();
		const node = createRichText({
			id: "rt-auto",
			bounds: { width: 999, height: 40 },
			sizing: "auto-width",
			paragraphs: [{ spans: [{ text: "hi" }] }],
		});
		render(
			<CanvasStudioContext.Provider
				value={
					{
						commitCoalesced,
						getIR: () => ({}),
					} as unknown as CanvasStudioContextValue
				}
			>
				<CanvasNodeRenderer node={node} />
			</CanvasStudioContext.Provider>,
		);
		expect(commitCoalesced).toHaveBeenCalledTimes(1);
		const [cmd] = commitCoalesced.mock.calls[0] as [
			{ patch: { width: number; bounds: { width: number } } },
		];
		// The measured natural width is far smaller than the stale 999.
		expect(cmd.patch.width).toBeLessThan(999);
		expect(cmd.patch.bounds.width).toBe(cmd.patch.width);
	});
});

/**
 * E-11 — `AdjustedKonvaImage`'s Konva filter cache.
 *
 * Konva re-runs pixel filters only when a node's cache is rebuilt, so the
 * cache-rebuild effect's dependency list IS the correctness contract, and it is
 * wrong in BOTH directions: too narrow and a cropped, adjusted image keeps
 * painting the pre-crop cached pixels; too wide (an inline `filters` array
 * literal — a fresh reference every render) and the expensive pixel pass
 * re-runs on every commit. Both are observed through the react-konva mock's
 * `ref` stub: the `crop`-prop assertions above say nothing about whether the
 * cache behind it was refreshed.
 */
describe("CanvasNodeRenderer — adjusted image filter cache (E-11)", () => {
	beforeEachReset();
	afterEach(() => {
		cleanup();
	});

	const assets = { a1: { id: "a1", uri: "data:image/png;base64,XXX" } };
	// Stable identity across re-renders, like a real loaded HTMLImageElement —
	// `image` is itself one of the cache effect's dependencies.
	const fakeImg = {
		src: "data:image/png;base64,XXX",
		width: 200,
		height: 200,
	} as HTMLImageElement;

	const adjusted = (
		over: Partial<Parameters<typeof createImage>[0]> = {},
	): CanvasImageNode =>
		createImage({
			id: "i-adjusted",
			bounds: { width: 100, height: 100 },
			assetId: "a1",
			// Non-neutral, so `computeAdjustmentColorMatrix` returns a matrix and
			// the node is genuinely filtered (`active`).
			adjustments: { brightness: 0.2 },
			crop: { x: 0, y: 0, width: 50, height: 50 },
			...over,
		});

	const tree = (node: CanvasImageNode) => (
		<CanvasAssetsContext.Provider value={assets}>
			<CanvasNodeRenderer node={node} />
		</CanvasAssetsContext.Provider>
	);

	const lastImage = () => callsOfType("Image").at(-1);

	it("keeps the `filters` array reference stable across an unrelated re-render", () => {
		useImageMock.mockReturnValue([fakeImg, "loaded"]);
		const { rerender } = render(tree(adjusted()));
		const first = lastImage();
		expect(Array.isArray(first?.props.filters)).toBe(true);

		rerender(tree(adjusted({ transform: { x: 25, y: 0 } })));
		const second = lastImage();
		// The re-render really reached Konva...
		expect(callsOfType("Image").length).toBeGreaterThan(1);
		expect(second?.props.x).toBe(25);
		// ...and carried the SAME array. An unmemoized literal is a new
		// reference every render, and Konva re-runs the pixel filter whenever
		// the `filters` reference changes — not only when it needs to.
		expect(Object.is(first?.props.filters, second?.props.filters)).toBe(true);
	});

	it("rebuilds the cache when the crop CONTENT changes, and not otherwise", () => {
		useImageMock.mockReturnValue([fakeImg, "loaded"]);
		const { rerender } = render(tree(adjusted()));
		const stub = lastImage()?.node;
		expect(stub).toBeDefined();
		expect(stub?.cache).toHaveBeenCalledTimes(1);

		// Control: a prop outside the cache's inputs must NOT rebuild it.
		rerender(tree(adjusted({ transform: { x: 25, y: 0 } })));
		expect(lastImage()?.props.x).toBe(25);
		expect(stub?.cache).toHaveBeenCalledTimes(1);

		// `crop` is a fresh object every render, so only its serialized CONTENT
		// can invalidate the effect — drop `cropKey` from the deps and the
		// newly cropped image keeps drawing the stale cached pixels.
		rerender(tree(adjusted({ crop: { x: 10, y: 10, width: 50, height: 50 } })));
		expect(lastImage()?.props.crop).toEqual({
			x: 10,
			y: 10,
			width: 50,
			height: 50,
		});
		expect(stub?.cache).toHaveBeenCalledTimes(2);
	});

	// K-7. Konva filters read and write ONLY the cached bitmap, so a blur cached
	// at the default `offset: 0` has nowhere to bleed — the kernel samples
	// transparent pixels past the node's own bounds and the blur is cut off
	// square instead of fading, which also diverges from the SVG export this
	// path is meant to match.
	it("pads the cache by the blur radius when a blur is active", () => {
		useImageMock.mockReturnValue([fakeImg, "loaded"]);
		render(tree(adjusted({ adjustments: { blur: 3 } })));
		expect(lastImage()?.node?.cache).toHaveBeenCalledWith({ offset: 3 });
	});

	it("rounds a fractional blur radius up to a whole-pixel pad", () => {
		useImageMock.mockReturnValue([fakeImg, "loaded"]);
		render(tree(adjusted({ adjustments: { blur: 2.4 } })));
		expect(lastImage()?.node?.cache).toHaveBeenCalledWith({ offset: 3 });
	});

	it("caches unpadded when the adjustment carries no blur", () => {
		useImageMock.mockReturnValue([fakeImg, "loaded"]);
		// Colour-only adjustment: still filtered (so still cached), but a pad
		// would just waste bitmap around every adjusted image.
		render(tree(adjusted({ adjustments: { brightness: 0.2 } })));
		expect(lastImage()?.node?.cache).toHaveBeenCalledWith(undefined);
	});

	// K-11. react-konva applies the `filters` prop during ITS commit and asks
	// for a draw right there, so the cache has to exist by the end of that same
	// commit — Konva skips filtering entirely on a node that has `filters` and
	// no cache, so building it in a passive effect left one painted frame
	// showing the unfiltered image.
	//
	// The discriminator is PHASE, not wall-clock: React runs every layout
	// effect during the commit, before any passive effect anywhere in the tree.
	// So a passive probe mounted as an EARLIER sibling runs before the image's
	// own passive effect but after every layout effect — which pins the phase
	// from the outside, without reaching into React internals. `vi.fn()`
	// records a global `invocationCallOrder`, so the two are directly
	// comparable.
	it("builds the cache in the layout phase, before any passive effect", () => {
		useImageMock.mockReturnValue([fakeImg, "loaded"]);
		const probePassive = vi.fn();
		function PassiveProbe() {
			useEffect(() => {
				probePassive();
			}, []);
			return null;
		}
		render(
			<CanvasAssetsContext.Provider value={assets}>
				<PassiveProbe />
				<CanvasNodeRenderer node={adjusted()} />
			</CanvasAssetsContext.Provider>,
		);

		const cacheFn = lastImage()?.node?.cache;
		const cacheOrder = cacheFn?.mock.invocationCallOrder[0];
		const probeOrder = probePassive.mock.invocationCallOrder[0];
		expect(cacheOrder).toBeDefined();
		expect(probeOrder).toBeDefined();
		// Layout phase precedes the passive phase. Demote the cache effect to
		// `useEffect` and this flips: the probe is the earlier sibling, so its
		// passive effect would run first.
		expect(cacheOrder as number).toBeLessThan(probeOrder as number);
	});
});
