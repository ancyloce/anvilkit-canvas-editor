"use client";

import { Button } from "@anvilkit/ui/button";
import { useRef, useSyncExternalStore } from "react";
import { uploadFilesImpl } from "../../assets/upload-actions.js";
import {
	useCanvasStudio,
	useCanvasT,
} from "../../context/canvas-studio-context.js";
import { useCanvasToaster } from "../../context/toast-context.js";

const EMPTY_TASKS: never[] = [];

/**
 * The Uploads dock panel (B-10, FR-091/092) — fills the M0-08 stub. File
 * picking and drag-and-drop both route through `uploadFilesImpl`, so panel
 * and canvas drops behave identically (one undo entry, no nodes on failure).
 */
export function UploadsPanel(): React.JSX.Element {
	const ctx = useCanvasStudio();
	const t = useCanvasT();
	const toaster = useCanvasToaster();
	const inputRef = useRef<HTMLInputElement | null>(null);
	const uploadStore = ctx.uploadStore;
	const tasks = useSyncExternalStore(
		uploadStore?.subscribe ?? (() => () => undefined),
		() => uploadStore?.getState().tasks ?? EMPTY_TASKS,
		() => uploadStore?.getState().tasks ?? EMPTY_TASKS,
	);
	const hasUploader = ctx.assetUploader !== undefined;

	const handleFiles = (list: FileList | null): void => {
		if (!list || list.length === 0) return;
		// Deliberately no position: this drop target is the side-panel dock, not
		// the canvas, so there's no drop-relative page point to convert (unlike
		// `CanvasDropZone`, which anchors to the real cursor position — FR-092).
		// Page-center insertion is the correct semantic here.
		void uploadFilesImpl(ctx, Array.from(list), undefined, toaster);
	};

	return (
		<div
			data-testid="uploads-panel"
			className="flex h-full flex-col gap-3 p-3 text-sm"
			onDragOver={(e) => {
				e.preventDefault();
			}}
			onDrop={(e) => {
				e.preventDefault();
				handleFiles(e.dataTransfer?.files ?? null);
			}}
		>
			<input
				ref={inputRef}
				type="file"
				multiple
				accept="image/*"
				className="hidden"
				data-testid="uploads-input"
				onChange={(e) => {
					handleFiles(e.currentTarget.files);
					e.currentTarget.value = "";
				}}
			/>
			<Button
				type="button"
				data-testid="uploads-pick"
				disabled={!hasUploader}
				onClick={() => inputRef.current?.click()}
			>
				{t("canvas.upload.pickFiles", "Upload files")}
			</Button>
			{!hasUploader ? (
				<p
					className="text-xs text-muted-foreground"
					data-testid="uploads-empty"
				>
					{t(
						"canvas.upload.noUploader",
						"This workspace has no upload service configured",
					)}
				</p>
			) : (
				<p className="rounded-md border border-dashed border-border p-3 text-center text-xs text-muted-foreground">
					{t("canvas.upload.dropHint", "Drop images here or on the canvas")}
				</p>
			)}
			{tasks.length > 0 ? (
				<ul className="flex flex-col gap-1" data-testid="uploads-tasks">
					{tasks.map((task) => (
						<li
							key={task.id}
							data-testid={`upload-task-${task.id}`}
							data-status={task.status}
							className="flex items-center justify-between gap-2 rounded-md bg-muted px-2 py-1 text-xs"
						>
							<span className="truncate">{task.fileName}</span>
							<span className="flex items-center gap-1 text-muted-foreground">
								{task.status === "uploading"
									? t("canvas.upload.uploading", "Uploading…")
									: task.status === "failed"
										? (task.error ?? t("canvas.upload.failed", "Upload failed"))
										: task.status === "cancelled"
											? t("canvas.upload.cancelled", "Cancelled")
											: t("canvas.upload.done", "Done")}
								{task.status === "uploading" && uploadStore ? (
									<button
										type="button"
										data-testid={`upload-cancel-${task.id}`}
										className="rounded px-1 hover:bg-background"
										onClick={() => uploadStore.getState().cancel(task.id)}
									>
										×
									</button>
								) : null}
							</span>
						</li>
					))}
				</ul>
			) : null}
		</div>
	);
}
