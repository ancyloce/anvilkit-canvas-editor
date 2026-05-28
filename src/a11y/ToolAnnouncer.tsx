"use client";

import { useSyncExternalStore } from "react";
import { useCanvasStudio } from "../context/canvas-studio-context.js";
import { TOOL_LABELS } from "./tool-labels.js";

// Visually hidden but exposed to assistive tech (the canonical sr-only clip).
const srOnly = {
	position: "absolute",
	width: 1,
	height: 1,
	padding: 0,
	margin: -1,
	overflow: "hidden",
	clip: "rect(0 0 0 0)",
	whiteSpace: "nowrap",
	border: 0,
} as const;

/**
 * I3-3 a11y: a polite live region that announces the active tool whenever it
 * changes (`select` → `rect` → …). Mounted inside `<CanvasStudio>` so it tracks
 * `toolStore` regardless of which surface — host toolbar, keyboard shortcut —
 * triggered the switch. Renders nothing visible.
 */
export function ToolAnnouncer(): React.JSX.Element {
	const ctx = useCanvasStudio();
	const activeTool = useSyncExternalStore(
		ctx.toolStore.subscribe,
		() => ctx.toolStore.getState().activeTool,
		() => ctx.toolStore.getState().activeTool,
	);
	return (
		<div
			data-testid="tool-announcer"
			role="status"
			aria-live="polite"
			aria-atomic="true"
			style={srOnly}
		>
			{`${TOOL_LABELS[activeTool]} tool selected`}
		</div>
	);
}
