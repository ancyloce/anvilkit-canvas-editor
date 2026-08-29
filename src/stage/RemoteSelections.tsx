"use client";

import { findNode } from "@anvilkit/canvas-core";
import { useSyncExternalStore } from "react";
import { Group, Rect } from "react-konva";
import { useCanvasPresence } from "../collab/useCanvasPresence.js";
import { useCanvasStudio } from "../context/canvas-studio-context.js";
import { withFiniteGeometry } from "./finite-geometry.js";
import { resolveNodeWorldPosition } from "./node-world-position.js";
import { resolvedPageSpace } from "./resolved-page-space.js";

/** Non-interactive remote selection outlines, resolved in active-page space. */
export function RemoteSelections(): React.JSX.Element | null {
	const peers = useCanvasPresence();
	const ctx = useCanvasStudio();
	const zoom = useSyncExternalStore(
		ctx.viewportStore.subscribe,
		() => ctx.viewportStore.getState().zoom,
		() => ctx.viewportStore.getState().zoom,
	);
	if (peers.length === 0 || !Number.isFinite(zoom) || zoom <= 0) return null;
	const pageSpace = resolvedPageSpace(ctx.resolvedDocumentStore);

	return (
		<Group name="remote-selections" listening={false}>
			{peers.flatMap((presence) =>
				(presence.selection?.nodeIds ?? []).flatMap((nodeId) => {
					const found = findNode(ctx.ir, nodeId);
					if (!found || found.page.id !== ctx.activePageId) return [];
					const node = withFiniteGeometry(found.node);
					const aabb = pageSpace?.aabbOf(nodeId);
					const origin =
						pageSpace?.originOf(nodeId) ??
						resolveNodeWorldPosition(ctx.ir, nodeId) ??
						{ x: node.transform.x, y: node.transform.y };
					return [
						<Rect
							key={`${presence.peer.id}:${nodeId}`}
							dash={[6 / zoom, 4 / zoom]}
							height={aabb ? aabb.maxY - aabb.minY : node.bounds.height}
							name={`remote-selection-${presence.peer.id}-${nodeId}`}
							stroke={presence.peer.color ?? "#2563eb"}
							strokeWidth={2 / zoom}
							width={aabb ? aabb.maxX - aabb.minX : node.bounds.width}
							x={aabb?.minX ?? origin.x}
							y={aabb?.minY ?? origin.y}
						/>,
					];
				}),
			)}
		</Group>
	);
}
