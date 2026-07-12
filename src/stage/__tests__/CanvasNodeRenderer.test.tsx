import {
	createCanvasIR,
	createEllipse,
	createFrame,
	createGroup,
	createImage,
	createLine,
	createPage,
	createRect,
	createRichText,
	createText,
} from "@anvilkit/canvas-core";
import { cleanup, render } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

type ElementCall = { type: string; props: Record<string, unknown> };
const calls: ElementCall[] = [];

function makeMock(type: string) {
	return (props: Record<string, unknown>) => {
		calls.push({ type, props });
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
	Line: makeMock("Line"),
	Path: makeMock("Path"),
	Text: makeMock("Text"),
	Image: makeMock("Image"),
}));

const useImageMock = vi.fn(() => [null, "loading"]);
vi.mock("use-image", () => ({
	default: (uri: string) => useImageMock(uri),
}));

import {
	CanvasStudioContext,
	type CanvasStudioContextValue,
} from "@/context/canvas-studio-context.js";
import { createAiJobStore } from "@/stores/ai-job-store.js";
import { CanvasAssetsContext } from "../CanvasAssetsContext.js";
import { CanvasNodeRenderer } from "../CanvasNodeRenderer.js";

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

	it("paints no background Rect when the frame has no background", () => {
		render(<CanvasNodeRenderer node={frameFixture()} />);
		// Only the child rect — no backdrop.
		expect(callsOfType("Rect")).toHaveLength(1);
		expect(callsOfType("Rect")[0]?.props.id).toBe("r1");
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

function beforeEachReset() {
	const { beforeEach } = import.meta.vitest!;
	beforeEach(() => {
		calls.length = 0;
		useImageMock.mockReset();
		useImageMock.mockImplementation(() => [null, "loading"]);
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
		expect(callsOfType("Rect")).toHaveLength(0);
		expect(callsOfType("Text")).toHaveLength(0);
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
