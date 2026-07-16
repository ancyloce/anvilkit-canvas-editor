import {
	type CanvasIR,
	type CanvasNodeApplyStyleCommand,
	createCanvasIR,
	createGroup,
	createImage,
	createPage,
	createRect,
} from "@anvilkit/canvas-core";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { CanvasToaster } from "@/context/toast-context.js";
import { internalClipboardStore } from "@/stores/clipboard-store.js";
import { makeHarness } from "@/tools/__tests__/_tool-test-helpers.js";
import {
	copyStyleImpl,
	hasCopiedStyle,
	pasteStyleImpl,
} from "../style-actions.js";

const FIXED_TS = "2026-05-20T00:00:00.000Z";

function fixtureIR(): CanvasIR {
	const page = createPage({ id: "p1" });
	page.root = createGroup({
		id: "p1-root",
		bounds: page.root.bounds,
		children: [
			{
				...createRect({
					id: "styled",
					bounds: { width: 10, height: 10 },
					fill: "#ff0000",
				}),
				opacity: 0.5,
			},
			createRect({ id: "plain", bounds: { width: 10, height: 10 } }),
			{
				...createRect({ id: "locked", bounds: { width: 10, height: 10 } }),
				locked: true,
			},
			createImage({
				id: "img",
				assetId: "a1",
				bounds: { width: 10, height: 10 },
			}),
		],
	});
	return createCanvasIR({ id: "ir", pages: [page], now: () => FIXED_TS });
}

function makeToaster(): CanvasToaster & { titles: string[] } {
	const titles: string[] = [];
	return {
		titles,
		add(input) {
			titles.push(input.title);
		},
	};
}

afterEach(() => {
	internalClipboardStore.getState().setStyle(null);
	vi.restoreAllMocks();
});

describe("copy/paste style actions (C-05, FR-120/121)", () => {
	it("copyStyle captures the primary node's style into the internal clipboard", () => {
		const h = makeHarness({ ir: fixtureIR() });
		h.studioCtx.selectionStore.getState().setSelection(["styled"]);
		expect(hasCopiedStyle()).toBe(false);
		expect(copyStyleImpl(h.studioCtx)).toBe(true);
		expect(hasCopiedStyle()).toBe(true);
		expect(internalClipboardStore.getState().style).toMatchObject({
			fill: "#ff0000",
			opacity: 0.5,
		});
	});

	it("copyStyle with no selection is a no-op returning false", () => {
		const h = makeHarness({ ir: fixtureIR() });
		expect(copyStyleImpl(h.studioCtx)).toBe(false);
		expect(hasCopiedStyle()).toBe(false);
	});

	it("pasteStyle applies to every unlocked selected node as ONE batch", () => {
		const h = makeHarness({ ir: fixtureIR() });
		h.studioCtx.selectionStore.getState().setSelection(["styled"]);
		copyStyleImpl(h.studioCtx);
		const toaster = makeToaster();
		h.studioCtx.selectionStore
			.getState()
			.setSelection(["plain", "locked", "img"]);
		const styled = pasteStyleImpl(h.studioCtx, toaster);
		// locked skipped; plain + img styled (img takes base keys only).
		expect(styled).toEqual(["plain", "img"]);
		expect(h.studioCtx.commitBatch).toHaveBeenCalledTimes(1);
		const cmds = h.commits as CanvasNodeApplyStyleCommand[];
		expect(cmds.map((c) => c.type)).toEqual([
			"node.applyStyle",
			"node.applyStyle",
		]);
		// Locked toast + ignored-fields toast (fill is incompatible with image).
		expect(toaster.titles).toHaveLength(2);
	});

	it("pasteStyle with an empty style clipboard is a silent no-op", () => {
		const h = makeHarness({ ir: fixtureIR() });
		h.studioCtx.selectionStore.getState().setSelection(["plain"]);
		expect(pasteStyleImpl(h.studioCtx)).toEqual([]);
		expect(h.commits).toHaveLength(0);
	});

	it("single-target paste commits singly (no batch wrapper)", () => {
		const h = makeHarness({ ir: fixtureIR() });
		h.studioCtx.selectionStore.getState().setSelection(["styled"]);
		copyStyleImpl(h.studioCtx);
		h.studioCtx.selectionStore.getState().setSelection(["plain"]);
		pasteStyleImpl(h.studioCtx);
		expect(h.studioCtx.commit).toHaveBeenCalledTimes(1);
		expect(h.studioCtx.commitBatch).not.toHaveBeenCalled();
	});
});
