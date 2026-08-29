import type { CanvasTelemetryPayloads } from "@anvilkit/canvas-core";
import { useSyncExternalStore } from "react";

export type CanvasInteractionPerformanceSample =
	CanvasTelemetryPayloads["performance"];
export type CanvasInteractionKind =
	CanvasInteractionPerformanceSample["interaction"];
export type CanvasInteractionPhase =
	CanvasInteractionPerformanceSample["phase"];

/** Host observer for content-free interaction timing samples. */
export type CanvasInteractionPerformanceHandler = (
	sample: CanvasInteractionPerformanceSample,
) => void;

export interface CanvasInteractionFrame {
	readonly id: number;
	readonly interaction: CanvasInteractionKind;
	readonly nodeCountBucket: CanvasInteractionPerformanceSample["nodeCountBucket"];
	readonly inputStartedAt: number;
}

export interface CanvasInteractionPerformanceTracker {
	begin: (
		interaction: CanvasInteractionKind,
		nodeCount: number,
	) => CanvasInteractionFrame;
	end: (interaction?: CanvasInteractionKind) => void;
	current: () => CanvasInteractionFrame | undefined;
	isInteractionActive: () => boolean;
	subscribeInteractionActive: (listener: () => void) => () => void;
	now: () => number;
	recordDuration: (
		frame: CanvasInteractionFrame | undefined,
		phase: CanvasInteractionPhase,
		durationMs: number,
	) => void;
	completeStageUpdate: (
		frame: CanvasInteractionFrame | undefined,
		stageStartedAt: number,
	) => void;
}

export interface CreateInteractionPerformanceTrackerOptions {
	onSample: CanvasInteractionPerformanceHandler;
	/** Injectable monotonic clock for deterministic tests. */
	now?: () => number;
}

const NOOP_UNSUBSCRIBE = () => undefined;
const NOOP_SUBSCRIBE = () => NOOP_UNSUBSCRIBE;
const RETURN_FALSE = () => false;

/** React subscription shared by stage rendering and deferred derived work. */
export function useCanvasInteractionActive(
	tracker?: CanvasInteractionPerformanceTracker,
): boolean {
	const subscribe = tracker?.subscribeInteractionActive ?? NOOP_SUBSCRIBE;
	const getSnapshot = tracker?.isInteractionActive ?? RETURN_FALSE;
	return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

interface MutableInteractionFrame extends CanvasInteractionFrame {
	stageReported: boolean;
}

function nodeCountBucket(
	nodeCount: number,
): CanvasInteractionPerformanceSample["nodeCountBucket"] {
	if (nodeCount < 100) return "0-99";
	if (nodeCount < 1_000) return "100-999";
	if (nodeCount < 5_000) return "1000-4999";
	return "5000-plus";
}

function defaultNow(): number {
	return globalThis.performance?.now() ?? Date.now();
}

/**
 * Per-editor interaction timing coordinator. It carries only timing, a coarse
 * node-count bucket, and enum values from the privacy-reviewed Core telemetry
 * contract. Host observer failures are isolated from editing.
 */
export function createInteractionPerformanceTracker(
	options: CreateInteractionPerformanceTrackerOptions,
): CanvasInteractionPerformanceTracker {
	const now = options.now ?? defaultNow;
	let sequence = 0;
	let active: MutableInteractionFrame | undefined;
	let interactionActive = false;
	const interactionListeners = new Set<() => void>();
	const notifyInteractionListeners = (): void => {
		for (const listener of interactionListeners) listener();
	};

	const emit = (
		frame: CanvasInteractionFrame | undefined,
		phase: CanvasInteractionPhase,
		durationMs: number,
	): void => {
		if (!frame || frame.id !== active?.id || !Number.isFinite(durationMs))
			return;
		try {
			options.onSample({
				interaction: frame.interaction,
				phase,
				durationMs: Math.max(0, durationMs),
				nodeCountBucket: frame.nodeCountBucket,
			});
		} catch {
			// Instrumentation is diagnostic and must never make editing fail.
		}
	};

	return {
		begin(interaction, nodeCount) {
			active = {
				id: (sequence += 1),
				interaction,
				nodeCountBucket: nodeCountBucket(Math.max(0, nodeCount)),
				inputStartedAt: now(),
				stageReported: false,
			};
			if (!interactionActive) {
				interactionActive = true;
				notifyInteractionListeners();
			}
			return active;
		},
		end(interaction) {
			if (
				!interactionActive ||
				(interaction !== undefined && active?.interaction !== interaction)
			) {
				return;
			}
			interactionActive = false;
			notifyInteractionListeners();
		},
		current: () => active,
		isInteractionActive: () => interactionActive,
		subscribeInteractionActive(listener) {
			interactionListeners.add(listener);
			return () => interactionListeners.delete(listener);
		},
		now,
		recordDuration: emit,
		completeStageUpdate(frame, stageStartedAt) {
			if (!frame || frame.id !== active?.id || active.stageReported) return;
			active.stageReported = true;
			const completedAt = now();
			emit(frame, "stage-update", completedAt - stageStartedAt);
			emit(frame, "input-to-preview", completedAt - frame.inputStartedAt);
		},
	};
}

/** Classify the shared field contract without putting content in telemetry. */
export function fieldInteractionKind(fieldId: string): CanvasInteractionKind {
	return /(?:background|color|fill|stroke)/i.test(fieldId)
		? "color-adjustment"
		: "property-scrub";
}
