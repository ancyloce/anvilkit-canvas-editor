"use client";

import type { CanvasCommand, CanvasIR } from "@anvilkit/canvas-core";
import type Konva from "konva";
import { createContext, use } from "react";
import type { BrandKit } from "../brand/brand-kit.js";
import type { AiJobStoreApi } from "../stores/ai-job-store.js";
import type { CropStoreApi } from "../stores/crop-store.js";
import type { DraftStoreApi } from "../stores/draft-store.js";
import type { EditingStoreApi } from "../stores/editing-store.js";
import type { GuidesStoreApi } from "../stores/guides-store.js";
import type { HistoryStoreApi } from "../stores/history-store.js";
import type { PagesStoreApi } from "../stores/pages-store.js";
import type { PathEditStoreApi } from "../stores/path-edit-store.js";
import type { PenStoreApi } from "../stores/pen-store.js";
import type { SceneStoreApi } from "../stores/scene-store.js";
import type { SelectionStoreApi } from "../stores/selection-store.js";
import type { ToolStoreApi } from "../stores/tool-store.js";
import type { ViewportStoreApi } from "../stores/viewport-store.js";
import type { AiToolIntent } from "../tools/ai-intent.js";

export type CanvasIRGetter = () => CanvasIR;

/**
 * i18n resolver (P7). `key` is a `canvas.*` message id; `fallback` is the
 * inline English default. Returns the host-injected translation when present,
 * else the fallback, else the key. canvas-editor stays standalone (no
 * `@anvilkit/core` dep) — the host (e.g. plugin-canvas-studio) injects a
 * locale-selected catalog via `<CanvasWorkspace messages>`.
 */
export type CanvasT = (key: string, fallback?: string) => string;

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
	 * Owns the live {@link CanvasIR} scene. Optional in the context (like
	 * {@link aiJobStore}) so partial test contexts need not construct it;
	 * `<CanvasStudio>` always provides it. The Yjs collab prototype (I3-1)
	 * binds this store to a `Y.Doc`. Prefer {@link getIR}/{@link commit}/{@link ir}
	 * for normal reads and mutations — `sceneStore` is the collab seam.
	 */
	sceneStore?: SceneStoreApi;
	/**
	 * Transient registry of in-flight AI jobs backing `ai-placeholder` nodes
	 * (I1-10). The host registers an abort handle when it starts a job; the
	 * placeholder's on-canvas Cancel button calls `aiJobStore.cancel(jobId)`.
	 * Always provided by `<CanvasStudio>`; optional (like {@link requestAiIntent})
	 * so partial test contexts for non-AI components need not construct it.
	 */
	aiJobStore?: AiJobStoreApi;
	/**
	 * Drives the interactive image-crop editor (I3-2). Optional (like
	 * {@link aiJobStore}) so partial test contexts need not construct it;
	 * `<CanvasStudio>` always provides it.
	 */
	cropStore?: CropStoreApi;
	/**
	 * Multi-click pen-path state (I3-2). Optional (like {@link cropStore}) so
	 * partial test contexts need not construct it; `<CanvasStudio>` always
	 * provides it. The `path` tool and `PenToolOverlay` read it.
	 */
	penStore?: PenStoreApi;
	/**
	 * On-stage path point-editing mode (I3-2). Optional (like {@link cropStore})
	 * so partial test contexts need not construct it; `<CanvasStudio>` always
	 * provides it. The `PathEditOverlay` reads it.
	 */
	pathEditStore?: PathEditStoreApi;
	getIR: CanvasIRGetter;
	commit: (cmd: CanvasCommand) => CanvasIR;
	pickAsset: () => Promise<string>;
	/**
	 * Hand an AI gesture to the host (I1-7). Optional — present only when the
	 * editor is mounted with an AI host. See {@link AiToolIntent}.
	 */
	requestAiIntent?: (intent: AiToolIntent) => void;
	/**
	 * Shared brand colors + fonts sourced from the host's Studio config
	 * (I3-4). Optional — absent when the host configures no brand kit.
	 * Prefer reading it via {@link useBrandKit}, which normalizes the
	 * absent case to an empty kit.
	 */
	brandKit?: BrandKit;
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
	/**
	 * i18n resolver (P7). Optional — `<CanvasStudio>` provides one backed by
	 * its `messages` prop; absent in partial test contexts. Read it via
	 * {@link useCanvasT}, which falls back to the inline English default so
	 * callers always get a string.
	 */
	t?: CanvasT;
}

export const CanvasStudioContext =
	createContext<CanvasStudioContextValue | null>(null);

export function useCanvasStudio(): CanvasStudioContextValue {
	const ctx = use(CanvasStudioContext);
	if (!ctx) {
		throw new Error(
			"useCanvasStudio must be called inside a <CanvasStudio> tree.",
		);
	}
	return ctx;
}

/** Inline-English fallback resolver used when no catalog/`t` is provided. */
const DEFAULT_CANVAS_T: CanvasT = (key, fallback) => fallback ?? key;

/**
 * Resolve `canvas.*` chrome strings. Null-tolerant: when there is no
 * `<CanvasStudio>` ancestor (or it provides no `t`), returns
 * {@link DEFAULT_CANVAS_T} so the inline English fallback always renders.
 */
export function useCanvasT(): CanvasT {
	const ctx = use(CanvasStudioContext);
	return ctx?.t ?? DEFAULT_CANVAS_T;
}
