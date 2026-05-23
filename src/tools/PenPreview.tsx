"use client";

import { useSyncExternalStore } from "react";
import { Circle, Path } from "react-konva";
import { useCanvasStudio } from "../context/canvas-studio-context.js";
import type { PenAnchor } from "../stores/pen-store.js";
import { buildPathD } from "./pen-geometry.js";

const EMPTY: PenAnchor[] = [];
const noopSubscribe = () => () => undefined;

/**
 * Live on-stage preview of the in-progress pen path (I3-2): the open-path curve
 * plus a dot at each placed anchor. Rendered in the selection layer; purely
 * visual (`listening={false}`), so it never intercepts pointer events.
 */
export function PenPreview(): React.JSX.Element | null {
	const { penStore, toolStore } = useCanvasStudio();
	const activeTool = useSyncExternalStore(
		toolStore.subscribe,
		() => toolStore.getState().activeTool,
		() => toolStore.getState().activeTool,
	);
	const anchors = useSyncExternalStore(
		penStore ? penStore.subscribe : noopSubscribe,
		() => penStore?.getState().anchors ?? EMPTY,
		() => penStore?.getState().anchors ?? EMPTY,
	);

	if (activeTool !== "path" || anchors.length === 0) return null;
	const d = buildPathD(anchors, false);

	return (
		<>
			{d ? (
				<Path data={d} stroke="#3b82f6" strokeWidth={1} listening={false} />
			) : null}
			{anchors.map((a, i) => (
				<Circle
					key={`${a.x}:${a.y}:${i}`}
					x={a.x}
					y={a.y}
					radius={3}
					fill="#ffffff"
					stroke="#3b82f6"
					strokeWidth={1}
					listening={false}
				/>
			))}
		</>
	);
}
