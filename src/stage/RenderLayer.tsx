"use client";

import type { ReactNode } from "react";
import { Layer } from "react-konva";

/**
 * `background`/`objects` are only used by the detached rasterize/export
 * stages (2 physical layers there, well under Konva's recommended max).
 * The live `<CanvasStudio>` stage uses `content` (background + objects),
 * `drag`, `overlay` (guides + selection chrome), and `presence` — 4
 * physical layers grouped via named `<Group>`s so the stage stays inside
 * Konva's recommended 3-5 layer range instead of the 6 separate layers
 * this used to mount.
 */
export type RenderLayerName =
	| "background"
	| "objects"
	| "content"
	| "drag"
	| "overlay"
	| "presence";

export interface RenderLayerProps {
	name: RenderLayerName;
	listening?: boolean;
	children?: ReactNode;
}

export function RenderLayer({
	name,
	listening = true,
	children,
}: RenderLayerProps): React.JSX.Element {
	return (
		<Layer name={name} listening={listening}>
			{children}
		</Layer>
	);
}
