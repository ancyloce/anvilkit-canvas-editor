import {
	type CanvasClipboardPayload,
	type CanvasIR,
	type CanvasNodeCreateCommand,
	createCanvasIR,
	createGroup,
	createImage,
	createPage,
	createRect,
} from "@anvilkit/canvas-core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CanvasToastInput } from "@/context/toast-context.js";
import { internalClipboardStore } from "@/stores/clipboard-store.js";
import { makeHarness } from "@/tools/__tests__/_tool-test-helpers.js";
import {
	copySelectionImpl,
	cutSelectionImpl,
	duplicateSelectionImpl,
	PASTE_OFFSET,
	pasteImpl,
	resetSystemClipboardNoticeForTests,
} from "../clipboard-actions.js";
import { createCanvasEditorActions } from "../editor-actions.js";

const FIXED_TS = "2026-05-20T00:00:00.000Z";

/**
 * p1 root children: rect `a` @x0, group `g` (child rect `gc`), rect `b` @x80.
 * Second page p2 for cross-page paste.
 */
function fixtureIR(): CanvasIR {
	const p1 = createPage({ id: "p1" });
	p1.root = createGroup({
		id: "p1-root",
		bounds: p1.root.bounds,
		children: [
			createRect({
				id: "a",
				transform: { x: 0 },
				bounds: { width: 50, height: 50 },
			}),
			createGroup({
				id: "g",
				children: [createRect({ id: "gc", bounds: { width: 10, height: 10 } })],
			}),
			createRect({
				id: "b",
				transform: { x: 80 },
				bounds: { width: 50, height: 50 },
			}),
		],
	});
	const p2 = createPage({ id: "p2" });
	return createCanvasIR({ id: "doc-1", pages: [p1, p2], now: () => FIXED_TS });
}

function setup() {
	const h = makeHarness({ ir: fixtureIR() });
	const toasts: CanvasToastInput[] = [];
	const actions = createCanvasEditorActions(h.studioCtx, {
		toaster: { add: (input) => toasts.push(input) },
	});
	return { h, actions, toasts };
}

beforeEach(() => {
	internalClipboardStore.getState().setPayload(null);
	resetSystemClipboardNoticeForTests();
});

afterEach(() => {
	vi.unstubAllGlobals();
});

describe("copySelectionImpl", () => {
	it("copies top-level subtrees only (selected descendants fold into ancestors)", async () => {
		const { h } = setup();
		h.studioCtx.selectionStore.getState().setSelection(["g", "gc", "a"]);
		const count = await copySelectionImpl(h.studioCtx);
		expect(count).toBe(2); // g (containing gc) + a
		const payload = internalClipboardStore.getState().payload;
		expect(payload?.nodes.map((n) => n.id)).toEqual(["g", "a"]);
		expect(payload?.sourceDocumentId).toBe("doc-1");
	});

	it("copy of nothing is a zero no-op", async () => {
		const { h } = setup();
		expect(await copySelectionImpl(h.studioCtx)).toBe(0);
		expect(internalClipboardStore.getState().payload).toBeNull();
	});
});

describe("pasteImpl", () => {
	it("copy → paste round-trips via the internal fallback with fresh ids, offset, and selection", async () => {
		const { h } = setup();
		h.studioCtx.selectionStore.getState().setSelection(["a", "g"]);
		await copySelectionImpl(h.studioCtx);
		const newIds = await pasteImpl(h.studioCtx);
		expect(h.studioCtx.commitBatch).toHaveBeenCalledTimes(1);
		const creates = h.commits.filter(
			(c): c is CanvasNodeCreateCommand => c.type === "node.create",
		);
		expect(creates).toHaveLength(2);
		for (const cmd of creates) {
			expect(["a", "g"]).not.toContain(cmd.node.id);
			expect(cmd.pageId).toBe("p1");
		}
		const pastedA = creates[0]?.node;
		expect(pastedA?.transform.x).toBe(0 + PASTE_OFFSET);
		expect(h.studioCtx.selectionStore.getState().selectedIds).toEqual(newIds);
	});

	it("pastes into the ACTIVE page (cross-page paste)", async () => {
		const { h } = setup();
		h.studioCtx.selectionStore.getState().setSelection(["a"]);
		await copySelectionImpl(h.studioCtx);
		h.studioCtx.pagesStore.getState().setActivePageId("p2");
		await pasteImpl(h.studioCtx);
		const create = h.commits[0] as CanvasNodeCreateCommand;
		expect(create.pageId).toBe("p2");
	});

	it("with nothing to paste: no commit, info toast", async () => {
		const { h, toasts } = setup();
		const result = await pasteImpl(h.studioCtx, {
			add: (input) => toasts.push(input),
		});
		expect(result).toEqual([]);
		expect(h.commits).toHaveLength(0);
		expect(toasts[0]?.type).toBe("info");
	});

	it("prefers a valid AnvilKit payload from the system clipboard and adds its assets", async () => {
		const { h } = setup();
		const foreign: CanvasClipboardPayload = {
			version: 1,
			sourceDocumentId: "doc-OTHER",
			nodes: [
				createImage({
					id: "img",
					assetId: "asset-x",
					bounds: { width: 10, height: 10 },
				}),
			],
			assetRefs: { "asset-x": { id: "asset-x", uri: "https://x/a.png" } },
			bounds: { x: 0, y: 0, width: 10, height: 10 },
		};
		vi.stubGlobal("navigator", {
			clipboard: {
				readText: async () => JSON.stringify(foreign),
				writeText: async () => undefined,
			},
		});
		await pasteImpl(h.studioCtx);
		expect(h.commits.map((c) => c.type)).toEqual(["asset.put", "node.create"]);
	});

	it("foreign (non-AnvilKit) system text falls back to the internal store", async () => {
		const { h } = setup();
		h.studioCtx.selectionStore.getState().setSelection(["a"]);
		await copySelectionImpl(h.studioCtx);
		vi.stubGlobal("navigator", {
			clipboard: { readText: async () => "hello plain text" },
		});
		const newIds = await pasteImpl(h.studioCtx);
		expect(newIds).toHaveLength(1);
		expect(h.commits.some((c) => c.type === "node.create")).toBe(true);
	});

	it("an unsupported-version AnvilKit payload surfaces an error toast and does NOT paste stale internal content (AC-002)", async () => {
		const { h, toasts } = setup();
		// Prime the internal store with a valid payload.
		h.studioCtx.selectionStore.getState().setSelection(["a"]);
		await copySelectionImpl(h.studioCtx);
		// The system clipboard holds a decodable AnvilKit payload with a bad
		// version → core rejects with a typed non-invalid-json error.
		vi.stubGlobal("navigator", {
			clipboard: {
				readText: async () => JSON.stringify({ version: 999, nodes: [] }),
			},
		});
		const result = await pasteImpl(h.studioCtx, {
			add: (input) => toasts.push(input),
		});
		expect(result).toEqual([]);
		expect(h.commits).toHaveLength(0);
		expect(toasts.some((t) => t.type === "error")).toBe(true);
	});
});

describe("cutSelectionImpl", () => {
	it("copies, then deletes as ONE batch", async () => {
		const { h, actions } = setup();
		h.studioCtx.selectionStore.getState().setSelection(["a", "b"]);
		const deleted = await actions.cutSelection();
		expect(deleted).toEqual(["a", "b"]);
		expect(internalClipboardStore.getState().payload?.nodes).toHaveLength(2);
		expect(h.studioCtx.commitBatch).toHaveBeenCalledTimes(1);
		expect(h.commits.every((c) => c.type === "node.delete")).toBe(true);
	});

	it("cut of nothing commits nothing", async () => {
		const { h } = setup();
		const deleted = await cutSelectionImpl(h.studioCtx, () => {
			throw new Error("delete must not run for an empty copy");
		});
		expect(deleted).toEqual([]);
		expect(h.commits).toHaveLength(0);
	});
});

describe("duplicateSelectionImpl", () => {
	it("inserts the duplicate NEXT TO the original with fresh ids and offset", () => {
		const { h } = setup();
		h.studioCtx.selectionStore.getState().setSelection(["a"]);
		const newIds = duplicateSelectionImpl(h.studioCtx);
		expect(newIds).toHaveLength(1);
		const cmd = h.commits[0] as CanvasNodeCreateCommand;
		expect(cmd.type).toBe("node.create");
		expect(cmd.parentId).toBe("p1-root");
		expect(cmd.index).toBe(1); // a is at index 0 → duplicate at 1
		expect(cmd.node.id).not.toBe("a");
		expect(cmd.node.transform.x).toBe(0 + PASTE_OFFSET);
		expect(h.studioCtx.selectionStore.getState().selectedIds).toEqual(newIds);
	});

	it("duplicates a whole subtree with regenerated child ids", () => {
		const { h } = setup();
		h.studioCtx.selectionStore.getState().setSelection(["g"]);
		duplicateSelectionImpl(h.studioCtx);
		const cmd = h.commits[0] as CanvasNodeCreateCommand;
		const group = cmd.node as { children: { id: string }[] };
		expect(cmd.node.id).not.toBe("g");
		expect(group.children[0]?.id).not.toBe("gc");
	});
});

describe("system clipboard unavailable notice (FR-170)", () => {
	// jsdom ships no `navigator.clipboard` implementation, so every copy/paste
	// in these tests genuinely fails the system round-trip unless a test
	// stubs `navigator` itself — exactly the "unavailable" case this notice
	// covers.
	it("fires a one-time info toast the first time the system clipboard write fails", async () => {
		const { h, toasts } = setup();
		h.studioCtx.selectionStore.getState().setSelection(["a"]);
		await copySelectionImpl(h.studioCtx, {
			add: (input) => toasts.push(input),
		});
		expect(toasts).toHaveLength(1);
		expect(toasts[0]?.type).toBe("info");
		expect(toasts[0]?.title).toContain("built-in clipboard");
	});

	it("does not repeat the notice on a second failed copy in the same session", async () => {
		const { h, toasts } = setup();
		h.studioCtx.selectionStore.getState().setSelection(["a"]);
		await copySelectionImpl(h.studioCtx, {
			add: (input) => toasts.push(input),
		});
		await copySelectionImpl(h.studioCtx, {
			add: (input) => toasts.push(input),
		});
		expect(
			toasts.filter((t) => t.title.includes("built-in clipboard")),
		).toHaveLength(1);
	});

	it("also covers a failed paste read (not just copy) within the same one-time budget", async () => {
		const { h, toasts } = setup();
		const result = await pasteImpl(h.studioCtx, {
			add: (input) => toasts.push(input),
		});
		expect(result).toEqual([]);
		expect(toasts.some((t) => t.title.includes("built-in clipboard"))).toBe(
			true,
		);
	});

	it("does not fire when the system clipboard IS available", async () => {
		const { h, toasts } = setup();
		vi.stubGlobal("navigator", {
			clipboard: {
				writeText: async () => undefined,
				readText: async () => "",
			},
		});
		h.studioCtx.selectionStore.getState().setSelection(["a"]);
		await copySelectionImpl(h.studioCtx, {
			add: (input) => toasts.push(input),
		});
		expect(toasts).toHaveLength(0);
	});

	it("does not fire on a paste that reads real (empty) system clipboard text", async () => {
		const { h, toasts } = setup();
		vi.stubGlobal("navigator", {
			clipboard: { readText: async () => "" },
		});
		await pasteImpl(h.studioCtx, { add: (input) => toasts.push(input) });
		expect(toasts.some((t) => t.title.includes("built-in clipboard"))).toBe(
			false,
		);
	});
});
