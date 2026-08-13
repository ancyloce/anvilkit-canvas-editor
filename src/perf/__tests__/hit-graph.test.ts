// @vitest-environment jsdom
import { renderHook } from "@testing-library/react";
import type Konva from "konva";
import { describe, expect, it, vi } from "vitest";
import { useContentHitGraphSuspension } from "../hit-graph.js";

function fakeLayer(name: string) {
	let listening = true;
	return {
		name: () => name,
		listening: vi.fn((next?: boolean) => {
			if (next === undefined) return listening;
			listening = next;
			return undefined as unknown as boolean;
		}),
		batchDraw: vi.fn(),
		_listening: () => listening,
	};
}

function fakeStage(layers: ReturnType<typeof fakeLayer>[]) {
	return {
		getLayers: () => layers as unknown as ReadonlyArray<Konva.Layer>,
	} as unknown as Konva.Stage;
}

describe("useContentHitGraphSuspension (K-15)", () => {
	it("suspends only the content layer's hit graph, leaving overlay listening", () => {
		const content = fakeLayer("content");
		const overlay = fakeLayer("overlay");
		const { result } = renderHook(() =>
			useContentHitGraphSuspension(fakeStage([content, overlay])),
		);

		result.current.suspend();

		expect(content._listening()).toBe(false);
		// The gesture is driven from a Transformer anchor, which lives here —
		// suspending it would break the drag being optimised.
		expect(overlay._listening()).toBe(true);
	});

	it("restores listening and repaints the hit canvas on resume", () => {
		const content = fakeLayer("content");
		const { result } = renderHook(() =>
			useContentHitGraphSuspension(fakeStage([content])),
		);

		result.current.suspend();
		result.current.resume();

		expect(content._listening()).toBe(true);
		// `Layer.drawHit` clears before deciding whether to populate, so a
		// suspended layer's hit canvas is EMPTY — it has to be repainted before
		// it can answer hit queries again.
		expect(content.batchDraw).toHaveBeenCalled();
	});

	it("is idempotent across repeated suspend calls", () => {
		const content = fakeLayer("content");
		const { result } = renderHook(() =>
			useContentHitGraphSuspension(fakeStage([content])),
		);

		result.current.suspend();
		result.current.suspend();
		result.current.resume();

		expect(content._listening()).toBe(true);
	});

	it("resumes on unmount so an interrupted gesture cannot strand the layer", () => {
		const content = fakeLayer("content");
		const { result, unmount } = renderHook(() =>
			useContentHitGraphSuspension(fakeStage([content])),
		);

		result.current.suspend();
		expect(content._listening()).toBe(false);

		unmount();

		expect(content._listening()).toBe(true);
	});

	// If something else already turned the layer off, we did not turn it off —
	// so resuming must not turn it on.
	it("never enables a layer it did not suspend", () => {
		const content = fakeLayer("content");
		content.listening(false);
		const { result } = renderHook(() =>
			useContentHitGraphSuspension(fakeStage([content])),
		);

		result.current.suspend();
		result.current.resume();

		expect(content._listening()).toBe(false);
	});

	it("no-ops without a stage", () => {
		const { result } = renderHook(() => useContentHitGraphSuspension(null));
		expect(() => {
			result.current.suspend();
			result.current.resume();
		}).not.toThrow();
	});
});
