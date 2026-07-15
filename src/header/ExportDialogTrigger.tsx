"use client";

import { Button } from "@anvilkit/ui/button";
import { lazy, Suspense, useState } from "react";
import { useCanvasT } from "../context/canvas-studio-context.js";
import type { CanvasExportPluginOptions } from "./types.js";

// FR-150 dialog is CODE-SPLIT (constraint 20.15): the modal chunk loads on
// first open, not with the editor bundle.
const ExportDialog = lazy(() => import("./ExportDialog.js"));

/** Header button that opens the export dialog (B-09). */
export function ExportDialogTrigger(
	options: CanvasExportPluginOptions,
): React.JSX.Element {
	const t = useCanvasT();
	const [open, setOpen] = useState(false);
	return (
		<>
			<Button
				type="button"
				size="sm"
				data-testid="workspace-export"
				onClick={() => setOpen(true)}
			>
				{t("canvas.export.title", "Export")}
			</Button>
			{open ? (
				<Suspense fallback={null}>
					<ExportDialog {...options} onClose={() => setOpen(false)} />
				</Suspense>
			) : null}
		</>
	);
}
