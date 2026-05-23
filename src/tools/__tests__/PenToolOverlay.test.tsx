import type { CanvasNodeCreateCommand } from "@anvilkit/canvas-core";
import { fireEvent, render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import {
	CanvasStudioContext,
	type CanvasStudioContextValue,
} from "../../context/canvas-studio-context.js";
import { makeHarness } from "./_tool-test-helpers.js";
import { PenToolOverlay } from "../PenToolOverlay.js";

function mount(ctx: CanvasStudioContextValue) {
	return render(
		<CanvasStudioContext.Provider value={ctx}>
			<PenToolOverlay />
		</CanvasStudioContext.Provider>,
	);
}

function withTwoAnchors() {
	const h = makeHarness();
	h.studioCtx.toolStore.getState().setActiveTool("path");
	h.studioCtx.penStore?.getState().addAnchor({ x: 0, y: 0, hx: 0, hy: 0 });
	h.studioCtx.penStore?.getState().addAnchor({ x: 50, y: 0, hx: 50, hy: 0 });
	return h;
}

describe("PenToolOverlay", () => {
	it("Enter finalizes an open path via node.create", () => {
		const h = withTwoAnchors();
		mount(h.studioCtx);
		fireEvent.keyDown(window, { key: "Enter" });
		expect(h.commits).toHaveLength(1);
		const cmd = h.commits[0] as CanvasNodeCreateCommand;
		expect(cmd.type).toBe("node.create");
		expect(cmd.node.type).toBe("path");
		expect(h.studioCtx.penStore?.getState().anchors).toHaveLength(0);
	});

	it("Escape cancels without committing", () => {
		const h = withTwoAnchors();
		mount(h.studioCtx);
		fireEvent.keyDown(window, { key: "Escape" });
		expect(h.commits).toHaveLength(0);
		expect(h.studioCtx.penStore?.getState().anchors).toHaveLength(0);
	});

	it("does not handle keys when the pen tool is not active", () => {
		const h = makeHarness();
		h.studioCtx.toolStore.getState().setActiveTool("select");
		h.studioCtx.penStore?.getState().addAnchor({ x: 0, y: 0, hx: 0, hy: 0 });
		h.studioCtx.penStore?.getState().addAnchor({ x: 5, y: 5, hx: 5, hy: 5 });
		mount(h.studioCtx);
		fireEvent.keyDown(window, { key: "Enter" });
		expect(h.commits).toHaveLength(0);
		expect(h.studioCtx.penStore?.getState().anchors).toHaveLength(2);
	});
});
