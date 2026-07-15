import {
	type CanvasIR,
	createCanvasIR,
	createGroup,
	createPage,
	createRect,
	walk,
} from "@anvilkit/canvas-core";
import { beforeEach, describe, expect, it } from "vitest";
import type { CanvasStudioContextValue } from "@/context/canvas-studio-context.js";
import { internalClipboardStore } from "@/stores/clipboard-store.js";
import { makeHarness } from "@/tools/__tests__/_tool-test-helpers.js";
import { groupSelection } from "../../selection/group-actions.js";
import { copySelectionImpl, pasteImpl } from "../clipboard-actions.js";

const FIXED_TS = "2026-05-20T00:00:00.000Z";

/**
 * PRD 0012 §17.4 Flow 3 (A-12): create a group → copy → switch pages →
 * paste → verify id uniqueness → undo → redo, against the REAL history
 * store (commands actually apply; undo/redo replay inverses).
 */
function fixtureIR(): CanvasIR {
	const p1 = createPage({ id: "p1" });
	p1.root = createGroup({
		id: "p1-root",
		bounds: p1.root.bounds,
		children: [
			createRect({ id: "a", bounds: { width: 10, height: 10 } }),
			createRect({ id: "b", bounds: { width: 10, height: 10 } }),
		],
	});
	const p2 = createPage({ id: "p2" });
	return createCanvasIR({ id: "doc-1", pages: [p1, p2], now: () => FIXED_TS });
}

/** Harness whose commit/commitBatch APPLY through the real history store. */
function liveSetup() {
	const h = makeHarness({ ir: fixtureIR() });
	const history = h.studioCtx.historyStore;
	const applyCommit: CanvasStudioContextValue["commit"] = (cmd) => {
		const next = history.getState().commit(h.studioCtx.getIR(), cmd);
		h.setIR(next);
		return next;
	};
	const applyBatch: CanvasStudioContextValue["commitBatch"] = (cmds, label) => {
		const next = history
			.getState()
			.commitBatch(h.studioCtx.getIR(), cmds, label);
		h.setIR(next);
		return next;
	};
	h.studioCtx.commit = applyCommit;
	h.studioCtx.commitBatch = applyBatch;
	return h;
}

function allNodeIds(ir: CanvasIR): string[] {
	const ids: string[] = [];
	walk(ir, ({ node }) => ids.push(node.id));
	return ids;
}

function pageChildCount(ir: CanvasIR, pageId: string): number {
	return ir.pages.find((p) => p.id === pageId)?.root.children.length ?? 0;
}

beforeEach(() => {
	internalClipboardStore.getState().setPayload(null);
});

describe("Flow 3 — clipboard integration over the real history store", () => {
	it("group → copy → cross-page paste → unique ids → undo → redo", async () => {
		const h = liveSetup();
		const s = h.studioCtx;

		// 1. Create a group from a + b.
		s.selectionStore.getState().setSelection(["a", "b"]);
		const groupId = groupSelection(s);
		expect(groupId).not.toBeNull();
		expect(pageChildCount(s.getIR(), "p1")).toBe(1);

		// 2-4. Copy it, switch pages, paste it.
		s.selectionStore.getState().setSelection([groupId as string]);
		await copySelectionImpl(s);
		s.pagesStore.getState().setActivePageId("p2");
		const pastedIds = await pasteImpl(s);
		expect(pastedIds).toHaveLength(1);
		expect(pageChildCount(s.getIR(), "p2")).toBe(1);

		// 5. Every id in the document is unique; no original id was reused.
		const ids = allNodeIds(s.getIR());
		expect(new Set(ids).size).toBe(ids.length);
		expect(pastedIds[0]).not.toBe(groupId);

		// 6. Undo removes the pasted subtree (ONE history entry for the batch).
		const undone = s.historyStore.getState().undo(s.getIR());
		h.setIR(undone);
		expect(pageChildCount(s.getIR(), "p2")).toBe(0);
		expect(pageChildCount(s.getIR(), "p1")).toBe(1);

		// 7. Redo restores it, ids intact.
		const redone = s.historyStore.getState().redo(s.getIR());
		h.setIR(redone);
		expect(pageChildCount(s.getIR(), "p2")).toBe(1);
		const idsAfterRedo = allNodeIds(s.getIR());
		expect(new Set(idsAfterRedo).size).toBe(idsAfterRedo.length);
	});
});
