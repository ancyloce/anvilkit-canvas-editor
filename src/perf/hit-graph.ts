"use client";

import type Konva from "konva";
import { useCallback, useEffect, useRef } from "react";
import type { RenderLayerName } from "../stage/RenderLayer.js";

const CONTENT_LAYER: RenderLayerName = "content";

function layerByName(
	stage: Konva.Stage,
	name: RenderLayerName,
): Konva.Layer | undefined {
	const getLayers = (stage as { getLayers?: () => ReadonlyArray<Konva.Layer> })
		.getLayers;
	if (typeof getLayers !== "function") return undefined;
	return getLayers.call(stage).find((layer) => layer.name() === name);
}

/**
 * Stop drawing the content layer's HIT GRAPH for the duration of a transform
 * gesture (K-15).
 *
 * Konva redraws both canvases together — `Layer.draw()` is
 * `drawScene(); drawHit();` — and it skips the hit pass only when a Konva DD
 * drag is in flight (`Node.shouldDrawHit` consults `DD._dragElements`). This
 * editor drives resize/rotate off the Transformer's own window-level mouse
 * handling and node moves off hand-rolled pointer events, so that skip never
 * applies and every frame of a gesture pays for a full second walk of the
 * layer, re-rendering every shape — glyph by glyph for text — into the hit
 * canvas that nothing reads mid-gesture.
 *
 * MOVES do not need this: K-4 promotes the dragged nodes onto the `drag`
 * layer, so the content layer is not invalidated at all. TRANSFORMS do — the
 * Transformer mutates the selected nodes in place, on the content layer.
 *
 * Suspending is safe precisely because the gesture is already captured: the
 * pointer is on a Transformer anchor, which lives on the `overlay` layer and
 * keeps listening. Nothing consults content hit-testing until the user
 * releases.
 *
 * `resume()` redraws, because `Layer.drawHit` CLEARS the hit canvas before it
 * checks whether to populate it — so a suspended layer's hit canvas is empty,
 * not stale, and has to be repainted before it can answer again. The effect
 * below resumes on unmount or a stage swap, so an interrupted gesture can
 * never strand the content layer unclickable.
 */
export function useContentHitGraphSuspension(stage: Konva.Stage | null): {
	suspend: () => void;
	resume: () => void;
} {
	const suspendedRef = useRef<Konva.Layer | null>(null);

	const resume = useCallback((): void => {
		const layer = suspendedRef.current;
		if (!layer) return;
		suspendedRef.current = null;
		layer.listening(true);
		layer.batchDraw();
	}, []);

	const suspend = useCallback((): void => {
		if (!stage || suspendedRef.current) return;
		const layer = layerByName(stage, CONTENT_LAYER);
		// Already non-listening for some other reason: leave it alone, and do
		// not record it — resuming would then turn on something we did not
		// turn off.
		if (!layer || !layer.listening()) return;
		layer.listening(false);
		suspendedRef.current = layer;
	}, [stage]);

	useEffect(() => resume, [resume, stage]);

	return { suspend, resume };
}
