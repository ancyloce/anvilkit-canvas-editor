"use client";

import type { CanvasIR } from "@anvilkit/canvas-core";
import { CanvasAssetsContext } from "./stage/CanvasAssetsContext.js";
import { CanvasNodeRenderer } from "./stage/CanvasNodeRenderer.js";
import { CanvasStage } from "./stage/CanvasStage.js";
import { DesignBackground } from "./stage/DesignBackground.js";
import { Grid } from "./stage/Grid.js";
import { RemoteCursors } from "./stage/RemoteCursors.js";
import { RemoteSelections } from "./stage/RemoteSelections.js";
import { RenderLayer } from "./stage/RenderLayer.js";

export interface CanvasStudioProps {
	ir: CanvasIR;
	activePageId: string;
	width?: number;
	height?: number;
	zoom?: number;
	panX?: number;
	panY?: number;
}

export function CanvasStudio({
	ir,
	activePageId,
	width,
	height,
	zoom,
	panX,
	panY,
}: CanvasStudioProps): React.JSX.Element {
	const activePage = ir.pages.find((p) => p.id === activePageId);
	if (!activePage) {
		return (
			<div data-testid="canvas-empty">
				No page with id "{activePageId}" found
			</div>
		);
	}
	const stageWidth = width ?? activePage.size.width;
	const stageHeight = height ?? activePage.size.height;
	return (
		<CanvasAssetsContext.Provider value={ir.assets}>
			<CanvasStage
				width={stageWidth}
				height={stageHeight}
				zoom={zoom}
				panX={panX}
				panY={panY}
			>
				<RenderLayer name="background" listening={false}>
					<DesignBackground />
					<Grid />
				</RenderLayer>
				<RenderLayer name="objects">
					{activePage.root.children.map((node) => (
						<CanvasNodeRenderer key={node.id} node={node} />
					))}
				</RenderLayer>
				<RenderLayer name="selection">
					{/* MVP-6: SelectionBox / CanvasTransformer / SmartGuides */}
				</RenderLayer>
				<RenderLayer name="presence" listening={false}>
					<RemoteCursors />
					<RemoteSelections />
				</RenderLayer>
			</CanvasStage>
		</CanvasAssetsContext.Provider>
	);
}
