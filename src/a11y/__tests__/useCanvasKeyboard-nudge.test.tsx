import {
	type CanvasIR,
	createCanvasIR,
	createGroup,
	createPage,
	createRect,
} from "@anvilkit/canvas-core";
import { cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { CanvasStudioContext } from "@/context/canvas-studio-context.js";
import { makeHarness } from "@/tools/__tests__/_tool-test-helpers.js";
import { CanvasKeyboardLayer } from "../useCanvasKeyboard.js";

afterEach(cleanup);

const FIXED_TS = "2026-05-20T00:00:00.000Z";

function fixtureIR(): CanvasIR {
	const page = createPage({ id: "p1" });
	page.root = createGroup({
		id: "p1-root",
		bounds: page.root.bounds,
		children: [
			createRect({
				id: "a",
				transform: { x: 0 },
				bounds: { width: 50, height: 50 },
			}),
			createRect({
				id: "b",
				transform: { x: 100 },
				bounds: { width: 50, height: 50 },
			}),
		],
	});
	return createCanvasIR({ id: "ir", pages: [page], now: () => FIXED_TS });
}

function setup(selection: readonly string[]) {
	const h = makeHarness({ ir: fixtureIR() });
	h.studioCtx.selectionStore.getState().setSelection(selection);
	render(
		<CanvasStudioContext.Provider value={h.studioCtx}>
			<CanvasKeyboardLayer />
		</CanvasStudioContext.Provider>,
	);
	const container = h.studioCtx.stage?.container();
	if (!container) throw new Error("fake stage has no container");
	return { h, container };
}

describe("useCanvasKeyboard — nudge/resize/rotate coalescing (E-18)", () => {
	it("routes a single-node nudge through commitCoalesced, not commit/commitBatch", () => {
		const { h, container } = setup(["a"]);
		fireEvent.keyDown(container, { key: "ArrowRight" });
		expect(h.studioCtx.commitCoalesced).toHaveBeenCalledTimes(1);
		expect(h.studioCtx.commit).not.toHaveBeenCalled();
		expect(h.studioCtx.commitBatch).not.toHaveBeenCalled();
	});

	it("shares one merge key across repeated presses of the same held key", () => {
		const { h, container } = setup(["a"]);
		fireEvent.keyDown(container, { key: "ArrowRight" });
		fireEvent.keyDown(container, { key: "ArrowRight" });
		fireEvent.keyDown(container, { key: "ArrowRight" });
		const calls = (
			h.studioCtx.commitCoalesced as unknown as {
				mock: { calls: unknown[][] };
			}
		).mock.calls;
		expect(calls).toHaveLength(3);
		const mergeKeys = calls.map((args) => args[1]);
		expect(new Set(mergeKeys).size).toBe(1);
	});

	it("uses a different merge key when the key or modifier changes", () => {
		const { h, container } = setup(["a"]);
		fireEvent.keyDown(container, { key: "ArrowRight" });
		fireEvent.keyDown(container, { key: "ArrowUp" });
		fireEvent.keyDown(container, { key: "ArrowRight", shiftKey: true });
		const calls = (
			h.studioCtx.commitCoalesced as unknown as {
				mock: { calls: unknown[][] };
			}
		).mock.calls;
		const mergeKeys = calls.map((args) => args[1]);
		expect(new Set(mergeKeys).size).toBe(3);
	});

	it("coalesces a multi-selection nudge as ONE batch-shaped command", () => {
		const { h, container } = setup(["a", "b"]);
		fireEvent.keyDown(container, { key: "ArrowRight" });
		expect(h.studioCtx.commitCoalesced).toHaveBeenCalledTimes(1);
		const [cmd] = (
			h.studioCtx.commitCoalesced as unknown as {
				mock: { calls: [{ type: string; commands: unknown[] }, string][] };
			}
		).mock.calls[0]!;
		expect(cmd.type).toBe("batch");
		expect(cmd.commands).toHaveLength(2);
	});

	it("falls back to commit/commitBatch when commitCoalesced is absent (partial test contexts)", () => {
		const h = makeHarness({ ir: fixtureIR() });
		h.studioCtx.selectionStore.getState().setSelection(["a"]);
		h.studioCtx.commitCoalesced = undefined;
		render(
			<CanvasStudioContext.Provider value={h.studioCtx}>
				<CanvasKeyboardLayer />
			</CanvasStudioContext.Provider>,
		);
		const container = h.studioCtx.stage?.container();
		if (!container) throw new Error("fake stage has no container");
		fireEvent.keyDown(container, { key: "ArrowRight" });
		expect(h.studioCtx.commit).toHaveBeenCalledTimes(1);
	});
});
