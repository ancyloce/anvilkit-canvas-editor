"use client";

import type Konva from "konva";
import * as React from "react";
import { type ReactNode, useEffect, useRef } from "react";
import { Stage } from "react-konva";
// Registers every Konva shape class react-konva can name (K-13). Anchored HERE
// because every Konva tree in this package is mounted inside this component —
// the live stage and the offscreen rasterizer both go through it — so no
// narrower import path (rendering only `<Grid>`, say) can reach react-konva
// with an unregistered class and silently get an empty `Konva.Group` instead.
import "./konva.js";

export interface CanvasStageProps {
	width: number;
	height: number;
	zoom?: number;
	panX?: number;
	panY?: number;
	/**
	 * The UNSCALED design-surface size (page or Source-root bounds), attached
	 * to the stage as the `akSurfaceSize` attr. The export path bounds its
	 * capture with this (see `surfaceRect` in `render/export-stage.ts`) —
	 * under the K-1 windowed stage `stage.width()` is the window, not the
	 * page, so the surface must travel explicitly. Optional: the offscreen
	 * rasterizer passes explicit capture rects and older callers without it
	 * keep the stage-box-derived fallback.
	 */
	surfaceSize?: { readonly width: number; readonly height: number };
	onReady?: (stage: Konva.Stage) => void;
	children: ReactNode;
}

export function CanvasStage({
	width,
	height,
	zoom = 1,
	panX = 0,
	panY = 0,
	surfaceSize,
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
			// react-konva applies unknown props as Konva attrs; callers pass a
			// memoized object so this never churns `_setAttr` (K-3 discipline).
			akSurfaceSize={surfaceSize}
		>
			{children}
		</Stage>
	);
}
