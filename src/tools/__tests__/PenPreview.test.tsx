import { render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

type ElementCall = { type: string; props: Record<string, unknown> };
const calls: ElementCall[] = [];

function makeMock(type: string) {
	return (props: Record<string, unknown>) => {
		calls.push({ type, props });
		return <div data-testid={type} />;
	};
}

vi.mock("react-konva", () => ({
	Path: makeMock("Path"),
	Circle: makeMock("Circle"),
}));

import {
	CanvasStudioContext,
	type CanvasStudioContextValue,
} from "../../context/canvas-studio-context.js";
import { PenPreview } from "../PenPreview.js";
import { makeHarness } from "./_tool-test-helpers.js";

function mount(ctx: CanvasStudioContextValue) {
	return render(
		<CanvasStudioContext.Provider value={ctx}>
			<PenPreview />
		</CanvasStudioContext.Provider>,
	);
}

describe("PenPreview", () => {
	beforeEachReset();

	it("renders nothing when the pen tool is inactive", () => {
		const h = makeHarness();
		h.studioCtx.penStore?.getState().addAnchor({ x: 0, y: 0, hx: 0, hy: 0 });
		mount(h.studioCtx);
		expect(calls).toHaveLength(0);
	});

	it("renders the open-path preview and a dot per anchor", () => {
		const h = makeHarness();
		h.studioCtx.toolStore.getState().setActiveTool("path");
		h.studioCtx.penStore?.getState().addAnchor({ x: 0, y: 0, hx: 0, hy: 0 });
		h.studioCtx.penStore
			?.getState()
			.addAnchor({ x: 100, y: 0, hx: 100, hy: 0 });
		mount(h.studioCtx);
		const path = calls.find((c) => c.type === "Path");
		expect(path?.props.data).toBe("M 0 0 L 100 0");
		expect(calls.filter((c) => c.type === "Circle")).toHaveLength(2);
	});
});

function beforeEachReset() {
	const { beforeEach } = import.meta.vitest!;
	beforeEach(() => {
		calls.length = 0;
	});
}
