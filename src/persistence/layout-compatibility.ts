import {
	CANVAS_LAYOUT_AUTO_CAPABILITY,
	type CanvasIR,
	validateLayoutInvariants,
} from "@anvilkit/canvas-core";
import { irCarriesLayoutIntent } from "../auto-layout/intent.js";

/**
 * @file T-M5-03 — capability completeness and read-only gating at the
 * persistence boundary.
 *
 * No command writes `compatibility.requiredCapabilities` (commands own node
 * content; compatibility describes the DOCUMENT a writer hands over), so the
 * editor completes the declaration wherever a document leaves the session:
 * save, recovery mirror, and JSON-bearing exports. This is what keeps our own
 * writer from producing documents the `missing-required-capability` invariant
 * (AC-013) would reject — completion at the boundary, never rejection of the
 * user's own work, and never a discarded field ("never discard intent to
 * satisfy an old writer").
 */

/**
 * Returns the document with `layout.auto.v1` declared whenever any node
 * carries Auto Layout intent. Reference-identical when nothing needs adding;
 * existing capabilities and every other compatibility field are preserved.
 */
export function withRequiredLayoutCapability(ir: CanvasIR): CanvasIR {
	if (!irCarriesLayoutIntent(ir)) return ir;
	const existing = ir.compatibility?.requiredCapabilities ?? [];
	if (existing.includes(CANVAS_LAYOUT_AUTO_CAPABILITY)) return ir;
	return {
		...ir,
		compatibility: {
			schemaVersion: ir.version,
			minReaderSchemaVersion: ir.compatibility?.minReaderSchemaVersion ?? "3",
			requiredCapabilities: [...existing, CANVAS_LAYOUT_AUTO_CAPABILITY],
		},
	};
}

const readOnlyCache = new WeakMap<CanvasIR, boolean>();

/**
 * AC-010: a document declaring a capability this build does not implement
 * enters read-only materialized preview — render/export stay available, but
 * mutating commands are blocked at the commit pipeline. WeakMap-cached per
 * document object so the per-commit check costs one map lookup.
 */
export function isDocumentCapabilityReadOnly(ir: CanvasIR): boolean {
	const cached = readOnlyCache.get(ir);
	if (cached !== undefined) return cached;
	const readOnly = validateLayoutInvariants(ir).some(
		(issue) => issue.code === "layout-capability-unsupported",
	);
	readOnlyCache.set(ir, readOnly);
	return readOnly;
}

const warned = new WeakSet<CanvasIR>();

/** One console warning per blocked document, not per blocked command. */
export function warnReadOnlyCommitBlocked(ir: CanvasIR): void {
	if (warned.has(ir)) return;
	warned.add(ir);
	console.warn(
		"[canvas-editor] Document requires a capability this build does not implement; mutating commands are blocked (read-only preview — AC-010). Export remains available.",
	);
}
