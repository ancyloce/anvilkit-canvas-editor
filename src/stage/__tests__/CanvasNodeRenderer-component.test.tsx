import type {
	CanvasComponentDefinition,
	CanvasComponentInstanceNode,
	CanvasIR,
	CanvasNode,
} from "@anvilkit/canvas-core";
import {
	createCanvasIR,
	createFrame,
	createPage,
	createRect,
	insertNode,
	resolveCanvasDocument,
} from "@anvilkit/canvas-core";
import { cleanup, render } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * @file Plan 0023 M4-02 — the renderer's `component-instance` branch paints the
 * RESOLVED subtree, not the persistent node (which has no children at all).
 *
 * Drives the branch through the STATIC `CanvasResolvedDocumentContext` rather
 * than the live studio store, so it verifies the renderer alone: whether the
 * store composes component resolution is M4-03's contract, tested separately.
 * Observable through the react-konva mock — the emitted Konva props are exactly
 * what the renderer decided to draw.
 */

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

import { CanvasNodeRenderer } from "../CanvasNodeRenderer.js";
import { CanvasResolvedDocumentContext } from "../CanvasResolvedDocumentContext.js";

/** A Source whose root frame holds two rects — one of them a distinctive fill. */
function definition(): CanvasComponentDefinition {
	return {
		id: "cmp-card",
		name: "Card",
		revision: 3,
		properties: [],
		root: {
			...createFrame({
				id: "src-root",
				bounds: { width: 200, height: 80 },
				background: "#eeeeee",
			}),
			children: [
				createRect({
					id: "src-badge",
					transform: { x: 8, y: 8 },
					bounds: { width: 24, height: 24 },
					fill: "#ff0000",
				}),
				createRect({
					id: "src-body",
					transform: { x: 40, y: 8 },
					bounds: { width: 120, height: 40 },
					fill: "#0000ff",
				}),
			],
		} as CanvasNode,
	};
}

function instance(
	overrides: Partial<CanvasComponentInstanceNode> = {},
): CanvasComponentInstanceNode {
	return {
		type: "component-instance",
		id: "inst-1",
		componentId: "cmp-card",
		transform: { x: 30, y: 12, rotation: 0, scaleX: 1, scaleY: 1 },
		bounds: { width: 200, height: 80 },
		...overrides,
	} as CanvasComponentInstanceNode;
}

/** Document with one instance on the page and `components` populated. */
function componentDoc(
	node: CanvasComponentInstanceNode = instance(),
	registry: Record<string, CanvasComponentDefinition> = {
		"cmp-card": definition(),
	},
): { ir: CanvasIR; node: CanvasComponentInstanceNode } {
	const page = createPage({ id: "p1" });
	let ir = createCanvasIR({ id: "doc", title: "t", pages: [page] });
	ir = insertNode(ir, { parentId: page.root.id, node });
	return { ir: { ...ir, components: registry }, node };
}

function mountResolved(ir: CanvasIR, node: CanvasNode) {
	const resolved = resolveCanvasDocument(ir, {});
	render(
		<CanvasResolvedDocumentContext.Provider value={resolved}>
			<CanvasNodeRenderer node={node} />
		</CanvasResolvedDocumentContext.Provider>,
	);
	return resolved;
}

function propsOf(
	type: string,
	id: string,
): Record<string, unknown> | undefined {
	return calls.filter((c) => c.type === type && c.props.id === id).at(-1)
		?.props;
}

function fills(): unknown[] {
	return calls.filter((c) => c.type === "Rect").map((c) => c.props.fill);
}

afterEach(() => {
	cleanup();
	calls.length = 0;
});

describe("CanvasNodeRenderer component-instance branch", () => {
	it("paints the expanded Source subtree, not the bare instance node", () => {
		const { ir, node } = componentDoc();
		mountResolved(ir, node);

		// Both Source rects reached the stage even though the persistent instance
		// node has no `children` for the renderer to walk.
		expect(fills()).toContain("#ff0000");
		expect(fills()).toContain("#0000ff");
	});

	it("draws the expansion root under the instance's own persistent id and placement", () => {
		const { ir, node } = componentDoc();
		mountResolved(ir, node);

		// The composed root keeps the instance id (selection stability) and takes
		// the instance's placement, never the definition root's stored origin.
		const root = propsOf("Group", "inst-1");
		expect(root).toBeDefined();
		expect(root?.x).toBe(30);
		expect(root?.y).toBe(12);
	});

	it("gives every virtual descendant a codec-encoded id, never a Source node id", () => {
		const { ir, node } = componentDoc();
		mountResolved(ir, node);

		const ids = calls
			.map((c) => c.props.id)
			.filter((id): id is string => typeof id === "string");
		// Definition-tree ids must not leak onto the stage as node identities:
		// they are not addressable by any persistent-node command.
		expect(ids).not.toContain("src-badge");
		expect(ids).not.toContain("src-body");
		expect(ids.some((id) => id.startsWith("akv1:"))).toBe(true);
	});

	it("renders a selectable placeholder when the Source is missing", () => {
		// Empty registry → core degrades to the instance node itself (INV-3).
		const { ir, node } = componentDoc(instance(), {});
		const resolved = mountResolved(ir, node);
		expect(
			resolved.componentIssues.some(
				(i) => i.code === "component-source-missing",
			),
		).toBe(true);

		// The placeholder Group carries the instance id, so a click still selects
		// it, and its transparent hit Rect spans the stored bounds.
		const root = propsOf("Group", "inst-1");
		expect(root).toBeDefined();
		const hit = calls.find(
			(c) => c.type === "Rect" && c.props.fill === "transparent",
		);
		expect(hit?.props.width).toBe(200);
		expect(hit?.props.height).toBe(80);
		// The dashed missing-component chrome renders too (label + outline).
		expect(
			calls.some(
				(c) => c.type === "Text" && c.props.text === "Missing component",
			),
		).toBe(true);
	});

	it("falls back to the placeholder rather than throwing without a resolution", () => {
		const { node } = componentDoc();
		// No resolved document at all (partial mount / headless pass): an instance
		// cannot be expanded, and must not crash the render.
		render(<CanvasNodeRenderer node={node} />);
		expect(propsOf("Group", "inst-1")).toBeDefined();
		expect(fills()).not.toContain("#ff0000");
	});
});
