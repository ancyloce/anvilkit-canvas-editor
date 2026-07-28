import type { CanvasLayoutDirection } from "@anvilkit/canvas-core";

/**
 * @file T-M4-11 — the six PRD §12 layout events, carried by ONE optional host
 * callback (`onLayoutEvent`, name provisional under OQ-5/A-3). The editor has
 * no analytics client and must not gain one: hosts observe, the editor emits.
 * Payloads carry ids/enums/counts only — never copy content, asset URIs,
 * font data, or document bodies.
 */

export type CanvasLayoutEditorEvent =
	| {
			type: "canvas.layout.created";
			direction: CanvasLayoutDirection;
			source: "frame" | "selection";
			childCount: number;
	  }
	| {
			type: "canvas.layout.updated";
			property: string;
			previousMode?: string;
			nextMode?: string;
	  }
	| {
			type: "canvas.layout.child_reordered";
			childCount: number;
			fromIndex: number;
			toIndex: number;
	  }
	| {
			type: "canvas.layout.removed";
			childCount: number;
			nestedDepth: number;
	  }
	| {
			type: "canvas.layout.diagnostic";
			code: string;
			severity: string;
			operation: string;
			nodeId?: string;
			axis?: string;
	  }
	| {
			type: "canvas.layout.exported";
			format: string;
			warningCount: number;
			nodeCount: number;
	  };

export type CanvasLayoutEventHandler = (event: CanvasLayoutEditorEvent) => void;

/** Structural view of a resolver diagnostic — keeps this module a pure leaf. */
export interface LayoutDiagnosticLike {
	readonly code: string;
	readonly severity: string;
	readonly nodeId?: string;
	readonly axis?: string;
}

/** Structural view of the resolved-document store — no store imports at rank 0. */
export interface LayoutDiagnosticEmitterSources {
	subscribe: (listener: () => void) => () => void;
	getDiagnostics: () => readonly LayoutDiagnosticLike[];
	getInputHash: () => string;
	/** True while a transient field/gesture preview overlays the document. */
	hasPreviews: () => boolean;
}

/**
 * `canvas.layout.diagnostic` emission discipline (PRD §12): ON COMMIT ONLY —
 * a resolution that carries preview overlays is skipped outright, and a
 * resolution whose input hash matches the last emitted one (e.g. the
 * preview-clear re-resolve of the same committed document) emits nothing.
 * Within one commit, diagnostics dedupe by `(code, nodeId, axis)`. The
 * baseline hash is captured at wiring time so a document opened with issues
 * does not fire a synthetic burst. Returns the unsubscribe function.
 */
export function createLayoutDiagnosticEmitter(
	sources: LayoutDiagnosticEmitterSources,
	emit: CanvasLayoutEventHandler,
): () => void {
	let lastHash = sources.getInputHash();
	return sources.subscribe(() => {
		if (sources.hasPreviews()) return;
		const hash = sources.getInputHash();
		if (hash === lastHash) return;
		lastHash = hash;
		const seen = new Set<string>();
		for (const d of sources.getDiagnostics()) {
			const key = `${d.code}|${d.nodeId ?? ""}|${d.axis ?? ""}`;
			if (seen.has(key)) continue;
			seen.add(key);
			emit({
				type: "canvas.layout.diagnostic",
				code: d.code,
				severity: d.severity,
				operation: "commit",
				...(d.nodeId !== undefined ? { nodeId: d.nodeId } : {}),
				...(d.axis !== undefined ? { axis: d.axis } : {}),
			});
		}
	});
}
