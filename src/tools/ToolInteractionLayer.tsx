"use client";

import type Konva from "konva";
import { useEffect, useMemo } from "react";
import { useCanvasStudio } from "../context/canvas-studio-context.js";
import { getStagePointer } from "./get-stage-pointer.js";
import { shouldReturnToSelect } from "./tool-completion.js";
import { defaultToolRegistry } from "./tool-registry.js";
import type { Tool, ToolContext, ToolRegistry } from "./tool-types.js";

export interface ToolInteractionLayerProps {
	/** Optional override (mainly for tests). Defaults to `defaultToolRegistry`. */
	registry?: ToolRegistry;
}

/**
 * Bridges Konva.Stage pointer events to the active tool from `toolStore`.
 * Renders no DOM — pure side-effect component. Mounts as a sibling of
 * `<CanvasStage>` inside the CanvasStudioContext so unmount order detaches
 * listeners before `<CanvasStage>` calls `stage.destroy()`.
 */
export function ToolInteractionLayer({
	registry = defaultToolRegistry,
}: ToolInteractionLayerProps): null {
	const {
		stage,
		getIR,
		commit,
		commitBatch,
		continuousCreation,
		selectionStore,
		focusStore,
		viewportStore,
		toolStore,
		guidesStore,
		draftStore,
		editingStore,
		penStore,
		pickAsset,
		pickAssets,
		activePageId,
		requestAiIntent,
		isolationStore,
	} = useCanvasStudio();

	const ctx = useMemo<ToolContext | null>(() => {
		if (!stage || !penStore) return null;
		// FR-012 (A-10): creation tools return to Select after committing their
		// element (unless the host opts into continuous creation). Wrapping THE
		// tool-facing commit seam keeps every tool's own code untouched.
		const completeCreation = (
			cmds: readonly Parameters<typeof commit>[0][],
		): void => {
			if (
				shouldReturnToSelect(
					cmds,
					toolStore.getState().activeTool,
					continuousCreation === true,
				)
			) {
				toolStore.getState().setActiveTool("select");
			}
		};
		const commitWithCompletion: typeof commit = (cmd) => {
			const ir = commit(cmd);
			completeCreation([cmd]);
			return ir;
		};
		const commitBatchWithCompletion: typeof commitBatch = (cmds, label) => {
			const ir = commitBatch(cmds, label);
			completeCreation(cmds as Parameters<typeof commit>[0][]);
			return ir;
		};
		return {
			stage,
			getIR,
			commit: commitWithCompletion,
			commitBatch: commitBatchWithCompletion,
			selectionStore,
			focusStore,
			viewportStore,
			toolStore,
			guidesStore,
			draftStore,
			editingStore,
			penStore,
			pickAsset,
			activePageId,
			requestAiIntent,
			...(isolationStore ? { isolationStore } : {}),
			...(pickAssets ? { pickAssets } : {}),
		};
	}, [
		stage,
		getIR,
		commit,
		selectionStore,
		viewportStore,
		toolStore,
		guidesStore,
		draftStore,
		editingStore,
		penStore,
		pickAsset,
		pickAssets,
		activePageId,
		requestAiIntent,
		isolationStore,
		continuousCreation,
	]);

	// Wire pointer dispatch.
	useEffect(() => {
		if (!stage || !ctx) return;
		const dispatch = (
			phase: "down" | "move" | "up",
			evt: PointerEvent,
			target: Konva.Node,
		) => {
			const activeId = toolStore.getState().activeTool;
			const tool = registry[activeId];
			if (!tool) return;
			const hook =
				phase === "down"
					? tool.onPointerDown
					: phase === "move"
						? tool.onPointerMove
						: tool.onPointerUp;
			if (!hook) return;
			const ptr = getStagePointer(stage);
			if (!ptr) return;
			const shiftKey = "shiftKey" in evt ? Boolean(evt.shiftKey) : false;
			hook(
				{
					evt,
					point: ptr.world,
					screenPoint: ptr.screen,
					stage,
					target,
					shiftKey,
				},
				ctx,
			);
		};

		// Coalesce pointermove to one dispatch per animation frame. Each move
		// drives `draftStore`/`guidesStore` writes whose `useSyncExternalStore`
		// subscribers (DraftRenderer, SmartGuideOverlay) re-render synchronously;
		// high-Hz pointers (and coalesced native moves) fire far above the display
		// rate, so an unthrottled drag schedules hundreds of synchronous store
		// updates that React batches into one transition — tripping React 19's
		// "large number of updates inside startTransition" warning. Reading the
		// live pointer inside the rAF keeps the geometry current; dropped
		// intermediate frames are invisible at ≥60Hz.
		let moveRaf = 0;
		let pendingMove: Konva.KonvaEventObject<PointerEvent> | null = null;
		const hasRaf =
			typeof requestAnimationFrame === "function" &&
			typeof cancelAnimationFrame === "function";
		const runPendingMove = () => {
			moveRaf = 0;
			const kEvt = pendingMove;
			pendingMove = null;
			if (kEvt) dispatch("move", kEvt.evt, kEvt.target);
		};
		// Apply the final queued move synchronously before a down/up so the
		// gesture's last geometry lands before the commit reads the live pointer.
		const flushPendingMove = () => {
			if (moveRaf && hasRaf) cancelAnimationFrame(moveRaf);
			runPendingMove();
		};

		// Konva's stage listeners are bound to the CONTAINER element, so a
		// gesture that started inside the stage and is released outside it
		// (over a sidebar, or outside the browser window entirely) never fires
		// a Konva pointerup — the tool's "down" state (a move/marquee draft)
		// is stuck forever (E-5). `window` is the one target every pointer
		// event bubbles to regardless of which DOM subtree it originated in,
		// so a fallback bound there always fires; `onUp` below removes it
		// first when the release lands INSIDE the stage (its bubble-phase
		// listener on the container runs before window's), so a normal
		// gesture never double-dispatches "up".
		let lastDownTarget: Konva.Node | null = null;
		const removeWindowFallback = () => {
			window.removeEventListener("pointerup", onWindowUp);
			window.removeEventListener("pointercancel", onWindowUp);
		};
		const onWindowUp = (evt: PointerEvent) => {
			removeWindowFallback();
			flushPendingMove();
			if (lastDownTarget) dispatch("up", evt, lastDownTarget);
		};

		const onDown = (kEvt: Konva.KonvaEventObject<PointerEvent>) => {
			flushPendingMove();
			lastDownTarget = kEvt.target;
			dispatch("down", kEvt.evt, kEvt.target);
			window.addEventListener("pointerup", onWindowUp);
			window.addEventListener("pointercancel", onWindowUp);
		};
		const onMove = (kEvt: Konva.KonvaEventObject<PointerEvent>) => {
			pendingMove = kEvt;
			if (!hasRaf) {
				runPendingMove();
				return;
			}
			if (!moveRaf) moveRaf = requestAnimationFrame(runPendingMove);
		};
		const onUp = (kEvt: Konva.KonvaEventObject<PointerEvent>) => {
			removeWindowFallback();
			flushPendingMove();
			dispatch("up", kEvt.evt, kEvt.target);
		};
		stage.on("pointerdown", onDown);
		stage.on("pointermove", onMove);
		stage.on("pointerup", onUp);
		return () => {
			if (moveRaf && hasRaf) cancelAnimationFrame(moveRaf);
			pendingMove = null;
			removeWindowFallback();
			stage.off("pointerdown", onDown);
			stage.off("pointermove", onMove);
			stage.off("pointerup", onUp);
		};
	}, [stage, ctx, registry, toolStore]);

	// Activate / deactivate hooks + cursor.
	useEffect(() => {
		if (!stage || !ctx) return;
		let current: Tool | null = null;
		const sync = () => {
			const next = registry[toolStore.getState().activeTool] ?? null;
			if (next === current) return;
			current?.onDeactivate?.(ctx);
			current = next;
			next?.onActivate?.(ctx);
			const container = stage.container();
			if (container) {
				container.style.cursor = next?.cursor ?? "default";
			}
		};
		sync();
		const unsubscribe = toolStore.subscribe(sync);
		return () => {
			unsubscribe();
			current?.onDeactivate?.(ctx);
		};
	}, [stage, ctx, registry, toolStore]);

	return null;
}
