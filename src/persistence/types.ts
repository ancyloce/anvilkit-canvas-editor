import type { CanvasIR } from "@anvilkit/canvas-core";

/**
 * @file FR-160 persistence adapter contract (B-08, PRD 0012 §11.1). The
 * editor owns WHEN to save (manual, debounced auto-save, flush) and the save
 * status lifecycle; the host owns storage, auth, and transport.
 */

export interface CanvasSaveInput {
	ir: CanvasIR;
	documentId: string;
	/**
	 * History state id of the snapshot (FR-161). Round-tripped so the editor
	 * checkpoints exactly the state the host persisted, even when responses
	 * arrive out of order.
	 */
	revision: number;
	/**
	 * FR-162: aborts when this save is superseded by teardown (`dispose()`)
	 * before it settles. An adapter that ignores it still behaves correctly —
	 * the controller already discards a response that arrives after
	 * disposal — but honoring it lets the adapter cancel the underlying I/O
	 * instead of letting it run to completion for nothing.
	 */
	signal: AbortSignal;
}

export interface CanvasSaveResult {
	/** ISO timestamp; defaults to the controller's clock when omitted. */
	savedAt?: string;
}

export interface CanvasPersistenceAdapter {
	save(input: CanvasSaveInput): Promise<CanvasSaveResult>;
	load?(documentId: string): Promise<CanvasIR>;
}

export interface CanvasAutoSaveOptions {
	/** Quiet period after the last change before an auto-save fires. */
	debounceMs?: number;
	/** Ceiling: a save fires at most this long after the FIRST unsaved change. */
	maxWaitMs?: number;
	/** Failed-save retries before giving up until the next change. */
	maxRetries?: number;
	/** Base for exponential retry backoff (base, 2×base, 4×base…). */
	retryBaseMs?: number;
}

export const DEFAULT_AUTO_SAVE: Required<CanvasAutoSaveOptions> = {
	debounceMs: 1500,
	maxWaitMs: 10_000,
	maxRetries: 3,
	retryBaseMs: 1000,
};
