import type { CanvasNode } from "@anvilkit/canvas-core";
import { createCanvasIR, createPage, insertNode } from "@anvilkit/canvas-core";
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
	CanvasStudioContext,
	type CanvasStudioContextValue,
} from "@/context/canvas-studio-context.js";
import { createFieldPreviewStore } from "@/stores/field-preview-store.js";
import { createResolvedDocumentStore } from "@/stores/resolved-document-store.js";
import { createSceneStore } from "@/stores/scene-store.js";
import { CanvasNodeRenderer } from "../CanvasNodeRenderer.js";

afterEach(cleanup);

/**
 * Fake CUSTOM (non-built-in) node kind. Named "pinwheel", not "star" — "star"
 * is now a real built-in kind (canvas-m1-011) with its own dispatch case, so
 * the switch would render it before ever reaching the custom-kindRenderers
 * fallback these tests exist to exercise.
 */
const pinwheel = {
	id: "s1",
	type: "pinwheel",
	transform: { x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1 },
	bounds: { width: 20, height: 20 },
	zIndex: 0,
	points: 5,
} as unknown as CanvasNode;

function ctxWith(
	kindRenderers: CanvasStudioContextValue["kindRenderers"],
): CanvasStudioContextValue {
	return { kindRenderers } as unknown as CanvasStudioContextValue;
}

describe("CanvasNodeRenderer — custom kinds", () => {
	it("renders a custom node kind via the registered renderer", () => {
		const renderPinwheel = vi.fn(() => null);
		const ctx = ctxWith({
			pinwheel: { kind: "pinwheel", render: renderPinwheel },
		});
		render(
			<CanvasStudioContext.Provider value={ctx}>
				<CanvasNodeRenderer node={pinwheel} />
			</CanvasStudioContext.Provider>,
		);
		expect(renderPinwheel).toHaveBeenCalledTimes(1);
		expect(renderPinwheel.mock.calls[0]?.[0]).toMatchObject({ node: pinwheel });
	});

	it("renders nothing (no throw) for a custom kind with no registered renderer", () => {
		const ctx = ctxWith({});
		expect(() =>
			render(
				<CanvasStudioContext.Provider value={ctx}>
					<CanvasNodeRenderer node={pinwheel} />
				</CanvasStudioContext.Provider>,
			),
		).not.toThrow();
	});

	// T-M3-08: the widened (optional, source-compatible) `resolved` prop.
	it("passes resolved geometry to the renderer when the store is present", () => {
		const renderPinwheel = vi.fn(() => null);
		const page = createPage({ id: "p1" });
		let ir = createCanvasIR({ id: "ir-1", pages: [page], now: () => "T" });
		ir = insertNode(ir, { parentId: page.root.id, node: pinwheel });
		const sceneStore = createSceneStore({ initialIR: ir });
		const fieldPreviewStore = createFieldPreviewStore();
		const resolvedDocumentStore = createResolvedDocumentStore({
			sceneStore,
			fieldPreviewStore,
		});
		const disconnect = resolvedDocumentStore.connect();
		try {
			const ctx = {
				kindRenderers: {
					pinwheel: { kind: "pinwheel", render: renderPinwheel },
				},
				resolvedDocumentStore,
			} as unknown as CanvasStudioContextValue;
			render(
				<CanvasStudioContext.Provider value={ctx}>
					<CanvasNodeRenderer node={pinwheel} />
				</CanvasStudioContext.Provider>,
			);
			expect(renderPinwheel).toHaveBeenCalledTimes(1);
			const props = renderPinwheel.mock.calls[0]?.[0] as {
				node: CanvasNode;
				resolved?: { worldAabb: { minX: number } };
			};
			expect(props.resolved).toBeDefined();
			expect(props.resolved?.worldAabb).toEqual(
				resolvedDocumentStore.getState().view.getRecord("s1")?.geometry
					.worldAabb,
			);
		} finally {
			disconnect();
		}
	});
});
