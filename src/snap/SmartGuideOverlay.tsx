"use client";

import { useSyncExternalStore } from "react";
import { Line } from "react-konva";
import { useCanvasStores } from "../context/canvas-studio-context.js";
import {
	SMART_GUIDE_COLOR,
	SMART_GUIDE_DASH,
} from "./smart-guide-constants.js";

export function SmartGuideOverlay(): React.JSX.Element | null {
	const { guidesStore } = useCanvasStores();
	const guides = useSyncExternalStore(
		guidesStore.subscribe,
		() => guidesStore.getState().guides,
		() => guidesStore.getState().guides,
	);
	if (guides.length === 0) return null;
	return (
		<>
			{guides.map((g) => (
				<Line
					key={`guide-${g.axis}-${g.position}-${g.from.x}-${g.from.y}-${g.to.x}-${g.to.y}`}
					points={[g.from.x, g.from.y, g.to.x, g.to.y]}
					stroke={SMART_GUIDE_COLOR}
					strokeWidth={1}
					dash={SMART_GUIDE_DASH}
					listening={false}
				/>
			))}
		</>
	);
}
