import {
	type CanvasCommand,
	type CanvasPage,
	createImage,
} from "@anvilkit/canvas-core";
import type { CanvasStudioContextValue } from "../context/canvas-studio-context.js";
import {
	type CanvasToaster,
	NOOP_CANVAS_TOASTER,
} from "../context/toast-context.js";
import type { CanvasPickedAsset } from "./adapter-types.js";

const DEFAULT_W = 240;
const DEFAULT_H = 180;
/** Grid step for multi-asset drops (FR-092 "simple grid"). */
const GRID_STEP = 24;
const GRID_COLUMNS = 3;

/**
 * Pure command-building core shared by {@link insertAssetsImpl} and the
 * Image tool's multi-pick path (FR-090, `tools/image-tool.ts`): grid-arrange
 * `assets` around `position` (falling back to page center when omitted or
 * out of bounds), producing an `asset.put` + `node.create` pair per asset.
 * No `ctx` dependency — callers own committing the batch and selecting the
 * result, since that differs (`ToolContext.commitBatch` is optional, unlike
 * {@link CanvasStudioContextValue.commitBatch}).
 */
export function buildAssetInsertCommands(
	assets: readonly CanvasPickedAsset[],
	page: CanvasPage,
	position?: { x: number; y: number },
): { commands: CanvasCommand[]; nodeIds: string[] } {
	const anchor =
		position &&
		position.x >= 0 &&
		position.x <= page.size.width &&
		position.y >= 0 &&
		position.y <= page.size.height
			? position
			: undefined;
	const commands: CanvasCommand[] = [];
	const nodeIds: string[] = [];
	for (const [index, asset] of assets.entries()) {
		const width = asset.width ?? DEFAULT_W;
		const height = asset.height ?? DEFAULT_H;
		const base = anchor ?? {
			x: (page.size.width - width) / 2,
			y: (page.size.height - height) / 2,
		};
		const node = createImage({
			assetId: asset.id,
			bounds: { width, height },
			transform: {
				x: base.x + (index % GRID_COLUMNS) * GRID_STEP,
				y: base.y + Math.floor(index / GRID_COLUMNS) * GRID_STEP,
			},
		});
		nodeIds.push(node.id);
		commands.push(
			{
				type: "asset.put",
				asset: {
					id: asset.id,
					uri: asset.uri,
					...(asset.mimeType !== undefined ? { mimeType: asset.mimeType } : {}),
					...(asset.width !== undefined ? { width: asset.width } : {}),
					...(asset.height !== undefined ? { height: asset.height } : {}),
				},
			},
			{ type: "node.create", node, pageId: page.id },
		);
	}
	return { commands, nodeIds };
}

function resolveT(ctx: CanvasStudioContextValue) {
	return ctx.t ?? ((_key: string, fallback?: string) => fallback ?? "");
}

/**
 * Insert already-uploaded/picked assets into the active page as ONE undo
 * entry: `asset.put` for each ref plus an image node per asset, arranged in a
 * simple grid around the drop position — falling back to the page center
 * when no position is given, OR when the given position falls outside the
 * active page's bounds (FR-092 "out-of-page drops are centered"; drops are
 * only ever anchored to a real point once they've already landed on the
 * page).
 * Returns the created node ids and selects them.
 */
export function insertAssetsImpl(
	ctx: CanvasStudioContextValue,
	assets: readonly CanvasPickedAsset[],
	position?: { x: number; y: number },
): string[] {
	if (assets.length === 0) return [];
	const ir = ctx.getIR();
	const activePageId = ctx.pagesStore.getState().activePageId;
	const page = ir.pages.find((p) => p.id === activePageId);
	if (!page) return [];
	const { commands, nodeIds } = buildAssetInsertCommands(
		assets,
		page,
		position,
	);
	ctx.commitBatch(commands, "Add assets");
	ctx.selectionStore.getState().setSelection(nodeIds);
	return nodeIds;
}

/**
 * Upload ONE file as one tracked task: per-task AbortController (FR-092 real
 * cancellation when the adapter honors the signal; logical result-discard
 * when it doesn't), per-task determinate progress when the adapter reports it
 * (FR-091), and stale-guarding — a result landing after the task was
 * cancelled or the store was reset (document replacement / unmount) is
 * dropped without creating an asset or node.
 */
export async function uploadSingleFile(
	ctx: CanvasStudioContextValue,
	file: File,
): Promise<
	| { ok: true; assets: readonly CanvasPickedAsset[] }
	| { ok: false; error?: string }
> {
	const uploader = ctx.assetUploader;
	const uploadStore = ctx.uploadStore;
	if (!uploader) return { ok: false };
	const id = uploadStore?.getState().begin(file) ?? "";
	const controller = new AbortController();
	if (id !== "") {
		uploadStore?.getState().registerAbort(id, () => controller.abort());
	}
	const settled = (): "gone" | "cancelled" | "live" => {
		if (id === "" || !uploadStore) return "live";
		if (!uploadStore.getState().has(id)) return "gone";
		if (uploadStore.getState().isCancelled(id)) return "cancelled";
		return "live";
	};
	try {
		const uploaded = await uploader.upload([file], {
			documentId: ctx.getIR().id,
			signal: controller.signal,
			onProgress: (event) => {
				if (
					event.fileIndex === 0 &&
					event.fraction !== undefined &&
					id !== ""
				) {
					uploadStore?.getState().setProgress(id, event.fraction);
				}
			},
		});
		if (settled() !== "live") return { ok: false };
		if (id !== "") uploadStore?.getState().succeed(id, uploaded[0]?.id);
		return { ok: true, assets: uploaded };
	} catch (err) {
		// An abort-triggered rejection is the cancel path, not a failure.
		if (settled() !== "live" || controller.signal.aborted) return { ok: false };
		const message = err instanceof Error ? err.message : String(err);
		if (id !== "") uploadStore?.getState().fail(id, message);
		return { ok: false, error: message };
	}
}

/**
 * FR-091/092 upload flow: track tasks in the upload store, hand each file to
 * the host uploader (one `upload()` call per file so progress and
 * cancellation attribute per task), then insert every SUCCEEDED result as one
 * undo entry. Failed tasks show retry, cancelled tasks drop their results,
 * and neither creates nodes or asset entries; a partial batch inserts only
 * its successes. Uploads resolving after a document replacement insert
 * nothing (their tasks were reset away).
 */
export async function uploadFilesImpl(
	ctx: CanvasStudioContextValue,
	files: readonly File[],
	position?: { x: number; y: number },
	toaster: CanvasToaster = NOOP_CANVAS_TOASTER,
): Promise<string[]> {
	if (files.length === 0) return [];
	const uploader = ctx.assetUploader;
	const t = resolveT(ctx);
	if (!uploader) {
		toaster.add({
			type: "info",
			title: t(
				"canvas.upload.noUploader",
				"This workspace has no upload service configured",
			),
		});
		return [];
	}
	// Captured before any upload starts. Each `uploadSingleFile` only
	// validates against ITS OWN resolve time — a task that finished (and
	// returned ok:true) BEFORE a later document replacement never gets a
	// chance to re-check, so the batch-level insert below re-validates
	// against the document this batch actually started against (E-6):
	// otherwise an earlier success can commit into a document the upload was
	// never intended for.
	const targetDocumentId = ctx.getIR().id;
	const results = await Promise.all(
		files.map((file) => uploadSingleFile(ctx, file)),
	);
	const errors = results.flatMap((r) => (!r.ok && r.error ? [r.error] : []));
	if (errors.length > 0) {
		toaster.add({
			type: "error",
			title: t("canvas.upload.failed", "Upload failed"),
			description: errors[0],
		});
	}
	if (ctx.getIR().id !== targetDocumentId) return [];
	const uploaded = results.flatMap((r) => (r.ok ? r.assets : []));
	if (uploaded.length === 0) return [];
	return insertAssetsImpl(ctx, uploaded, position);
}

/**
 * FR-091 retry: resubmit a single FAILED task's original file without the
 * user re-selecting it. Resets the SAME task id back to "uploading" (not a
 * new task) so the panel's list doesn't grow a duplicate entry. No-op for an
 * unknown task, a task not currently failed, or a host with no uploader.
 */
export async function retryUploadImpl(
	ctx: CanvasStudioContextValue,
	taskId: string,
	toaster: CanvasToaster = NOOP_CANVAS_TOASTER,
): Promise<string[]> {
	const uploadStore = ctx.uploadStore;
	const uploader = ctx.assetUploader;
	if (!uploadStore || !uploader) return [];
	const task = uploadStore.getState().tasks.find((t) => t.id === taskId);
	if (!task || task.status !== "failed") return [];
	const t = resolveT(ctx);
	uploadStore.getState().retry(taskId);
	const controller = new AbortController();
	uploadStore.getState().registerAbort(taskId, () => controller.abort());
	try {
		const uploaded = await uploader.upload([task.file], {
			documentId: ctx.getIR().id,
			signal: controller.signal,
			onProgress: (event) => {
				if (event.fileIndex === 0 && event.fraction !== undefined) {
					uploadStore.getState().setProgress(taskId, event.fraction);
				}
			},
		});
		if (
			!uploadStore.getState().has(taskId) ||
			uploadStore.getState().isCancelled(taskId)
		) {
			return [];
		}
		uploadStore.getState().succeed(taskId);
		return insertAssetsImpl(ctx, uploaded);
	} catch (err) {
		if (
			!uploadStore.getState().has(taskId) ||
			uploadStore.getState().isCancelled(taskId) ||
			controller.signal.aborted
		) {
			return [];
		}
		const message = err instanceof Error ? err.message : String(err);
		uploadStore.getState().fail(taskId, message);
		toaster.add({
			type: "error",
			title: t("canvas.upload.failed", "Upload failed"),
			description: message,
		});
		return [];
	}
}
