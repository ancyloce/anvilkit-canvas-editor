import type {
	CanvasAutoLayout,
	CanvasCommand,
	CanvasFrameNode,
	CanvasIR,
	CanvasLayoutDirection,
	CanvasLayoutGeometryWrite,
	CanvasNode,
	CanvasResolvedNodeRecord,
	CanvasResolvedView,
} from "@anvilkit/canvas-core";
import { findNode, parentOf } from "@anvilkit/canvas-core";
import type { CanvasLayoutEditorEvent } from "../auto-layout/events.js";
import type { CanvasStudioContextValue } from "../context/canvas-studio-context.js";

/**
 * @file T-M4-05 — Auto Layout creation, conversion, and removal actions.
 *
 * Every action computes resolved geometry CALLER-side (from the studio's
 * resolved document) and passes it in the command payload: rank-3 `commands/`
 * must never call the rank-4 resolver, and re-resolution/materialization
 * happen in the editor layer, never inside `applyCommand`. Each action is one
 * history entry (a single command, or one batch).
 */

export const DEFAULT_AUTO_LAYOUT_GAP = 8;

function defaultAutoLayout(direction: CanvasLayoutDirection): CanvasAutoLayout {
	return {
		version: 1,
		direction,
		padding: { top: 0, right: 0, bottom: 0, left: 0 },
		gap: DEFAULT_AUTO_LAYOUT_GAP,
		primaryAlign: "start",
		crossAlign: "start",
	};
}

function generateFrameId(): string {
	const c = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto;
	if (c && typeof c.randomUUID === "function") return c.randomUUID();
	return `frame-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

interface ParentSpaceBox {
	minX: number;
	minY: number;
	maxX: number;
	maxY: number;
}

function viewOf(ctx: CanvasStudioContextValue): CanvasResolvedView | null {
	return ctx.resolvedDocumentStore?.getState().view ?? null;
}

/**
 * A node's extent in its parent's space: the resolver's `layoutFootprint`
 * when a resolved record exists, else a rotation-blind fallback from stored
 * transform + bounds (hosts without the resolved store).
 */
function parentSpaceBox(
	node: CanvasNode,
	record: CanvasResolvedNodeRecord | undefined,
): ParentSpaceBox {
	if (record) return record.geometry.layoutFootprint;
	const t = node.transform;
	const b = node.bounds;
	return {
		minX: t.x,
		minY: t.y,
		maxX: t.x + b.width,
		maxY: t.y + b.height,
	};
}

function centroid(
	box: ParentSpaceBox,
	direction: CanvasLayoutDirection,
): number {
	return direction === "horizontal"
		? (box.minX + box.maxX) / 2
		: (box.minY + box.maxY) / 2;
}

/**
 * PRD §9.6 default: direction follows the dominant centroid spread of the
 * children being laid out; a tie (or fewer than two children) is horizontal.
 */
function inferDirection(
	boxes: readonly ParentSpaceBox[],
): CanvasLayoutDirection {
	if (boxes.length < 2) return "horizontal";
	const cx = boxes.map((b) => (b.minX + b.maxX) / 2);
	const cy = boxes.map((b) => (b.minY + b.maxY) / 2);
	const spreadX = Math.max(...cx) - Math.min(...cx);
	const spreadY = Math.max(...cy) - Math.min(...cy);
	return spreadX >= spreadY ? "horizontal" : "vertical";
}

/**
 * `node.reorder` commands that transform `current` into `target`, emitted in
 * target-index order and mirrored against a working copy so each command's
 * remove-then-insert semantics are accounted for.
 */
function reorderCommandsTo(
	current: readonly string[],
	target: readonly string[],
): CanvasCommand[] {
	const work = [...current];
	const cmds: CanvasCommand[] = [];
	for (let i = 0; i < target.length; i += 1) {
		const id = target[i];
		if (id === undefined || work[i] === id) continue;
		const from = work.indexOf(id);
		if (from < 0) continue;
		work.splice(from, 1);
		work.splice(i, 0, id);
		cmds.push({ type: "node.reorder", nodeId: id, toIndex: i });
	}
	return cmds;
}

function isPlainFrame(node: CanvasNode): node is CanvasFrameNode {
	return node.type === "frame" && node.autoLayout == null;
}

function isLayoutFrame(node: CanvasNode): node is CanvasFrameNode {
	return node.type === "frame" && node.autoLayout != null;
}

export function canEnableAutoLayout(
	ir: CanvasIR,
	selectedIds: readonly string[],
): boolean {
	if (selectedIds.length === 0) return false;
	return selectedIds.every((id) => {
		const found = findNode(ir, id);
		return !!found && isPlainFrame(found.node);
	});
}

/**
 * Enable Auto Layout on every selected plain frame: children adopt their
 * current visual order (resolved footprint centroids along the inferred
 * direction) via `node.reorder`, then one `frame.set-layout` per frame writes
 * the PRD defaults — inferred direction, gap 8, zero padding, Start/Start.
 * ONE history entry for the whole action. Returns the frame ids converted.
 */
export function enableAutoLayoutOnSelectionImpl(
	ctx: CanvasStudioContextValue,
	direction?: CanvasLayoutDirection,
): string[] {
	const ir = ctx.getIR();
	const selectedIds = ctx.selectionStore.getState().selectedIds;
	if (!canEnableAutoLayout(ir, selectedIds)) return [];
	const view = viewOf(ctx);
	const cmds: CanvasCommand[] = [];
	const frameIds: string[] = [];
	const events: CanvasLayoutEditorEvent[] = [];
	for (const id of selectedIds) {
		const found = findNode(ir, id);
		if (!found || !isPlainFrame(found.node)) continue;
		const frame = found.node;
		const boxes = frame.children.map((child) =>
			parentSpaceBox(child, view?.getRecord(child.id)),
		);
		const dir = direction ?? inferDirection(boxes);
		const currentOrder = frame.children.map((c) => c.id);
		const targetOrder = frame.children
			.map((child, i) => ({
				id: child.id,
				at: centroid(boxes[i] as ParentSpaceBox, dir),
			}))
			.sort((a, b) => a.at - b.at)
			.map((e) => e.id);
		cmds.push(...reorderCommandsTo(currentOrder, targetOrder));
		cmds.push({
			type: "frame.set-layout",
			nodeId: frame.id,
			layout: defaultAutoLayout(dir),
		});
		frameIds.push(frame.id);
		events.push({
			type: "canvas.layout.created",
			direction: dir,
			source: "frame",
			childCount: frame.children.length,
		});
	}
	const first = cmds[0];
	if (!first) return [];
	if (cmds.length === 1) ctx.commit(first);
	else ctx.commitBatch(cmds, "Auto layout");
	for (const event of events) ctx.onLayoutEvent?.(event);
	return frameIds;
}

export function canWrapSelectionInAutoLayout(
	ir: CanvasIR,
	selectedIds: readonly string[],
): boolean {
	if (selectedIds.length < 2) return false;
	let parentId: string | undefined;
	for (const id of selectedIds) {
		const result = parentOf(ir, id);
		if (!result) return false;
		if (parentId === undefined) parentId = result.parent.id;
		else if (parentId !== result.parent.id) return false;
	}
	return true;
}

/**
 * Wrap a same-parent multi-selection in a new Auto Layout frame adopting the
 * selection's visual bounds (union of resolved footprints) and stable visual
 * order. Child geometry is rebased onto the frame's origin caller-side. The
 * runtime builds the frame's children in SIBLING order, so when that differs
 * from visual order the wrap and the fixing `node.reorder`s commit as one
 * batch — still one Undo entry. Returns the new frame id.
 */
export function wrapSelectionInAutoLayoutImpl(
	ctx: CanvasStudioContextValue,
): string | null {
	const ir = ctx.getIR();
	const selectedIds = ctx.selectionStore.getState().selectedIds;
	if (!canWrapSelectionInAutoLayout(ir, selectedIds)) return null;
	const view = viewOf(ctx);
	const entries = selectedIds.map((id) => {
		const found = findNode(ir, id);
		if (!found) throw new Error(`selection out of sync: ${id}`);
		const record = view?.getRecord(id);
		return {
			id,
			node: found.node,
			record,
			box: parentSpaceBox(found.node, record),
		};
	});
	const parentResult = parentOf(ir, selectedIds[0] as string);
	if (!parentResult) return null;
	const siblingIndex = new Map(
		parentResult.parent.children.map((c, i) => [c.id, i]),
	);

	const dir = inferDirection(entries.map((e) => e.box));
	const visual = [...entries].sort(
		(a, b) => centroid(a.box, dir) - centroid(b.box, dir),
	);
	const minX = Math.min(...entries.map((e) => e.box.minX));
	const minY = Math.min(...entries.map((e) => e.box.minY));
	const maxX = Math.max(...entries.map((e) => e.box.maxX));
	const maxY = Math.max(...entries.map((e) => e.box.maxY));

	const geometry: CanvasLayoutGeometryWrite[] = entries.map((e) => {
		const local = e.record?.geometry.localTransform ?? e.node.transform;
		return {
			nodeId: e.id,
			transform: { ...local, x: local.x - minX, y: local.y - minY },
		};
	});

	const frameId = generateFrameId();
	const wrap: CanvasCommand = {
		type: "selection.wrap-in-layout-frame",
		pageId: ctx.activePageId,
		childIds: visual.map((e) => e.id),
		frameId,
		transform: { x: minX, y: minY, rotation: 0, scaleX: 1, scaleY: 1 },
		bounds: { width: maxX - minX, height: maxY - minY },
		layout: defaultAutoLayout(dir),
		geometry,
	};

	// The runtime assembles frame children in sibling-index order.
	const postWrapOrder = [...selectedIds].sort(
		(a, b) => (siblingIndex.get(a) ?? 0) - (siblingIndex.get(b) ?? 0),
	);
	const reorders = reorderCommandsTo(
		postWrapOrder,
		visual.map((e) => e.id),
	);

	if (reorders.length === 0) ctx.commit(wrap);
	else ctx.commitBatch([wrap, ...reorders], "Auto layout");
	ctx.selectionStore.getState().setSelection([frameId]);
	ctx.onLayoutEvent?.({
		type: "canvas.layout.created",
		direction: dir,
		source: "selection",
		childCount: entries.length,
	});
	return frameId;
}

export function canRemoveAutoLayout(
	ir: CanvasIR,
	selectedIds: readonly string[],
): boolean {
	return selectedIds.some((id) => {
		const found = findNode(ir, id);
		return !!found && isLayoutFrame(found.node);
	});
}

/**
 * Remove Auto Layout from every selected layout frame, materializing the
 * current visual result: the frame's resolved bounds and every direct
 * child's resolved local transform/bounds are written in the command payload
 * so nothing moves, and child `layoutItem` intent is cleared. ONE history
 * entry. Returns the frame ids converted back.
 */
export function removeAutoLayoutFromSelectionImpl(
	ctx: CanvasStudioContextValue,
): string[] {
	const ir = ctx.getIR();
	const selectedIds = ctx.selectionStore.getState().selectedIds;
	const view = viewOf(ctx);
	const cmds: CanvasCommand[] = [];
	const frameIds: string[] = [];
	const events: CanvasLayoutEditorEvent[] = [];
	for (const id of selectedIds) {
		const found = findNode(ir, id);
		if (!found || !isLayoutFrame(found.node)) continue;
		const frame = found.node;
		const frameRecord = view?.getRecord(frame.id);
		const geometry: CanvasLayoutGeometryWrite[] = [];
		if (frameRecord) {
			geometry.push({
				nodeId: frame.id,
				transform: frameRecord.geometry.localTransform,
				bounds: frameRecord.geometry.bounds,
			});
		}
		for (const child of frame.children) {
			const record = view?.getRecord(child.id);
			const write: CanvasLayoutGeometryWrite = {
				nodeId: child.id,
				...(record
					? {
							transform: record.geometry.localTransform,
							bounds: record.geometry.bounds,
						}
					: {}),
				...(child.layoutItem ? { layoutItem: null } : {}),
			};
			if (write.transform || write.bounds || write.layoutItem !== undefined) {
				geometry.push(write);
			}
		}
		cmds.push({
			type: "frame.remove-layout",
			nodeId: frame.id,
			...(geometry.length > 0 ? { geometry } : {}),
		});
		frameIds.push(frame.id);
		// nestedDepth = this frame plus its Auto Layout ancestors.
		let nestedDepth = 1;
		let cursor = parentOf(ir, frame.id);
		while (cursor) {
			if (isLayoutFrame(cursor.parent)) nestedDepth += 1;
			cursor = parentOf(ir, cursor.parent.id);
		}
		events.push({
			type: "canvas.layout.removed",
			childCount: frame.children.length,
			nestedDepth,
		});
	}
	const first = cmds[0];
	if (!first) return [];
	if (cmds.length === 1) ctx.commit(first);
	else ctx.commitBatch(cmds, "Remove auto layout");
	for (const event of events) ctx.onLayoutEvent?.(event);
	return frameIds;
}
