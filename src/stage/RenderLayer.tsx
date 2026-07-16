"use client";

import type { ReactNode } from "react";
import { Layer } from "react-konva";

export type RenderLayerName =
	| "background"
	| "objects"
	| "drag"
	| "guides"
	| "selection"
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
