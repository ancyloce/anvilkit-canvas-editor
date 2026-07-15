"use client";

import { ExportDialogTrigger } from "./ExportDialogTrigger.js";
import type { CanvasExportPluginOptions, CanvasHeaderPlugin } from "./types.js";

/**
 * Builds the export {@link CanvasHeaderPlugin} for the workspace header.
 * Pass it to `<CanvasWorkspace headerPlugins={[…]}>`. PNG/JSON work with no
 * config; inject `exporters.svg` / `exporters.pdf` to enable those cards.
 *
 * @example
 * createCanvasExportPlugin({
 *   exporters: {
 *     svg: async ({ ir, activePageId }) => {
 *       const { svg } = await canvasToSvg(ir, activePageId);
 *       return { filename: `${ir.title}.svg`, data: svg, mimeType: "image/svg+xml" };
 *     },
 *   },
 * });
 */
export function createCanvasExportPlugin(
	options: CanvasExportPluginOptions = {},
): CanvasHeaderPlugin {
	return {
		id: "canvas-export",
		// B-09: the popover's contents graduated into the FR-150 dialog. The
		// legacy `<ExportMenu>` popover stays exported for hosts that mount it
		// directly (PRD 0012 §15.9 compat).
		render: () => <ExportDialogTrigger {...options} />,
	};
}
