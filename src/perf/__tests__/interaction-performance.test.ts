import { describe, expect, it, vi } from "vitest";
import { createCanvasIR } from "@anvilkit/canvas-core";
import { createFieldPreviewStore } from "@/stores/field-preview-store.js";
import { createResolvedDocumentStore } from "@/stores/resolved-document-store.js";
import { createSceneStore } from "@/stores/scene-store.js";
import {
	createInteractionPerformanceTracker,
	fieldInteractionKind,
} from "../interaction-performance.js";

describe("interaction performance instrumentation", () => {
	it("reports content-free phase samples against one interaction frame", () => {
		let now = 10;
		const onSample = vi.fn();
		const tracker = createInteractionPerformanceTracker({
			onSample,
			now: () => now,
		});
		const frame = tracker.begin("resize", 1_250);
		now = 12;
		tracker.recordDuration(frame, "resolve", 1.25);
		tracker.recordDuration(frame, "layout", 0.5);
		const stageStartedAt = now;
		now = 16;
		tracker.completeStageUpdate(frame, stageStartedAt);

		expect(onSample.mock.calls.map(([sample]) => sample)).toEqual([
			{
				interaction: "resize",
				phase: "resolve",
				durationMs: 1.25,
				nodeCountBucket: "1000-4999",
			},
			{
				interaction: "resize",
				phase: "layout",
				durationMs: 0.5,
				nodeCountBucket: "1000-4999",
			},
			{
				interaction: "resize",
				phase: "stage-update",
				durationMs: 4,
				nodeCountBucket: "1000-4999",
			},
			{
				interaction: "resize",
				phase: "input-to-preview",
				durationMs: 6,
				nodeCountBucket: "1000-4999",
			},
		]);
	});

	it("drops stale frames and isolates a throwing host observer", () => {
		const tracker = createInteractionPerformanceTracker({
			onSample() {
				throw new Error("host observer failed");
			},
			now: () => 1,
		});
		const stale = tracker.begin("drag", 99);
		const current = tracker.begin("property-scrub", 5_000);
		expect(() => {
			tracker.recordDuration(stale, "resolve", 1);
			tracker.recordDuration(current, "commit", 1);
			tracker.completeStageUpdate(current, 0);
		}).not.toThrow();
	});

	it("publishes interaction start/end state without ending a different kind", () => {
		const tracker = createInteractionPerformanceTracker({ onSample: vi.fn() });
		const states: boolean[] = [];
		const unsubscribe = tracker.subscribeInteractionActive(() => {
			states.push(tracker.isInteractionActive());
		});

		tracker.begin("resize", 10);
		tracker.begin("resize", 10);
		tracker.end("drag");
		expect(tracker.isInteractionActive()).toBe(true);
		tracker.end("resize");

		expect(states).toEqual([true, false]);
		expect(tracker.isInteractionActive()).toBe(false);
		unsubscribe();
	});

	it("classifies color fields separately from other property scrubs", () => {
		expect(fieldInteractionKind("prop-fill")).toBe("color-adjustment");
		expect(fieldInteractionKind("prop-page-background")).toBe(
			"color-adjustment",
		);
		expect(fieldInteractionKind("prop-opacity")).toBe("property-scrub");
	});

	it("records resolver and layout phases through the connected preview path", () => {
		const samples: Array<{ phase: string }> = [];
		const tracker = createInteractionPerformanceTracker({
			onSample: (sample) => samples.push(sample),
		});
		const sceneStore = createSceneStore({ initialIR: createCanvasIR() });
		const fieldPreviewStore = createFieldPreviewStore();
		const resolvedDocumentStore = createResolvedDocumentStore({
			sceneStore,
			fieldPreviewStore,
			interactionPerformance: tracker,
			schedulePreviewResolution(callback) {
				callback();
				return () => {
					// This assertion measures one explicitly flushed preview frame.
				};
			},
		});
		const disconnect = resolvedDocumentStore.connect();
		try {
			tracker.begin(
				"property-scrub",
				resolvedDocumentStore.getState().resolved.records.size,
			);
			fieldPreviewStore.getState().setPreviews({});
			expect(samples.map((sample) => sample.phase)).toEqual([
				"resolve",
				"layout",
			]);
		} finally {
			disconnect();
		}
	});
});
