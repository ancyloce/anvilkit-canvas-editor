import { type CanvasCommand, createImage } from "@anvilkit/canvas-core";
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
	const anchor =
		position &&
		position.x >= 0 &&
		position.x <= page.size.width &&
		position.y >= 0 &&
		position.y <= page.size.height
			? position
			: undefined;
	const cmds: CanvasCommand[] = [];
	const newIds: string[] = [];
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
		newIds.push(node.id);
		cmds.push(
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
			{ type: "node.create", node, pageId: activePageId },
		);
	}
	ctx.commitBatch(cmds, "Add assets");
	ctx.selectionStore.getState().setSelection(newIds);
	return newIds;
}

/**
 * FR-091/092 upload flow: track tasks in the upload store, hand the files to
 * the host uploader, then insert the results — one undo entry. Failures mark
 * the tasks failed and create NO nodes; a task cancelled while in flight
 * drops its results silently.
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
	const uploadStore = ctx.uploadStore;
	const taskIds = files.map(
		(file) => uploadStore?.getState().begin(file.name) ?? "",
	);
	try {
		const uploaded = await uploader.upload(files, {
			documentId: ctx.getIR().id,
		});
		const anyCancelled = taskIds.some(
			(id) => id !== "" && uploadStore?.getState().isCancelled(id),
		);
		if (anyCancelled) return [];
		for (const id of taskIds) {
			if (id !== "") uploadStore?.getState().succeed(id);
		}
		return insertAssetsImpl(ctx, uploaded, position);
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		for (const id of taskIds) {
			if (id !== "") uploadStore?.getState().fail(id, message);
		}
		toaster.add({
			type: "error",
			title: t("canvas.upload.failed", "Upload failed"),
			description: message,
		});
		return [];
	}
}
