"use client";

import { Button } from "@anvilkit/ui/button";
import { useRef, useSyncExternalStore } from "react";
import {
	retryUploadImpl,
	uploadFilesImpl,
} from "../../assets/upload-actions.js";
import {
	useCanvasStudio,
	useCanvasT,
} from "../../context/canvas-studio-context.js";
import { useCanvasToaster } from "../../context/toast-context.js";
import { ASSET_DRAG_MIME } from "./CanvasDropZone.js";

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

	const handleRetry = (taskId: string): void => {
		void retryUploadImpl(ctx, taskId, toaster);
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
							// FR-093: a completed upload is draggable onto the canvas —
							// dropping it on an image node or image-well frame replaces
							// that target; anywhere else inserts (no re-upload).
							draggable={task.status === "done" && task.assetId !== undefined}
							onDragStart={(e) => {
								if (task.status !== "done" || task.assetId === undefined) {
									return;
								}
								e.dataTransfer.setData(ASSET_DRAG_MIME, task.assetId);
								e.dataTransfer.effectAllowed = "copy";
							}}
							className="flex flex-col gap-1 rounded-md bg-muted px-2 py-1 text-xs"
						>
							<span className="flex items-center justify-between gap-2">
								<span className="truncate">{task.fileName}</span>
								<span
									className="flex items-center gap-1 text-muted-foreground"
									role="status"
								>
									{task.status === "uploading"
										? task.progress !== undefined
											? t("canvas.upload.uploading", "Uploading…") +
												` ${Math.round(task.progress * 100)}%`
											: t("canvas.upload.uploading", "Uploading…")
										: task.status === "failed"
											? (task.error ??
												t("canvas.upload.failed", "Upload failed"))
											: task.status === "cancelled"
												? t("canvas.upload.cancelled", "Cancelled")
												: t("canvas.upload.done", "Done")}
									{task.status === "uploading" && uploadStore ? (
										<button
											type="button"
											data-testid={`upload-cancel-${task.id}`}
											aria-label={`${t("canvas.upload.cancel", "Cancel upload")} — ${task.fileName}`}
											title={t("canvas.upload.cancel", "Cancel upload")}
											className="rounded px-1 hover:bg-background"
											onClick={() => uploadStore.getState().cancel(task.id)}
										>
											×
										</button>
									) : null}
									{task.status === "failed" && hasUploader ? (
										<button
											type="button"
											data-testid={`upload-retry-${task.id}`}
											aria-label={`${t("canvas.upload.retry", "Retry")} — ${task.fileName}`}
											className="rounded px-1 hover:bg-background"
											onClick={() => handleRetry(task.id)}
										>
											{t("canvas.upload.retry", "Retry")}
										</button>
									) : null}
								</span>
							</span>
							{task.status === "uploading" ? (
								// FR-091 accessible progress: determinate when the adapter
								// reports fractions, indeterminate otherwise.
								<div
									role="progressbar"
									aria-label={`${t("canvas.upload.progress", "Upload progress")} — ${task.fileName}`}
									aria-valuemin={0}
									aria-valuemax={100}
									{...(task.progress !== undefined
										? { "aria-valuenow": Math.round(task.progress * 100) }
										: {})}
									data-testid={`upload-progress-${task.id}`}
									className="h-1 w-full overflow-hidden rounded-full bg-border"
								>
									<div
										className={
											task.progress !== undefined
												? "h-full rounded-full bg-primary transition-[width]"
												: "h-full w-1/3 animate-pulse rounded-full bg-primary"
										}
										style={
											task.progress !== undefined
												? { width: `${Math.round(task.progress * 100)}%` }
												: undefined
										}
									/>
								</div>
							) : null}
						</li>
					))}
				</ul>
			) : null}
		</div>
	);
}
