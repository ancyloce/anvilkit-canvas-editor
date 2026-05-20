import {
	createCanvasIR,
	createEllipse,
	createGroup,
	createImage,
	createLine,
	createPage,
	createRect,
	createText,
} from "@anvilkit/canvas-core";
import { render } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";

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

	it("renders an ai-placeholder as a dashed rect + label group", () => {
		const placeholder = {
			id: "ai1",
			type: "ai-placeholder" as const,
			transform: { x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1 },
			bounds: { width: 200, height: 200 },
			zIndex: 0,
			jobId: "job-1",
			status: "pending" as const,
		};
		render(<CanvasNodeRenderer node={placeholder} />);
		expect(callsOfType("Group")).toHaveLength(1);
		expect(callsOfType("Rect")).toHaveLength(1);
		expect(callsOfType("Text")).toHaveLength(1);
		expect(callsOfType("Rect")[0]?.props.dash).toEqual([6, 4]);
		expect(callsOfType("Text")[0]?.props.text).toBe("AI pending…");
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
