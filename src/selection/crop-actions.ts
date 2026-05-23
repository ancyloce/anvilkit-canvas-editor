import { type CanvasNodeUpdateCommand, findNode } from "@anvilkit/canvas-core";
import type { CanvasStudioContextValue } from "../context/canvas-studio-context.js";
import type { CropRect } from "../stores/crop-store.js";

/** Which crop handle is being dragged. `move` translates the whole rect. */
export type CropDragMode = "move" | "nw" | "ne" | "sw" | "se";

const MIN_CROP = 1;

function clamp(value: number, lo: number, hi: number): number {
	return Math.max(lo, Math.min(hi, value));
}

/**
 * Pure geometry for an interactive crop drag. Given the rect at drag start, a
 * delta in natural-image pixels, and the source dimensions, returns the new
 * crop rect clamped to `[0, naturalW] × [0, naturalH]` with a `MIN_CROP` floor.
 * Side-effect-free so the handle math is unit-testable without a DOM.
 */
export function computeCropDrag(
	mode: CropDragMode,
	start: CropRect,
	dxNat: number,
	dyNat: number,
	naturalW: number,
	naturalH: number,
): CropRect {
	const right = start.x + start.width;
	const bottom = start.y + start.height;
	let { x, y, width, height } = start;
	const adjustLeft = () => {
		x = clamp(start.x + dxNat, 0, right - MIN_CROP);
		width = right - x;
	};
	const adjustRight = () => {
		const r = clamp(right + dxNat, start.x + MIN_CROP, naturalW);
		width = r - start.x;
	};
	const adjustTop = () => {
		y = clamp(start.y + dyNat, 0, bottom - MIN_CROP);
		height = bottom - y;
	};
	const adjustBottom = () => {
		const b = clamp(bottom + dyNat, start.y + MIN_CROP, naturalH);
		height = b - start.y;
	};
	switch (mode) {
		case "move":
			x = clamp(start.x + dxNat, 0, Math.max(0, naturalW - start.width));
			y = clamp(start.y + dyNat, 0, Math.max(0, naturalH - start.height));
			break;
		case "nw":
			adjustLeft();
			adjustTop();
			break;
		case "ne":
			adjustRight();
			adjustTop();
			break;
		case "sw":
			adjustLeft();
			adjustBottom();
			break;
		case "se":
			adjustRight();
			adjustBottom();
			break;
	}
	return { x, y, width, height };
}

/**
 * Open the interactive crop editor for an image node. Returns false (no-op)
 * when the crop store is unavailable or the target is not an image node.
 */
export function beginCrop(
	ctx: CanvasStudioContextValue,
	nodeId: string,
): boolean {
	if (!ctx.cropStore) return false;
	const found = findNode(ctx.getIR(), nodeId);
	if (!found || found.node.type !== "image") return false;
	ctx.cropStore.getState().begin(nodeId);
	return true;
}

/**
 * Commit the in-progress crop draft as a single `node.update` and close the
 * editor. A zero-area draft is discarded (treated as a cancel) so an empty drag
 * never writes a degenerate crop.
 */
export function commitCrop(ctx: CanvasStudioContextValue): void {
	const store = ctx.cropStore;
	if (!store) return;
	const { cropNodeId, draft } = store.getState();
	if (cropNodeId && draft && draft.width > 0 && draft.height > 0) {
		const cmd: CanvasNodeUpdateCommand<"image"> = {
			type: "node.update",
			nodeId: cropNodeId,
			kind: "image",
			patch: { crop: { ...draft } },
		};
		ctx.commit(cmd);
	}
	store.getState().clear();
}

/** Close the crop editor without committing. */
export function cancelCrop(ctx: CanvasStudioContextValue): void {
	ctx.cropStore?.getState().clear();
}
