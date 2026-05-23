"use client";

import type {
	CanvasAnyNodeUpdateCommand,
	CanvasNode,
	CanvasNodeResizeCommand,
	CanvasNodeRotateCommand,
} from "@anvilkit/canvas-core";
import type Konva from "konva";
import { useCallback, useEffect, useRef, useSyncExternalStore } from "react";
import { Transformer } from "react-konva";
import { useCanvasStudio } from "../context/canvas-studio-context.js";
import { draggedIdsKey } from "../perf/active-nodes.js";
import { nodeRenderOffset } from "../stage/node-render-offset.js";

const EPSILON = 0.5;

/**
 * Nodes sized by their geometry × transform scale, NOT by `bounds`:
 * `Konva.Path` renders from its `d`, `Konva.Line` from its `points`, each
 * scaled by `transform.scaleX/Y`. A resize must PERSIST that scale — baking it
 * into `bounds` (the bounds-sized path) is ignored by the renderer, so the
 * element snaps back to its intrinsic size the instant the commit re-renders.
 */
const SCALE_SIZED: ReadonlySet<CanvasNode["type"]> = new Set(["path", "line"]);

/**
 * Binds a react-konva <Transformer> to the currently-selected Konva nodes.
 * On `transformend`, fires one resize and/or rotate command per affected node
 * (MVP-7: refs during interaction; one command on commit). Konva's scaleX/Y
 * is reset to 1 after each commit so subsequent transforms re-derive from the
 * new bounds — standard react-konva transformer pattern.
 */
const noopSubscribe = () => () => undefined;

export function CanvasTransformer(): React.JSX.Element | null {
	const {
		stage,
		selectionStore,
		draftStore,
		cropStore,
		getIR,
		commit,
		activePageId,
	} = useCanvasStudio();
	// Hide the resize/rotate transformer while the crop editor owns the handles.
	const croppingId = useSyncExternalStore(
		cropStore ? cropStore.subscribe : noopSubscribe,
		() => cropStore?.getState().cropNodeId ?? null,
		() => cropStore?.getState().cropNodeId ?? null,
	);
	const selectedIds = useSyncExternalStore(
		selectionStore.subscribe,
		() => selectionStore.getState().selectedIds,
		() => selectionStore.getState().selectedIds,
	);
	// I2-5: dragging promotes a node into the drag layer, which remounts its
	// Konva node. Re-bind when the dragged set changes (start/end) so the
	// Transformer points at the live node, not the unmounted one.
	const draggedKey = useSyncExternalStore(
		draftStore.subscribe,
		() => draggedIdsKey(draftStore.getState().draft),
		() => draggedIdsKey(draftStore.getState().draft),
	);
	const transformerRef = useRef<Konva.Transformer | null>(null);

	useEffect(() => {
		const tr = transformerRef.current;
		if (!stage || !tr) return;
		const nodes: Konva.Node[] = [];
		for (const id of selectedIds) {
			const n = stage.findOne(`.${id}`);
			if (n) nodes.push(n);
		}
		tr.nodes(nodes);
		tr.getLayer?.()?.batchDraw?.();
	}, [stage, selectedIds, draggedKey]);

	// During a move drag the dragged node is promoted onto the drag layer, which
	// remounts its Konva node as a NEW instance. The drag runs on raw Konva
	// pointer events (outside React's event system), so the rebind effect above
	// fires asynchronously and gets starved by the move loop — leaving the
	// Transformer bound to the stale (destroyed) node, so the selection box stops
	// tracking the element (it stays at the original position). Subscribe to the
	// draft store and re-point the Transformer at the live nodes *synchronously*
	// on every move. This runs in the same tick as the node mutation (no React
	// re-render, so the per-move drag-layer optimization is preserved).
	//
	// On move END the node DEMOTES back to the objects layer — another instance
	// swap. The passive rebind effect above is meant to catch it, but it races
	// react-konva's reconciler and can land on the just-detached drag-layer node,
	// so a resize/rotate immediately after a move silently no-ops. Re-point once
	// more on the next frame, after react-konva has committed the demote.
	useEffect(() => {
		if (!stage) return;
		let raf = 0;
		const repoint = () => {
			const tr = transformerRef.current;
			if (!tr) return;
			const nodes: Konva.Node[] = [];
			for (const id of selectionStore.getState().selectedIds) {
				const n = stage.findOne(`.${id}`);
				if (n) nodes.push(n);
			}
			tr.nodes(nodes);
			tr.getLayer?.()?.batchDraw?.();
		};
		const sync = () => {
			const draft = draftStore.getState().draft;
			if (draft && draft.type === "move") {
				repoint();
				return;
			}
			// Draft cleared (or non-move): defer one frame so the demoted node has
			// re-mounted on the objects layer before we re-point at the live node.
			if (typeof requestAnimationFrame === "function") {
				cancelAnimationFrame(raf);
				raf = requestAnimationFrame(repoint);
			} else {
				repoint();
			}
		};
		const unsubscribe = draftStore.subscribe(sync);
		return () => {
			if (typeof cancelAnimationFrame === "function") cancelAnimationFrame(raf);
			unsubscribe();
		};
	}, [stage, draftStore, selectionStore]);

	const onTransformEnd = useCallback(() => {
		if (!stage) return;
		const ir = getIR();
		const page = ir.pages.find((p) => p.id === activePageId);
		if (!page) return;
		for (const id of selectedIds) {
			const knode = stage.findOne(`.${id}`) as Konva.Node | undefined;
			const irNode = page.root.children.find((c) => c.id === id);
			if (!knode || !irNode) continue;

			const scaleX = knode.scaleX();
			const scaleY = knode.scaleY();
			const konvaX = knode.x();
			const konvaY = knode.y();
			const newRotation = knode.rotation();

			if (SCALE_SIZED.has(irNode.type)) {
				// Path/line: persist the Transformer's scale into the IR transform so
				// the new size survives the commit (the renderer scales the geometry
				// by `transform.scaleX/Y`). Don't reset the Konva scale — the
				// re-render reapplies it from the IR. Position offset is 0 here.
				const offset = nodeRenderOffset(irNode);
				const nextX = konvaX - offset.x;
				const nextY = konvaY - offset.y;
				const changed =
					Math.abs(scaleX - irNode.transform.scaleX) > EPSILON ||
					Math.abs(scaleY - irNode.transform.scaleY) > EPSILON ||
					Math.abs(nextX - irNode.transform.x) > EPSILON ||
					Math.abs(nextY - irNode.transform.y) > EPSILON ||
					Math.abs(newRotation - irNode.transform.rotation) > EPSILON;
				if (changed) {
					const cmd: CanvasAnyNodeUpdateCommand = {
						type: "node.update",
						nodeId: id,
						kind: irNode.type,
						patch: {
							transform: {
								...irNode.transform,
								x: nextX,
								y: nextY,
								scaleX,
								scaleY,
								rotation: newRotation,
							},
						},
					} as CanvasAnyNodeUpdateCommand;
					commit(cmd);
				}
				continue;
			}

			// Bounds-sized nodes (rect/ellipse/image/text/group): bake the scale
			// into bounds and reset the Konva scale so the next transform starts
			// from 1×.
			knode.scaleX(1);
			knode.scaleY(1);
			const newW = irNode.bounds.width * scaleX;
			const newH = irNode.bounds.height * scaleY;
			// Konva.Ellipse positions by its CENTER, so `knode.x()` is the center.
			// Convert back to the IR top-left using the NEW bounds, or a resized
			// ellipse drifts by half its new size on commit.
			const offset = nodeRenderOffset({
				...irNode,
				bounds: { width: newW, height: newH },
			} as CanvasNode);
			const newX = konvaX - offset.x;
			const newY = konvaY - offset.y;

			const boundsChanged =
				Math.abs(newW - irNode.bounds.width) > EPSILON ||
				Math.abs(newH - irNode.bounds.height) > EPSILON ||
				Math.abs(newX - irNode.transform.x) > EPSILON ||
				Math.abs(newY - irNode.transform.y) > EPSILON;
			if (boundsChanged) {
				const cmd: CanvasNodeResizeCommand = {
					type: "node.resize",
					nodeId: id,
					from: {
						x: irNode.transform.x,
						y: irNode.transform.y,
						width: irNode.bounds.width,
						height: irNode.bounds.height,
					},
					to: { x: newX, y: newY, width: newW, height: newH },
				};
				commit(cmd);
			}

			if (Math.abs(newRotation - irNode.transform.rotation) > EPSILON) {
				const cmd: CanvasNodeRotateCommand = {
					type: "node.rotate",
					nodeId: id,
					from: irNode.transform.rotation,
					to: newRotation,
				};
				commit(cmd);
			}
		}
	}, [stage, selectedIds, getIR, commit, activePageId]);

	if (croppingId) return null;
	return <Transformer ref={transformerRef} onTransformEnd={onTransformEnd} />;
}
