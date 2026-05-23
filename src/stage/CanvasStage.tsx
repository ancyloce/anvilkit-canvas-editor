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
			// react-konva's <Stage> already destroys its Konva.Stage on real
			// unmount (detaching the container + releasing the image cache, per
			// PRD §4.3). Calling destroy() here ALSO fires on React StrictMode's
			// mount→cleanup→mount probe (Next dev default), tearing down the live
			// stage between the double-invoke; react-konva does not rebuild it, so
			// the canvas renders blank (0 <canvas>, 0 .konvajs-content). Just drop
			// our ref and let react-konva own the stage's lifecycle.
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
