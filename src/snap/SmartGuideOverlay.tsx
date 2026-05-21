"use client";

import { useSyncExternalStore } from "react";
import { Line } from "react-konva";
import { useCanvasStudio } from "../context/canvas-studio-context.js";

export const SMART_GUIDE_COLOR = "#ff00ff";
export const SMART_GUIDE_DASH: [number, number] = [4, 4];

export function SmartGuideOverlay(): React.JSX.Element | null {
	const { guidesStore } = useCanvasStudio();
	const guides = useSyncExternalStore(
		guidesStore.subscribe,
		() => guidesStore.getState().guides,
		() => guidesStore.getState().guides,
	);
	if (guides.length === 0) return null;
	return (
		<>
			{guides.map((g, i) => (
				<Line
					key={`guide-${g.axis}-${g.position}-${i}`}
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
