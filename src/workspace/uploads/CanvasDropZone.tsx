"use client";

import { type ReactNode, useState } from "react";
import { uploadFilesImpl } from "../../assets/upload-actions.js";
import {
	type CanvasStudioContextValue,
	useCanvasStudio,
} from "../../context/canvas-studio-context.js";
import { useCanvasToaster } from "../../context/toast-context.js";

/**
 * Convert a drop event's screen coordinates into page-space coordinates
 * (FR-092 "inserted at the drop position"). Mirrors — inverted — the
 * container + zoom + pan transform already used to place on-stage overlays
 * (`CropEditorOverlay`/`TextEditorOverlay`/`RichTextToolbar`:
 * `screenX = containerRect.left + pageX * zoom + panX`). Returns undefined
 * when there's no live stage to anchor against, so callers fall back to
 * page-center insertion.
 */
function clientPointToPage(
	ctx: CanvasStudioContextValue,
	clientX: number,
	clientY: number,
): { x: number; y: number } | undefined {
	const stage = ctx.stage;
	// Call `container()` AS A METHOD — an unbound reference drops Konva's
	// `this` binding and crashes against a real stage (see the same note on
	// CropEditorOverlay/TextEditorOverlay).
	const container =
		stage && typeof stage.container === "function" ? stage.container() : null;
	const rect = container?.getBoundingClientRect?.();
	if (!rect) return undefined;
	const vp = ctx.viewportStore.getState();
	return {
		x: (clientX - rect.left - vp.panX) / vp.zoom,
		y: (clientY - rect.top - vp.panY) / vp.zoom,
	};
}

/**
 * FR-092 (B-10): dropping image files anywhere on the canvas area uploads
 * them through the host adapter and inserts the results at the drop
 * position (grid-arranged for multiples), falling back to page-center when
 * the drop lands outside the active page — or before the stage has mounted.
 * Renders nothing extra beyond a `data-dragging` attribute for drop styling.
 */
export function CanvasDropZone({
	children,
}: {
	children: ReactNode;
}): React.JSX.Element {
	const ctx = useCanvasStudio();
	const toaster = useCanvasToaster();
	const [dragging, setDragging] = useState(false);
	return (
		<div
			data-testid="canvas-drop-zone"
			data-dragging={dragging ? "true" : "false"}
			className="flex min-h-0 min-w-0 flex-1 flex-col"
			onDragOver={(e) => {
				if (e.dataTransfer?.types.includes("Files")) {
					e.preventDefault();
					setDragging(true);
				}
			}}
			onDragLeave={() => setDragging(false)}
			onDrop={(e) => {
				setDragging(false);
				const files = e.dataTransfer?.files;
				if (files && files.length > 0) {
					e.preventDefault();
					const position = clientPointToPage(ctx, e.clientX, e.clientY);
					void uploadFilesImpl(ctx, Array.from(files), position, toaster);
				}
			}}
		>
			{children}
		</div>
	);
}
