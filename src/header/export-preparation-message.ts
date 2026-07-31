import type { CanvasExportPreparationErrorCode } from "@anvilkit/canvas-core/export-preparation";

import type { CanvasT } from "../context/canvas-studio-context.js";

/**
 * @file Localized copy for an export refusal (plan 0021 T-046).
 *
 * Derived from the stable code, never from `CanvasExportPreparation.message`.
 * That message is written for a developer — it names instance ids and counts —
 * and shipping it to a content operator would be both unhelpful and, for a
 * `component-unresolved` refusal, a partial disclosure of the document's
 * library structure. Same rule as `blockedOperationMessage` for policy denials.
 */
export function exportPreparationMessage(
	t: CanvasT,
	code: CanvasExportPreparationErrorCode,
): string {
	switch (code) {
		case "component-unresolved":
			return t(
				"canvas.export.blockedUnresolved",
				"Some components can't be resolved. Restore or remove them before exporting.",
			);
		case "flatten-denied":
			return t(
				"canvas.export.blockedFlatten",
				"This format flattens components, which this document's brand policy doesn't allow. Try a format that keeps components.",
			);
		case "document-ref-unresolved":
			return t(
				"canvas.export.blockedUnresolvedRef",
				"This document couldn't be prepared for export.",
			);
		case "document-invalid":
			return t(
				"canvas.export.blockedInvalid",
				"This document couldn't be prepared for export.",
			);
	}
}
