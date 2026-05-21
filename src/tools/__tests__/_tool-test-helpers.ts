import type { CanvasCommand, CanvasIR } from "@anvilkit/canvas-core";
import { createCanvasIR, createPage } from "@anvilkit/canvas-core";
import type Konva from "konva";
import { vi } from "vitest";
import { createDraftStore } from "../../stores/draft-store.js";
import { createEditingStore } from "../../stores/editing-store.js";
import { createGuidesStore } from "../../stores/guides-store.js";
import { createHistoryStore } from "../../stores/history-store.js";
import { createSelectionStore } from "../../stores/selection-store.js";
import { createToolStore } from "../../stores/tool-store.js";
import { createViewportStore } from "../../stores/viewport-store.js";
import type { ToolContext, ToolPointerEvent } from "../tool-types.js";

const FIXED_TS = "2026-05-20T00:00:00.000Z";

export function makeFakeStage(): Konva.Stage {
	const container = document.createElement("div");
	return {
		on: vi.fn(),
		off: vi.fn(),
		container: () => container,
		getPointerPosition: () => ({ x: 0, y: 0 }),
		getAbsoluteTransform: () => ({
			copy: () => ({
				invert: () => ({
					point: (p: { x: number; y: number }) => p,
				}),
			}),
		}),
	} as unknown as Konva.Stage;
}

export interface TestHarness {
	ctx: ToolContext;
	ir: CanvasIR;
	setIR: (next: CanvasIR) => void;
	commits: CanvasCommand[];
}

export function makeHarness(opts: { pageId?: string } = {}): TestHarness {
	const pageId = opts.pageId ?? "p1";
	let ir = createCanvasIR({
		id: "ir-1",
		pages: [createPage({ id: pageId })],
		now: () => FIXED_TS,
	});
	const commits: CanvasCommand[] = [];
	const ctx: ToolContext = {
		stage: makeFakeStage(),
		getIR: () => ir,
		commit: vi.fn((cmd: CanvasCommand) => {
			commits.push(cmd);
			return ir;
		}),
		selectionStore: createSelectionStore(),
		viewportStore: createViewportStore({ gridEnabled: false }),
		toolStore: createToolStore(),
		guidesStore: createGuidesStore(),
		draftStore: createDraftStore(),
		editingStore: createEditingStore(),
		pickAsset: vi.fn(() => Promise.resolve("asset-1")),
		activePageId: pageId,
	};
	return {
		ctx,
		ir,
		setIR(next) {
			ir = next;
		},
		commits,
	};
}

export function pointerEvent(
	x: number,
	y: number,
	opts: { shiftKey?: boolean; target?: Konva.Node } = {},
): ToolPointerEvent {
	return {
		evt: { shiftKey: opts.shiftKey ?? false } as unknown as PointerEvent,
		point: { x, y },
		screenPoint: { x, y },
		stage: makeFakeStage(),
		target: opts.target ?? ({} as unknown as Konva.Node),
		shiftKey: opts.shiftKey ?? false,
	};
}
