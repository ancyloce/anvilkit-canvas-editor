import {
	type CanvasCommand,
	type CanvasIR,
	createCanvasIR,
	createPage,
} from "@anvilkit/canvas-core";
import type { ReactNode } from "react";
import {
	CanvasStudioContext,
	type CanvasStudioContextValue,
} from "../../context/canvas-studio-context.js";
import { createAiJobStore } from "../../stores/ai-job-store.js";
import { createCropStore } from "../../stores/crop-store.js";
import { createDraftStore } from "../../stores/draft-store.js";
import { createEditingStore } from "../../stores/editing-store.js";
import { createGuidesStore } from "../../stores/guides-store.js";
import { createHistoryStore } from "../../stores/history-store.js";
import { createPagesStore } from "../../stores/pages-store.js";
import { createPathEditStore } from "../../stores/path-edit-store.js";
import { createPenStore } from "../../stores/pen-store.js";
import { createSceneStore } from "../../stores/scene-store.js";
import { createSelectionStore } from "../../stores/selection-store.js";
import { createToolStore } from "../../stores/tool-store.js";
import { createViewportStore } from "../../stores/viewport-store.js";

/**
 * Build a fully-wired {@link CanvasStudioContextValue} backed by real stores,
 * for unit-testing chrome components outside `<CanvasStudio>`. `commit` runs
 * through the history + scene stores like the real editor, so command dispatch
 * is observable. Pass `overrides` to swap in spies (e.g. a mocked `commit`).
 */
export function makeTestStudioContext(
	overrides: Partial<CanvasStudioContextValue> & { ir?: CanvasIR } = {},
): CanvasStudioContextValue {
	const { ir: irOverride, ...rest } = overrides;
	const ir =
		irOverride ??
		createCanvasIR({
			pages: [createPage({ id: "p1", name: "Page 1" })],
			now: () => "2026-01-01T00:00:00.000Z",
		});
	const sceneStore = createSceneStore({ initialIR: ir });
	const historyStore = createHistoryStore();
	const commit = (cmd: CanvasCommand): CanvasIR => {
		const next = historyStore.getState().commit(sceneStore.getState().ir, cmd);
		sceneStore.getState().setIR(next);
		return next;
	};
	return {
		historyStore,
		toolStore: createToolStore(),
		selectionStore: createSelectionStore(),
		viewportStore: createViewportStore(),
		guidesStore: createGuidesStore(),
		draftStore: createDraftStore(),
		editingStore: createEditingStore(),
		pagesStore: createPagesStore({
			initialActivePageId: ir.pages[0]?.id ?? "",
		}),
		sceneStore,
		aiJobStore: createAiJobStore(),
		cropStore: createCropStore(),
		penStore: createPenStore(),
		pathEditStore: createPathEditStore(),
		getIR: () => sceneStore.getState().ir,
		commit,
		pickAsset: async () => "test-asset",
		stage: null,
		activePageId: ir.pages[0]?.id ?? "",
		ir,
		...rest,
	};
}

export function TestStudioProvider({
	value,
	children,
}: {
	value?: CanvasStudioContextValue;
	children: ReactNode;
}): React.JSX.Element {
	return (
		<CanvasStudioContext.Provider value={value ?? makeTestStudioContext()}>
			{children}
		</CanvasStudioContext.Provider>
	);
}
