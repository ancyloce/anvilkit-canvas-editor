import {
	CANVAS_CLIPBOARD_VERSION,
	type CanvasAssetRef,
	type CanvasClipboardPayload,
	type CanvasCommand,
	type CanvasNode,
	findNode,
	isContainerNode,
	materializeClipboardNodes,
	parentOf,
	parseClipboardPayload,
	regenerateNodeIds,
} from "@anvilkit/canvas-core";
import type { CanvasStudioContextValue } from "../context/canvas-studio-context.js";
import {
	type CanvasToaster,
	NOOP_CANVAS_TOASTER,
} from "../context/toast-context.js";
import { internalClipboardStore } from "../stores/clipboard-store.js";
import {
	readSystemClipboard,
	writeSystemClipboard,
} from "./system-clipboard.js";

/**
 * @file Clipboard actions (A-05, PRD 0012 FR-020..023). Payload contract and
 * validation live in core (`clipboard/payload.ts`); this module owns the
 * BEHAVIOR: selection collection, system-clipboard round-trip with silent
 * fallback to the internal store, paste offsetting/selection, and the
 * single-undo-entry command batches.
 */

/** Pixels each paste/duplicate is offset from the source position. */
export const PASTE_OFFSET = 16;

function resolveT(ctx: CanvasStudioContextValue) {
	return ctx.t ?? ((_key: string, fallback?: string) => fallback ?? "");
}

/**
 * Top-level selected subtrees in selection order: page roots are excluded,
 * and a node whose ancestor is also selected is folded into that ancestor's
 * subtree (copying both would duplicate it on paste).
 */
function topLevelSelectedNodes(ctx: CanvasStudioContextValue): CanvasNode[] {
	const ir = ctx.getIR();
	const selectedIds = ctx.selectionStore.getState().selectedIds;
	const selected = new Set(selectedIds);
	const out: CanvasNode[] = [];
	for (const id of selectedIds) {
		const found = findNode(ir, id);
		if (!found) continue;
		let parentResult = parentOf(ir, id);
		if (!parentResult) continue; // page root
		let hasSelectedAncestor = false;
		while (parentResult) {
			if (selected.has(parentResult.parent.id)) {
				hasSelectedAncestor = true;
				break;
			}
			parentResult = parentOf(ir, parentResult.parent.id);
		}
		if (!hasSelectedAncestor) out.push(found.node);
	}
	return out;
}

function collectAssetRefs(
	ctx: CanvasStudioContextValue,
	roots: readonly CanvasNode[],
): Record<string, CanvasAssetRef> {
	const ir = ctx.getIR();
	const refs: Record<string, CanvasAssetRef> = {};
	const visit = (node: CanvasNode): void => {
		const record = node as unknown as Record<string, unknown>;
		for (const field of ["assetId", "maskAssetId"] as const) {
			const value = record[field];
			if (typeof value === "string") {
				const asset = ir.assets[value];
				if (asset) refs[value] = asset;
			}
		}
		if (isContainerNode(node)) {
			for (const child of node.children) visit(child);
		}
	};
	for (const root of roots) visit(root);
	return refs;
}

/** Combined AABB of the roots' transforms/bounds (rotation ignored). */
function combinedBounds(roots: readonly CanvasNode[]) {
	let minX = Number.POSITIVE_INFINITY;
	let minY = Number.POSITIVE_INFINITY;
	let maxX = Number.NEGATIVE_INFINITY;
	let maxY = Number.NEGATIVE_INFINITY;
	for (const node of roots) {
		const { x, y } = node.transform;
		minX = Math.min(minX, x);
		minY = Math.min(minY, y);
		maxX = Math.max(maxX, x + node.bounds.width);
		maxY = Math.max(maxY, y + node.bounds.height);
	}
	if (roots.length === 0) return { x: 0, y: 0, width: 0, height: 0 };
	return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

function buildClipboardPayload(
	ctx: CanvasStudioContextValue,
): CanvasClipboardPayload | null {
	const roots = topLevelSelectedNodes(ctx);
	if (roots.length === 0) return null;
	return {
		version: CANVAS_CLIPBOARD_VERSION,
		sourceDocumentId: ctx.getIR().id,
		sourcePageId: ctx.pagesStore.getState().activePageId,
		nodes: roots.map((n) => structuredClone(n)),
		assetRefs: collectAssetRefs(ctx, roots),
		bounds: combinedBounds(roots),
	};
}

/**
 * FR-020 copy: snapshot the selection into the internal clipboard and, when
 * available, the system clipboard (JSON text — AnvilKit editors in other
 * tabs recognize it via `parseClipboardPayload`). Locked nodes copy fine;
 * lock restricts mutation, not reading. Returns the copied root count.
 */
export async function copySelectionImpl(
	ctx: CanvasStudioContextValue,
): Promise<number> {
	const payload = buildClipboardPayload(ctx);
	if (!payload) return 0;
	internalClipboardStore.getState().setPayload(payload);
	await writeSystemClipboard(JSON.stringify(payload));
	return payload.nodes.length;
}

/**
 * FR-022 cut: copy, then delete — the delete is the only document mutation,
 * so cut is inherently one undo entry. Locked nodes are copied but survive
 * the delete (with the action layer's warning toast).
 */
export async function cutSelectionImpl(
	ctx: CanvasStudioContextValue,
	deleteSelection: () => string[],
): Promise<string[]> {
	const copied = await copySelectionImpl(ctx);
	if (copied === 0) return [];
	return deleteSelection();
}

/**
 * FR-021 paste: prefer a valid AnvilKit payload from the system clipboard
 * (cross-editor paste), else the internal store. Foreign/invalid system
 * content falls through silently; with nothing to paste, an info toast fires
 * and no command is committed. New ids via core materialization; pasted
 * roots are offset by {@link PASTE_OFFSET}, inserted into the ACTIVE page
 * (cross-page paste), committed as ONE batch (asset.put entries first so the
 * whole paste undoes in one step), and selected.
 */
export async function pasteImpl(
	ctx: CanvasStudioContextValue,
	toaster: CanvasToaster = NOOP_CANVAS_TOASTER,
): Promise<string[]> {
	let payload: CanvasClipboardPayload | null = null;
	const text = await readSystemClipboard();
	if (text) {
		try {
			payload = parseClipboardPayload(text);
		} catch {
			// Foreign or invalid clipboard content — not an error (§5 scope).
		}
	}
	if (!payload) payload = internalClipboardStore.getState().payload;
	if (!payload || payload.nodes.length === 0) {
		toaster.add({
			type: "info",
			title: resolveT(ctx)("canvas.toast.nothingToPaste", "Nothing to paste"),
		});
		return [];
	}

	const ir = ctx.getIR();
	const { nodes, assetsToAdd } = materializeClipboardNodes(payload, ir);
	for (const node of nodes) {
		node.transform.x += PASTE_OFFSET;
		node.transform.y += PASTE_OFFSET;
	}
	const activePageId = ctx.pagesStore.getState().activePageId;
	const cmds: CanvasCommand[] = [
		...Object.values(assetsToAdd).map(
			(asset): CanvasCommand => ({ type: "asset.put", asset }),
		),
		...nodes.map(
			(node): CanvasCommand => ({
				type: "node.create",
				node,
				pageId: activePageId,
			}),
		),
	];
	ctx.commitBatch(cmds, "Paste");
	const newIds = nodes.map((n) => n.id);
	ctx.selectionStore.getState().setSelection(newIds);
	return newIds;
}

/**
 * FR-023 duplicate: clone each top-level selected subtree with fresh ids,
 * offset it, and insert it NEXT TO the original in layer order (same parent,
 * original index + 1) — one undo entry, duplicates selected afterwards.
 */
export function duplicateSelectionImpl(
	ctx: CanvasStudioContextValue,
): string[] {
	const ir = ctx.getIR();
	const roots = topLevelSelectedNodes(ctx);
	if (roots.length === 0) return [];
	const cmds: CanvasCommand[] = [];
	const newIds: string[] = [];
	for (const original of roots) {
		const parentResult = parentOf(ir, original.id);
		if (!parentResult) continue;
		const found = findNode(ir, original.id);
		if (!found) continue;
		const index = parentResult.parent.children.findIndex(
			(c) => c.id === original.id,
		);
		const { node } = regenerateNodeIds(original);
		node.transform.x += PASTE_OFFSET;
		node.transform.y += PASTE_OFFSET;
		newIds.push(node.id);
		cmds.push({
			type: "node.create",
			node,
			pageId: found.page.id,
			parentId: parentResult.parent.id,
			index: index + 1,
		});
	}
	if (cmds.length === 0) return [];
	ctx.commitBatch(cmds, "Duplicate");
	ctx.selectionStore.getState().setSelection(newIds);
	return newIds;
}
