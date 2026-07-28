import { describe, expect, it, vi } from "vitest";

import type {
	CanvasLayoutEditorEvent,
	LayoutDiagnosticLike,
} from "../events.js";
import { createLayoutDiagnosticEmitter } from "../events.js";

/**
 * T-M4-11 (TS-56) — `canvas.layout.diagnostic` on commit only: preview
 * resolutions and same-hash re-resolves emit nothing; a commit emits its
 * diagnostics once, deduped by (code, nodeId, axis).
 */

function makeSources() {
	const listeners = new Set<() => void>();
	const state = {
		hash: "h0",
		previews: false,
		diagnostics: [] as LayoutDiagnosticLike[],
	};
	return {
		state,
		fire: () => {
			for (const l of listeners) l();
		},
		sources: {
			subscribe: (l: () => void) => {
				listeners.add(l);
				return () => listeners.delete(l);
			},
			getDiagnostics: () => state.diagnostics,
			getInputHash: () => state.hash,
			hasPreviews: () => state.previews,
		},
	};
}

const DIAG: LayoutDiagnosticLike = {
	code: "layout-insufficient-space",
	severity: "warning",
	nodeId: "f1",
	axis: "horizontal",
};

describe("createLayoutDiagnosticEmitter", () => {
	it("emits nothing for preview resolutions (a drag produces zero events until commit)", () => {
		const { state, fire, sources } = makeSources();
		const emit = vi.fn();
		createLayoutDiagnosticEmitter(sources, emit);
		state.previews = true;
		state.hash = "h1";
		state.diagnostics = [DIAG];
		fire();
		fire();
		fire();
		expect(emit).not.toHaveBeenCalled();
	});

	it("emits deduped diagnostics exactly once per commit hash", () => {
		const { state, fire, sources } = makeSources();
		const events: CanvasLayoutEditorEvent[] = [];
		createLayoutDiagnosticEmitter(sources, (e) => events.push(e));
		state.hash = "h1";
		state.diagnostics = [
			DIAG,
			{ ...DIAG }, // duplicate (code, nodeId, axis) — deduped
			{ ...DIAG, nodeId: "f2" },
		];
		fire();
		expect(events).toEqual([
			{
				type: "canvas.layout.diagnostic",
				code: "layout-insufficient-space",
				severity: "warning",
				operation: "commit",
				nodeId: "f1",
				axis: "horizontal",
			},
			{
				type: "canvas.layout.diagnostic",
				code: "layout-insufficient-space",
				severity: "warning",
				operation: "commit",
				nodeId: "f2",
				axis: "horizontal",
			},
		]);
		// The preview-clear re-resolve of the same committed document is silent.
		fire();
		expect(events).toHaveLength(2);
	});

	it("captures the baseline hash at wiring time — an opened document fires no burst", () => {
		const { state, fire, sources } = makeSources();
		const emit = vi.fn();
		state.diagnostics = [DIAG];
		createLayoutDiagnosticEmitter(sources, emit);
		fire();
		expect(emit).not.toHaveBeenCalled();
	});
});
