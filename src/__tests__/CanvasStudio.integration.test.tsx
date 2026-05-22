import {
	createCanvasIR,
	createGroup,
	createImage,
	createPage,
	createRect,
	createText,
} from "@anvilkit/canvas-core";
import { render } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

type ElementCall = { type: string; props: Record<string, unknown> };
const calls: ElementCall[] = [];
const destroyMock = vi.fn();

function makeMock(type: string) {
	return (props: Record<string, unknown>) => {
		calls.push({ type, props });
		const { children } = props as { children?: ReactNode };
		const name = (props.name as string | undefined) ?? "";
		const id = (props.id as string | undefined) ?? "";
		return (
			<div data-testid={type.toLowerCase()} data-layer-name={name} data-id={id}>
				{children}
			</div>
		);
	};
}

vi.mock("react-konva", () => {
	type StageProps = {
		children?: ReactNode;
		ref?: { current: object | null };
		width?: number;
		height?: number;
	};
	const Stage = (props: StageProps) => {
		calls.push({ type: "Stage", props: props as Record<string, unknown> });
		if (props.ref && "current" in props.ref) {
			const container = document.createElement("div");
			props.ref.current = {
				destroy: destroyMock,
				on: vi.fn(),
				off: vi.fn(),
				container: () => container,
				getPointerPosition: () => null,
				getAbsoluteTransform: () => ({
					copy: () => ({
						invert: () => ({
							point: (p: { x: number; y: number }) => p,
						}),
					}),
				}),
			};
		}
		return <div data-testid="stage">{props.children}</div>;
	};
	return {
		Stage,
		Layer: makeMock("Layer"),
		Group: makeMock("Group"),
		Rect: makeMock("Rect"),
		Ellipse: makeMock("Ellipse"),
		Line: makeMock("Line"),
		Path: makeMock("Path"),
		Text: makeMock("Text"),
		Image: makeMock("Image"),
		Transformer: makeMock("Transformer"),
	};
});

vi.mock("use-image", () => ({
	default: () => [null, "loading"],
}));

import { CanvasStudio, type Tool } from "../index.js";

function layerCalls() {
	return calls.filter((c) => c.type === "Layer");
}

describe("CanvasStudio integration", () => {
	beforeEach(() => {
		calls.length = 0;
		destroyMock.mockClear();
	});

	it("renders four layers in canonical z-order with correct listening flags", () => {
		const ir = createCanvasIR({
			pages: [createPage({ id: "p1" })],
			now: () => "2026-01-01T00:00:00.000Z",
		});
		render(<CanvasStudio initialIR={ir} initialActivePageId="p1" />);
		// Dedupe by name: CanvasStudio re-renders once when CanvasStage's
		// onReady captures the stage into context state. Structure assertion
		// should be render-count-tolerant.
		const layersByName = new Map<string, ElementCall>();
		for (const l of layerCalls()) {
			const name = l.props.name as string;
			if (!layersByName.has(name)) layersByName.set(name, l);
		}
		expect(Array.from(layersByName.keys())).toEqual([
			"background",
			"objects",
			"selection",
			"presence",
		]);
		expect(layersByName.get("background")?.props.listening).toBe(false);
		expect(layersByName.get("objects")?.props.listening).toBe(true);
		expect(layersByName.get("selection")?.props.listening).toBe(true);
		expect(layersByName.get("presence")?.props.listening).toBe(false);
	});

	it("renders one CanvasNodeRenderer per top-level child of the active page root", () => {
		const ir = createCanvasIR({
			pages: [
				(() => {
					const page = createPage({ id: "p1" });
					page.root = createGroup({
						id: "p1-root",
						bounds: page.root.bounds,
						children: [
							createRect({
								id: "r1",
								bounds: { width: 10, height: 10 },
							}),
							createText({
								id: "t1",
								bounds: { width: 100, height: 24 },
								text: "hi",
							}),
							createImage({
								id: "i1",
								bounds: { width: 100, height: 100 },
								assetId: "a1",
							}),
						],
					});
					return page;
				})(),
			],
			now: () => "2026-01-01T00:00:00.000Z",
		});
		render(<CanvasStudio initialIR={ir} initialActivePageId="p1" />);
		// Rect + Text emitted; Image suppressed because use-image returns loading.
		const rectCalls = calls.filter((c) => c.type === "Rect");
		const textCalls = calls.filter((c) => c.type === "Text");
		expect(rectCalls.some((c) => c.props.id === "r1")).toBe(true);
		expect(textCalls.some((c) => c.props.id === "t1")).toBe(true);
		const imageCalls = calls.filter((c) => c.type === "Image");
		expect(imageCalls).toHaveLength(0);
	});

	it("switching activePageId renders the second page's children", () => {
		const page1 = createPage({ id: "p1" });
		page1.root = createGroup({
			id: "p1-root",
			bounds: page1.root.bounds,
			children: [
				createRect({ id: "r-page1", bounds: { width: 10, height: 10 } }),
			],
		});
		const page2 = createPage({ id: "p2" });
		page2.root = createGroup({
			id: "p2-root",
			bounds: page2.root.bounds,
			children: [
				createText({
					id: "t-page2",
					bounds: { width: 50, height: 24 },
					text: "two",
				}),
			],
		});
		const ir = createCanvasIR({
			pages: [page1, page2],
			now: () => "2026-01-01T00:00:00.000Z",
		});
		render(<CanvasStudio initialIR={ir} initialActivePageId="p2" />);
		const ids = calls.map((c) => c.props.id).filter(Boolean);
		expect(ids).toContain("t-page2");
		expect(ids).not.toContain("r-page1");
	});

	it("renders the empty fallback for an unknown activePageId", () => {
		const ir = createCanvasIR({
			pages: [createPage({ id: "p1" })],
			now: () => "2026-01-01T00:00:00.000Z",
		});
		const { getByTestId } = render(
			<CanvasStudio initialIR={ir} initialActivePageId="missing" />,
		);
		expect(getByTestId("canvas-empty")).toBeTruthy();
	});

	it("calls stage.destroy() on unmount", () => {
		const ir = createCanvasIR({
			pages: [createPage({ id: "p1" })],
			now: () => "2026-01-01T00:00:00.000Z",
		});
		const { unmount } = render(
			<CanvasStudio initialIR={ir} initialActivePageId="p1" />,
		);
		expect(destroyMock).not.toHaveBeenCalled();
		unmount();
		expect(destroyMock).toHaveBeenCalledTimes(1);
	});

	it("uses the active page's size for the Stage when width/height props are omitted", () => {
		const page = createPage({
			id: "p1",
			size: { width: 1234, height: 567, unit: "px" },
		});
		const ir = createCanvasIR({
			pages: [page],
			now: () => "2026-01-01T00:00:00.000Z",
		});
		render(<CanvasStudio initialIR={ir} initialActivePageId="p1" />);
		const stage = calls.find((c) => c.type === "Stage");
		expect(stage?.props.width).toBe(1234);
		expect(stage?.props.height).toBe(567);
	});

	it("PRD §9.2 scenario 2 partial: text + rect + image are all dispatched", () => {
		const page = createPage({ id: "p1" });
		page.root = createGroup({
			id: "p1-root",
			bounds: page.root.bounds,
			children: [
				createText({
					id: "t",
					bounds: { width: 100, height: 24 },
					text: "Hello",
				}),
				createRect({
					id: "r",
					bounds: { width: 50, height: 50 },
					fill: "#abc",
				}),
				createImage({
					id: "img",
					bounds: { width: 100, height: 100 },
					assetId: "a1",
				}),
			],
		});
		const ir = createCanvasIR({
			pages: [page],
			now: () => "2026-01-01T00:00:00.000Z",
		});
		ir.assets["a1"] = { id: "a1", uri: "data:image/png;base64,XXX" };
		render(<CanvasStudio initialIR={ir} initialActivePageId="p1" />);
		expect(calls.some((c) => c.type === "Text" && c.props.id === "t")).toBe(
			true,
		);
		expect(calls.some((c) => c.type === "Rect" && c.props.id === "r")).toBe(
			true,
		);
		// Image suppressed by loading state (mock returns ["loading"]).
		expect(calls.some((c) => c.type === "Image")).toBe(false);
	});

	it("renders stubs (DesignBackground/Grid/RemoteCursors/RemoteSelections) without errors", () => {
		const ir = createCanvasIR({
			pages: [createPage({ id: "p1" })],
			now: () => "2026-01-01T00:00:00.000Z",
		});
		expect(() =>
			render(<CanvasStudio initialIR={ir} initialActivePageId="p1" />),
		).not.toThrow();
		// Stubs return null, so they don't show up in `calls`. The fact that
		// rendering didn't throw is the proof.
	});

	it("mounts <PageNavigator> by default (MVP-8 integration)", () => {
		const ir = createCanvasIR({
			pages: [createPage({ id: "p1" })],
			now: () => "2026-01-01T00:00:00.000Z",
		});
		const { container } = render(
			<CanvasStudio initialIR={ir} initialActivePageId="p1" />,
		);
		expect(
			container.querySelector("[data-testid='page-navigator']"),
		).not.toBeNull();
		expect(container.querySelector("[data-testid='page-add']")).not.toBeNull();
	});

	it("routes a tool's requestAiIntent through the onAiIntent prop (I1-7 seam)", () => {
		const onAiIntent = vi.fn();
		// Probe tool standing in for an AI tool: emits on activation so the seam
		// can be exercised through a live <CanvasStudio> (the mocked Konva stage
		// does not dispatch real pointer events).
		const probe: Tool = {
			id: "ai-image",
			cursor: "crosshair",
			onActivate(ctx) {
				ctx.requestAiIntent?.({
					kind: "ai-image-marquee",
					context: {
						artboardId: ctx.activePageId,
						bounds: { x: 0, y: 0, width: 10, height: 10 },
					},
				});
			},
		};
		const ir = createCanvasIR({
			pages: [createPage({ id: "p1" })],
			now: () => "2026-01-01T00:00:00.000Z",
		});
		render(
			<CanvasStudio
				initialIR={ir}
				initialActivePageId="p1"
				initialTool="ai-image"
				toolRegistry={{ "ai-image": probe }}
				onAiIntent={onAiIntent}
			/>,
		);
		expect(onAiIntent).toHaveBeenCalled();
		expect(onAiIntent.mock.calls[0]?.[0]).toMatchObject({
			kind: "ai-image-marquee",
			context: {
				artboardId: "p1",
				bounds: { x: 0, y: 0, width: 10, height: 10 },
			},
		});
	});

	it("does not throw when an AI tool emits without an onAiIntent prop", () => {
		const probe: Tool = {
			id: "ai-image",
			cursor: "crosshair",
			onActivate(ctx) {
				ctx.requestAiIntent?.({
					kind: "ai-image-marquee",
					context: { artboardId: ctx.activePageId },
				});
			},
		};
		const ir = createCanvasIR({
			pages: [createPage({ id: "p1" })],
			now: () => "2026-01-01T00:00:00.000Z",
		});
		expect(() =>
			render(
				<CanvasStudio
					initialIR={ir}
					initialActivePageId="p1"
					initialTool="ai-image"
					toolRegistry={{ "ai-image": probe }}
				/>,
			),
		).not.toThrow();
	});

	it("hidePageNavigator hides the built-in nav", () => {
		const ir = createCanvasIR({
			pages: [createPage({ id: "p1" })],
			now: () => "2026-01-01T00:00:00.000Z",
		});
		const { container } = render(
			<CanvasStudio
				initialIR={ir}
				initialActivePageId="p1"
				hidePageNavigator
			/>,
		);
		expect(
			container.querySelector("[data-testid='page-navigator']"),
		).toBeNull();
	});
});
