"use client";

import type { CanvasCommand, CanvasIR } from "@anvilkit/canvas-core";
import type Konva from "konva";
import { createContext, useContext } from "react";
import type { HistoryStoreApi } from "../stores/history-store.js";
import type { SelectionStoreApi } from "../stores/selection-store.js";
import type { ToolStoreApi } from "../stores/tool-store.js";
import type { ViewportStoreApi } from "../stores/viewport-store.js";

export type CanvasIRGetter = () => CanvasIR;

export interface CanvasStudioContextValue {
	historyStore: HistoryStoreApi;
	toolStore: ToolStoreApi;
	selectionStore: SelectionStoreApi;
	viewportStore: ViewportStoreApi;
	getIR: CanvasIRGetter;
	commit: (cmd: CanvasCommand) => CanvasIR;
	pickAsset: () => Promise<string>;
	/** Konva.Stage instance — null until <CanvasStage>'s onReady fires. */
	stage: Konva.Stage | null;
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
