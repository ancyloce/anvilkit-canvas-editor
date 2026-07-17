"use client";

import { useSyncExternalStore } from "react";
import {
	useCanvasStudio,
	useCanvasT,
} from "../context/canvas-studio-context.js";

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
 * §12 item 10 a11y: a polite live region that announces the zoom percentage
 * whenever it changes (buttons, shortcuts, wheel, or the footer slider). A
 * separate region from {@link ToolAnnouncer} — tool-switch and zoom-change
 * announcements are independent events and sharing one `aria-live` region
 * would let one clobber the other. Renders nothing visible.
 */
export function ZoomAnnouncer(): React.JSX.Element {
	const ctx = useCanvasStudio();
	const t = useCanvasT();
	const zoom = useSyncExternalStore(
		ctx.viewportStore.subscribe,
		() => ctx.viewportStore.getState().zoom,
		() => ctx.viewportStore.getState().zoom,
	);
	const percent = Math.round(zoom * 100);
	return (
		<div
			data-testid="zoom-announcer"
			role="status"
			aria-live="polite"
			aria-atomic="true"
			style={srOnly}
		>
			{t("canvas.zoom.announcement", "Zoom {percent}%").replace(
				"{percent}",
				String(percent),
			)}
		</div>
	);
}
