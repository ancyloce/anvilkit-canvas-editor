import type { CanvasNode } from "@anvilkit/canvas-core";
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
	CanvasStudioContext,
	type CanvasStudioContextValue,
} from "@/context/canvas-studio-context.js";
import { CanvasNodeRenderer } from "../CanvasNodeRenderer.js";

afterEach(cleanup);

const star = {
	id: "s1",
	type: "star",
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
		const renderStar = vi.fn(() => null);
		const ctx = ctxWith({ star: { kind: "star", render: renderStar } });
		render(
			<CanvasStudioContext.Provider value={ctx}>
				<CanvasNodeRenderer node={star} />
			</CanvasStudioContext.Provider>,
		);
		expect(renderStar).toHaveBeenCalledTimes(1);
		expect(renderStar.mock.calls[0]?.[0]).toMatchObject({ node: star });
	});

	it("renders nothing (no throw) for a custom kind with no registered renderer", () => {
		const ctx = ctxWith({});
		expect(() =>
			render(
				<CanvasStudioContext.Provider value={ctx}>
					<CanvasNodeRenderer node={star} />
				</CanvasStudioContext.Provider>,
			),
		).not.toThrow();
	});
});
