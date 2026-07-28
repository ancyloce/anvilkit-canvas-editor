import type { CanvasIR, CanvasNode } from "@anvilkit/canvas-core";
import {
	createCanvasIR,
	createFrame,
	createPage,
	createRect,
	insertNode,
} from "@anvilkit/canvas-core";
import { cleanup, render } from "@testing-library/react";
import type { ReactNode } from "react";
import { act } from "react";
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
	RegularPolygon: makeMock("RegularPolygon"),
	Star: makeMock("Star"),
	Line: makeMock("Line"),
	Path: makeMock("Path"),
	Text: makeMock("Text"),
	Image: makeMock("Image"),
}));

import {
	CanvasStudioContext,
	type CanvasStudioContextValue,
} from "@/context/canvas-studio-context.js";
import { createFieldPreviewStore } from "@/stores/field-preview-store.js";
import { createResolvedDocumentStore } from "@/stores/resolved-document-store.js";
import { createSceneStore } from "@/stores/scene-store.js";
import { CanvasNodeRenderer } from "../CanvasNodeRenderer.js";

/**
 * @file T-M3-06 (TS-42) — the renderer's geometry reads consume resolved
 * records. Observable through the react-konva mock: the emitted Konva props
 * carry whichever geometry the renderer actually used.
 */

/** Horizontal auto-layout frame, gap 10; children stored STALE at x=0. */
function layoutDoc(): CanvasIR {
	const frame: CanvasNode = {
		...createFrame({ id: "f1", bounds: { width: 200, height: 100 } }),
		autoLayout: {
			version: 1,
			direction: "horizontal",
			padding: { top: 0, right: 0, bottom: 0, left: 0 },
			gap: 10,
			primaryAlign: "start",
			crossAlign: "start",
		},
		children: [
			createRect({ id: "r1", bounds: { width: 40, height: 20 } }),
			createRect({ id: "r2", bounds: { width: 40, height: 20 } }),
		],
	} as CanvasNode;
	const page = createPage({ id: "p1" });
	let ir = createCanvasIR({ id: "doc", title: "t", pages: [page] });
	ir = insertNode(ir, { parentId: page.root.id, node: frame });
	return ir;
}

function mountWithStores(ir: CanvasIR, node: CanvasNode) {
	const sceneStore = createSceneStore({ initialIR: ir });
	const fieldPreviewStore = createFieldPreviewStore();
	const resolvedDocumentStore = createResolvedDocumentStore({
		sceneStore,
		fieldPreviewStore,
	});
	const disconnect = resolvedDocumentStore.connect();
	const view = render(
		<CanvasStudioContext.Provider
			value={
				{
					sceneStore,
					fieldPreviewStore,
					resolvedDocumentStore,
				} as unknown as CanvasStudioContextValue
			}
		>
			<CanvasNodeRenderer node={node} />
		</CanvasStudioContext.Provider>,
	);
	return { fieldPreviewStore, disconnect, view };
}

function rectProps(id: string): Record<string, unknown> | undefined {
	return calls.filter((c) => c.type === "Rect" && c.props.id === id).at(-1)
		?.props;
}

afterEach(() => {
	cleanup();
	calls.length = 0;
});

describe("CanvasNodeRenderer resolved geometry", () => {
	it("renders flow positions from the resolved tree, not stale stored geometry", () => {
		const ir = layoutDoc();
		const frame = ir.pages[0]?.root.children[0];
		if (!frame) throw new Error("fixture frame missing");
		const { disconnect } = mountWithStores(ir, frame);
		try {
			// Stored geometry has BOTH children at x=0; resolved flow puts r2 at 50.
			expect(rectProps("r1")?.x).toBe(0);
			expect(rectProps("r2")?.x).toBe(50);
		} finally {
			disconnect();
		}
	});

	it("re-renders flow when a preview patch changes a sibling's geometry", () => {
		const ir = layoutDoc();
		const frame = ir.pages[0]?.root.children[0];
		if (!frame) throw new Error("fixture frame missing");
		const { fieldPreviewStore, disconnect } = mountWithStores(ir, frame);
		try {
			expect(rectProps("r2")?.x).toBe(50);
			act(() => {
				fieldPreviewStore
					.getState()
					.setPreviews({ r1: { bounds: { width: 100, height: 20 } } });
			});
			// The widened preview of r1 pushes r2 to 100 + gap 10 — without any
			// commit and without the frame prop changing.
			expect(rectProps("r2")?.x).toBe(110);
		} finally {
			disconnect();
		}
	});

	it("renders a document without layout intent identically with and without the store", () => {
		const rect = createRect({
			id: "r1",
			transform: { x: 25, y: 5, rotation: 30 },
			bounds: { width: 40, height: 20 },
			fill: "#abc",
		});
		const page = createPage({ id: "p1" });
		let ir = createCanvasIR({ id: "doc", title: "t", pages: [page] });
		ir = insertNode(ir, { parentId: page.root.id, node: rect });

		// Bare mount — no studio context at all (headless rasterization path).
		render(<CanvasNodeRenderer node={rect} />);
		const bare = { ...rectProps("r1") };
		calls.length = 0;
		cleanup();

		const { disconnect } = mountWithStores(ir, rect);
		try {
			expect(rectProps("r1")).toEqual(bare);
		} finally {
			disconnect();
		}
	});
});
