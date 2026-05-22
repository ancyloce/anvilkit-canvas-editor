"use client";

import type { CanvasCommand, CanvasIR } from "@anvilkit/canvas-core";
import type Konva from "konva";
import { createContext, useContext } from "react";
import type { AiJobStoreApi } from "../stores/ai-job-store.js";
import type { DraftStoreApi } from "../stores/draft-store.js";
import type { EditingStoreApi } from "../stores/editing-store.js";
import type { GuidesStoreApi } from "../stores/guides-store.js";
import type { HistoryStoreApi } from "../stores/history-store.js";
import type { PagesStoreApi } from "../stores/pages-store.js";
import type { SelectionStoreApi } from "../stores/selection-store.js";
import type { ToolStoreApi } from "../stores/tool-store.js";
import type { ViewportStoreApi } from "../stores/viewport-store.js";
import type { AiToolIntent } from "../tools/ai-intent.js";

export type CanvasIRGetter = () => CanvasIR;

export interface CanvasStudioContextValue {
	historyStore: HistoryStoreApi;
	toolStore: ToolStoreApi;
	selectionStore: SelectionStoreApi;
	viewportStore: ViewportStoreApi;
	guidesStore: GuidesStoreApi;
	draftStore: DraftStoreApi;
	editingStore: EditingStoreApi;
	pagesStore: PagesStoreApi;
	/**
	 * Transient registry of in-flight AI jobs backing `ai-placeholder` nodes
	 * (I1-10). The host registers an abort handle when it starts a job; the
	 * placeholder's on-canvas Cancel button calls `aiJobStore.cancel(jobId)`.
	 * Always provided by `<CanvasStudio>`; optional (like {@link requestAiIntent})
	 * so partial test contexts for non-AI components need not construct it.
	 */
	aiJobStore?: AiJobStoreApi;
	getIR: CanvasIRGetter;
	commit: (cmd: CanvasCommand) => CanvasIR;
	pickAsset: () => Promise<string>;
	/**
	 * Hand an AI gesture to the host (I1-7). Optional — present only when the
	 * editor is mounted with an AI host. See {@link AiToolIntent}.
	 */
	requestAiIntent?: (intent: AiToolIntent) => void;
	/** Konva.Stage instance — null until <CanvasStage>'s onReady fires. */
	stage: Konva.Stage | null;
	/**
	 * Live active page id — derived from `pagesStore` via `useSyncExternalStore`
	 * in `<CanvasStudio>`. Equivalent to `pagesStore.getState().activePageId`
	 * but reactive: consumers using `useCanvasStudio()` re-render when it changes.
	 */
	activePageId: string;
	/** Current IR. Reactive — context value changes on every commit. */
	ir: CanvasIR;
}

export const CanvasStudioContext =
	createContext<CanvasStudioContextValue | null>(null);

export function useCanvasStudio(): CanvasStudioContextValue {
	const ctx = useContext(CanvasStudioContext);
	if (!ctx) {
		throw new Error(
			"useCanvasStudio must be called inside a <CanvasStudio> tree.",
		);
	}
	return ctx;
}
