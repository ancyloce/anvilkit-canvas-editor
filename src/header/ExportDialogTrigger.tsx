"use client";

import { Button } from "@anvilkit/ui/button";
import {
	lazy,
	Suspense,
	useEffect,
	useState,
	useSyncExternalStore,
} from "react";
import {
	useCanvasStudio,
	useCanvasT,
} from "../context/canvas-studio-context.js";
import type { CanvasExportPluginOptions } from "./types.js";

// FR-150 dialog is CODE-SPLIT (constraint 20.15): the modal chunk loads on
// first open, not with the editor bundle.
const ExportDialog = lazy(() => import("./ExportDialog.js"));

/**
 * Header button that opens the export dialog (B-09). Also opens on demand when
 * another surface posts an export request (FR-031 "Export selection", FR-032
 * "Export page"), and advertises availability so those menus can disable their
 * export entries when no export UI is mounted.
 */
export function ExportDialogTrigger(
	options: CanvasExportPluginOptions,
): React.JSX.Element {
	const t = useCanvasT();
	const ctx = useCanvasStudio();
	const [open, setOpen] = useState(false);
	const exportRequestStore = ctx.exportRequestStore;

	// Advertise that export UI is mounted (menus gate their entries on this).
	useEffect(() => {
		exportRequestStore?.getState().setAvailable(true);
		return () => exportRequestStore?.getState().setAvailable(false);
	}, [exportRequestStore]);

	// Open when a menu posts a scoped request; the dialog itself consumes the
	// pending scope on mount.
	const pending = useSyncExternalStore(
		exportRequestStore?.subscribe ?? (() => () => undefined),
		() => exportRequestStore?.getState().pending ?? null,
		() => exportRequestStore?.getState().pending ?? null,
	);
	useEffect(() => {
		if (pending) setOpen(true);
	}, [pending]);

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
