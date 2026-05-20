"use client";

import { Layer, Stage, Text } from "react-konva";

export interface CanvasStudioProps {
	pageId: string;
}

export function CanvasStudio({ pageId }: CanvasStudioProps) {
	return (
		<Stage width={800} height={600}>
			<Layer>
				<Text
					text={`Canvas Studio scaffold (page ${pageId})`}
					x={20}
					y={20}
					fontSize={18}
				/>
			</Layer>
		</Stage>
	);
}
