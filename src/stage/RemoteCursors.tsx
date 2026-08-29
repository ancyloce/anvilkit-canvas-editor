"use client";

import { useSyncExternalStore } from "react";
import { Group, Line, Rect, Text } from "react-konva";
import { useCanvasPresence } from "../collab/useCanvasPresence.js";
import { useCanvasStudio } from "../context/canvas-studio-context.js";

/** Ephemeral page-space cursors. The inverse scale keeps chrome screen-sized. */
export function RemoteCursors(): React.JSX.Element | null {
	const peers = useCanvasPresence();
	const { viewportStore } = useCanvasStudio();
	const zoom = useSyncExternalStore(
		viewportStore.subscribe,
		() => viewportStore.getState().zoom,
		() => viewportStore.getState().zoom,
	);
	if (peers.length === 0 || !Number.isFinite(zoom) || zoom <= 0) return null;

	return (
		<Group name="remote-cursors" listening={false}>
			{peers.flatMap((presence) => {
				if (!presence.cursor) return [];
				const label = presence.peer.displayName?.trim() || presence.peer.id;
				const color = presence.peer.color ?? "#2563eb";
				const labelWidth = Math.min(160, Math.max(36, label.length * 7 + 12));
				return [
					<Group
						key={presence.peer.id}
						name={`remote-cursor-${presence.peer.id}`}
						scaleX={1 / zoom}
						scaleY={1 / zoom}
						x={presence.cursor.x}
						y={presence.cursor.y}
					>
						<Line
							closed
							fill={color}
							points={[0, 0, 1, 17, 5, 13, 9, 21, 13, 19, 9, 11, 17, 11]}
							shadowBlur={1}
							shadowColor="black"
							shadowOpacity={0.25}
							stroke="white"
							strokeWidth={1}
						/>
						<Rect
							cornerRadius={4}
							fill={color}
							height={20}
							width={labelWidth}
							x={12}
							y={14}
						/>
						<Text
							fill="white"
							fontSize={12}
							fontStyle="bold"
							stroke="black"
							strokeWidth={0.5}
							text={label}
							width={labelWidth - 8}
							x={16}
							y={18}
						/>
					</Group>,
				];
			})}
		</Group>
	);
}
