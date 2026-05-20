"use client";

import type Konva from "konva";
import { type ReactNode, useEffect, useRef } from "react";
import { Stage } from "react-konva";

export interface CanvasStageProps {
	width: number;
	height: number;
	zoom?: number;
	panX?: number;
	panY?: number;
	onReady?: (stage: Konva.Stage) => void;
	children: ReactNode;
}

export function CanvasStage({
	width,
	height,
	zoom = 1,
	panX = 0,
	panY = 0,
	onReady,
	children,
}: CanvasStageProps): React.JSX.Element {
	const stageRef = useRef<Konva.Stage | null>(null);

	useEffect(() => {
		const stage = stageRef.current;
		if (stage && onReady) {
			onReady(stage);
		}
		return () => {
			// Per PRD §4.3: Konva.Stage MUST be destroyed on unmount.
			// destroy() also detaches its container element and releases the
			// image cache associated with the stage.
			stageRef.current?.destroy();
			stageRef.current = null;
		};
	}, [onReady]);

	return (
		<Stage
			ref={stageRef}
			width={width}
			height={height}
			scaleX={zoom}
			scaleY={zoom}
			x={panX}
			y={panY}
		>
			{children}
		</Stage>
	);
}
