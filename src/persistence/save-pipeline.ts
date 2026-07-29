import {
	type CanvasIR,
	materializeCanvasLayout,
	resolveCanvasLayout,
} from "@anvilkit/canvas-core";
import { irCarriesLayoutIntent } from "../auto-layout/intent.js";
import { createCanvasLayoutMeasurementProvider } from "../text/canvas-text-measurer.js";
import { withRequiredLayoutCapability } from "./layout-compatibility.js";

/**
 * @file T-M5-03 — the pre-save document pipeline (NFR-REL-003, AC-001).
 *
 * Before a document leaves the session it is completed and stamped:
 * 1. capability completion (`layout.auto.v1` declared whenever intent exists);
 * 2. one resolution with the CURRENT measurement manifest;
 * 3. `materializeCanvasLayout` writes resolved geometry + the
 *    `layoutMaterialization` stamp carrying the save revision — so an older
 *    reader opens the document at its authored visual result.
 *
 * Layout intent is NEVER discarded or rewritten here. The resolver is
 * contractually non-throwing (measurement failures degrade to deterministic
 * fallbacks + diagnostics), but if resolution ever did fail the document
 * ships capability-complete with its prior stored geometry — the last valid
 * cache — rather than losing the save.
 */
export function prepareDocumentForSave(
	ir: CanvasIR,
	revision: number,
): CanvasIR {
	if (!irCarriesLayoutIntent(ir)) return ir;
	const complete = withRequiredLayoutCapability(ir);
	try {
		const resolved = resolveCanvasLayout(complete, {
			measurement: createCanvasLayoutMeasurementProvider(),
		});
		return materializeCanvasLayout(complete, resolved, { revision });
	} catch {
		return complete;
	}
}
