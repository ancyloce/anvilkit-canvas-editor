"use client";

import { useEffect, useSyncExternalStore } from "react";
import { useCanvasStudio } from "../context/canvas-studio-context.js";
import { cancelPenPath, commitPenPath } from "./pen-actions.js";

/**
 * Keyboard finalizer for the pen tool (I3-2). Renders nothing; while the `path`
 * tool is active it listens globally for Enter (finalize an open path) and
 * Escape (cancel). Commit/cancel run through {@link commitPenPath}/{@link
 * cancelPenPath} — the same path the close-on-first-anchor click uses.
 */
export function PenToolOverlay(): null {
	const ctx = useCanvasStudio();
	const { toolStore, penStore } = ctx;
	const activeTool = useSyncExternalStore(
		toolStore.subscribe,
		() => toolStore.getState().activeTool,
		() => toolStore.getState().activeTool,
	);

	useEffect(() => {
		if (activeTool !== "path" || !penStore) return;
		const onKey = (e: KeyboardEvent) => {
			if (e.key === "Enter") {
				e.preventDefault();
				commitPenPath(ctx, false);
			} else if (e.key === "Escape") {
				e.preventDefault();
				cancelPenPath(ctx);
			}
		};
		window.addEventListener("keydown", onKey);
		return () => window.removeEventListener("keydown", onKey);
	}, [activeTool, penStore, ctx]);

	return null;
}
