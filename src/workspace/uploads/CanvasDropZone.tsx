"use client";

import { type ReactNode, useState } from "react";
import { uploadFilesImpl } from "../../assets/upload-actions.js";
import { useCanvasStudio } from "../../context/canvas-studio-context.js";
import { useCanvasToaster } from "../../context/toast-context.js";

/**
 * FR-092 (B-10): dropping image files anywhere on the canvas area uploads
 * them through the host adapter and inserts the results centered on the
 * active page (grid-arranged for multiples). Renders nothing extra beyond a
 * `data-dragging` attribute for drop styling.
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
					void uploadFilesImpl(ctx, Array.from(files), undefined, toaster);
				}
			}}
		>
			{children}
		</div>
	);
}
