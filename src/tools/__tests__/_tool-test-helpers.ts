import type { CanvasCommand, CanvasIR } from "@anvilkit/canvas-core";
import { createCanvasIR, createPage } from "@anvilkit/canvas-core";
import type Konva from "konva";
import { vi } from "vitest";
import type { CanvasStudioContextValue } from "@/context/canvas-studio-context.js";
import { createAiJobStore } from "@/stores/ai-job-store.js";
import { createCropStore } from "@/stores/crop-store.js";
import { createDraftStore } from "@/stores/draft-store.js";
import { createEditingStore } from "@/stores/editing-store.js";
import { createFieldPreviewStore } from "@/stores/field-preview-store.js";
import { createFocusStore } from "@/stores/focus-store.js";
import { createGuidesStore } from "@/stores/guides-store.js";
import { createHistoryStore } from "@/stores/history-store.js";
import { createPagesStore } from "@/stores/pages-store.js";
import { createPathEditStore } from "@/stores/path-edit-store.js";
import { createPenStore } from "@/stores/pen-store.js";
import { createSelectionStore } from "@/stores/selection-store.js";
import { createToolStore } from "@/stores/tool-store.js";
import { createViewportStore } from "@/stores/viewport-store.js";
import type { AiToolIntent } from "../ai-intent.js";
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
	/** Full <CanvasStudio> context shape — for tests of page-actions etc. */
	studioCtx: CanvasStudioContextValue;
	ir: CanvasIR;
	setIR: (next: CanvasIR) => void;
	commits: CanvasCommand[];
	/** AI intents emitted via `requestAiIntent` (I1-7 ai-image / ai-brush). */
	aiIntents: AiToolIntent[];
}

export interface MakeHarnessOptions {
	pageId?: string;
	/** Provide a custom IR (e.g. multi-page). Overrides the default 1-page IR. */
	ir?: CanvasIR;
}

export function makeHarness(opts: MakeHarnessOptions = {}): TestHarness {
	const pageId = opts.pageId ?? "p1";
	let ir =
		opts.ir ??
		createCanvasIR({
			id: "ir-1",
			pages: [createPage({ id: pageId })],
			now: () => FIXED_TS,
		});
	const commits: CanvasCommand[] = [];

	const historyStore = createHistoryStore();
	const selectionStore = createSelectionStore();
	const focusStore = createFocusStore();
	const viewportStore = createViewportStore({ gridEnabled: false });
	const toolStore = createToolStore();
	const guidesStore = createGuidesStore();
	const draftStore = createDraftStore();
	const editingStore = createEditingStore();
	const cropStore = createCropStore();
	const penStore = createPenStore();
	const pathEditStore = createPathEditStore();
	const fieldPreviewStore = createFieldPreviewStore();
	const aiJobStore = createAiJobStore();
	const pagesStore = createPagesStore({
		initialActivePageId: opts.ir ? (opts.ir.pages[0]?.id ?? pageId) : pageId,
	});

	const stage = makeFakeStage();
	const getIR = () => ir;
	// Record-only commit — does NOT apply the command via historyStore. Keeps
	// behavior compatible with tool tests that override `getIR` to return a
	// fixture IR whose nodes wouldn't exist in the harness's blank IR. Tests
	// that need post-commit state can call `historyStore.getState().commit(...)`
	// directly with their own IR.
	const commit = vi.fn((cmd: CanvasCommand) => {
		commits.push(cmd);
		return ir;
	});
	// Flatten batched sub-commands into `commits` so count/filter assertions stay
	// valid whether a gesture commits singly or as a batch.
	const commitBatch = vi.fn((cmds: readonly CanvasCommand[]) => {
		for (const c of cmds) commits.push(c);
		return ir;
	});
	// Record-only, like `commit` — coalescing behavior itself is history-store
	// tested; field tests only assert what was committed (B-12).
	const commitCoalesced = vi.fn((cmd: CanvasCommand, _mergeKey: string) => {
		commits.push(cmd);
		return ir;
	});
	const pickAsset = vi.fn(() => Promise.resolve("asset-1"));
	const aiIntents: AiToolIntent[] = [];
	const requestAiIntent = vi.fn((intent: AiToolIntent) => {
		aiIntents.push(intent);
	});

	const ctx: ToolContext = {
		stage,
		getIR,
		commit,
		commitBatch,
		selectionStore,
		focusStore,
		viewportStore,
		toolStore,
		guidesStore,
		draftStore,
		editingStore,
		penStore,
		pickAsset,
		activePageId: pagesStore.getState().activePageId,
		requestAiIntent,
	};

	const studioCtx: CanvasStudioContextValue = {
		historyStore,
		toolStore,
		selectionStore,
		focusStore,
		viewportStore,
		guidesStore,
		draftStore,
		editingStore,
		pagesStore,
		cropStore,
		penStore,
		pathEditStore,
		getIR,
		commit,
		commitCoalesced,
		commitBatch,
		fieldPreviewStore,
		pickAsset,
		aiJobStore,
		requestAiIntent,
		stage,
		// `activePageId` and `ir` are snapshots at harness creation. Live reads
		// flow through pagesStore + getIR; page-actions don't read these
		// fields directly.
		activePageId: pagesStore.getState().activePageId,
		ir,
	};

	return {
		ctx,
		studioCtx,
		ir,
		setIR(next) {
			ir = next;
		},
		commits,
		aiIntents,
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
