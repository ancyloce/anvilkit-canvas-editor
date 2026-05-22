"use client";

import type Konva from "konva";
import { useEffect, useMemo } from "react";
import { useCanvasStudio } from "../context/canvas-studio-context.js";
import { getStagePointer } from "./get-stage-pointer.js";
import { defaultToolRegistry } from "./tool-registry.js";
import type { Tool, ToolContext, ToolRegistry } from "./tool-types.js";

export interface ToolInteractionLayerProps {
	/** Optional override (mainly for tests). Defaults to `defaultToolRegistry`. */
	registry?: ToolRegistry;
}

/**
 * Bridges Konva.Stage pointer events to the active tool from `toolStore`.
 * Renders no DOM — pure side-effect component. Mounts as a sibling of
 * <CanvasStage> inside the CanvasStudioContext so unmount order detaches
 * listeners before <CanvasStage> calls `stage.destroy()`.
 */
export function ToolInteractionLayer({
	registry = defaultToolRegistry,
}: ToolInteractionLayerProps): null {
	const {
		stage,
		getIR,
		commit,
		selectionStore,
		viewportStore,
		toolStore,
		guidesStore,
		draftStore,
		editingStore,
		pickAsset,
		activePageId,
		requestAiIntent,
	} = useCanvasStudio();

	const ctx = useMemo<ToolContext | null>(() => {
		if (!stage) return null;
		return {
			stage,
			getIR,
			commit,
			selectionStore,
			viewportStore,
			toolStore,
			guidesStore,
			draftStore,
			editingStore,
			pickAsset,
			activePageId,
			requestAiIntent,
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
		pickAsset,
		activePageId,
		requestAiIntent,
	]);

	// Wire pointer dispatch.
	useEffect(() => {
		if (!stage || !ctx) return;
		const handle =
			(phase: "down" | "move" | "up") =>
			(kEvt: Konva.KonvaEventObject<PointerEvent>) => {
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
				const evt = kEvt.evt;
				const shiftKey =
					evt && "shiftKey" in evt
						? Boolean((evt as PointerEvent).shiftKey)
						: false;
				hook(
					{
						evt,
						point: ptr.world,
						screenPoint: ptr.screen,
						stage,
						target: kEvt.target,
						shiftKey,
					},
					ctx,
				);
			};
		const onDown = handle("down");
		const onMove = handle("move");
		const onUp = handle("up");
		stage.on("pointerdown", onDown);
		stage.on("pointermove", onMove);
		stage.on("pointerup", onUp);
		return () => {
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
